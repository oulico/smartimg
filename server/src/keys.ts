import { ApiError } from './errors'

const MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
} as const satisfies Record<string, string>

export const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSION) as readonly string[]

export function isAllowedImageMime(mime: string): boolean {
  return mime in MIME_EXTENSION
}

function extensionForMime(mime: string): string {
  if (!(mime in MIME_EXTENSION)) {
    throw new ApiError(
      'invalid_upload',
      400,
      'contentType must be one of ' + ALLOWED_MIME_TYPES.join(', '),
    )
  }
  return MIME_EXTENSION[mime as keyof typeof MIME_EXTENSION]
}

const FOLDER_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_FOLDER_SEGMENTS = 4
const DEFAULT_FOLDER = 'uploads'

export function normalizeFolder(input: string): string {
  const trimmed = input
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
  if (trimmed === '') return DEFAULT_FOLDER
  const segments = trimmed.split('/')
  if (segments.length > MAX_FOLDER_SEGMENTS) {
    throw new ApiError('invalid_upload', 400, 'folder must have at most 4 segments')
  }
  for (const segment of segments) {
    if (!FOLDER_SEGMENT.test(segment)) {
      throw new ApiError(
        'invalid_upload',
        400,
        'folder segments must match [a-z0-9][a-z0-9._-]{0,63}',
      )
    }
  }
  return segments.join('/')
}

export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60)
  return cleaned === '' ? 'image' : cleaned
}

export type ObjectKeyInput = {
  readonly filename: string
  readonly contentType: string
  readonly folder?: string | undefined
  readonly now?: Date | undefined
  readonly uuid?: string | undefined
}

/**
 * Builds a collision-safe immutable object key:
 * {folder}/{yyyy}/{mm}/{uuid}-{sanitized-name}.{ext}
 * The UUID makes accidental overwrites practically impossible; the server
 * derives the extension from the MIME type so it never trusts the filename.
 */
export function buildObjectKey(input: ObjectKeyInput): string {
  const extension = extensionForMime(input.contentType)
  const now = input.now ?? new Date()
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0')
  const folder = normalizeFolder(input.folder ?? DEFAULT_FOLDER)
  const uuid = input.uuid ?? crypto.randomUUID()
  return (
    folder +
    '/' +
    now.getUTCFullYear() +
    '/' +
    month +
    '/' +
    uuid +
    '-' +
    sanitizeFilename(input.filename) +
    '.' +
    extension
  )
}

/**
 * Segments of a NAS path are kept verbatim so the object key mirrors the share
 * exactly: Korean names, dots and spaces all survive. Only what would break an
 * S3 key or a CloudFront path is refused, and it is refused loudly rather than
 * rewritten, because a silently mangled segment breaks the promise that the
 * key can be derived from the NAS path (and back again).
 */
// Control characters, a slash or a stray backslash are the only things refused:
// spaces and Korean are ordinary on this NAS and survive into the key.
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const FORBIDDEN_IN_SEGMENT = /[\\/\u0000-\u001f\u007f]/

/** First path segment doubling as a DIT transform directive would be ambiguous. */
const TRANSFORM_LOOKALIKE = /^(?:\d+x\d+|fit-in|filters:.*|trim|meta)$/

export const MAX_PATH_SEGMENTS = 16
const HASH_LENGTH = 7

export function normalizeSourcePath(input: string): readonly string[] {
  const segments = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '')
  if (segments.length < 2) {
    throw new ApiError('invalid_upload', 400, 'path must include a share and a filename')
  }
  if (segments.length > MAX_PATH_SEGMENTS) {
    throw new ApiError(
      'invalid_upload',
      400,
      'path must have at most ' + String(MAX_PATH_SEGMENTS) + ' segments',
    )
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new ApiError('invalid_upload', 400, 'path must not contain . or .. segments')
    }
    if (FORBIDDEN_IN_SEGMENT.test(segment)) {
      throw new ApiError(
        'invalid_upload',
        400,
        'path segment has an unusable character: ' + segment,
      )
    }
    if (segment.length > 255) {
      throw new ApiError('invalid_upload', 400, 'path segment exceeds 255 characters: ' + segment)
    }
  }
  const share = (segments[0] ?? '').toLowerCase()
  if (TRANSFORM_LOOKALIKE.test(share)) {
    throw new ApiError('invalid_upload', 400, 'share name must not look like a transform directive')
  }
  return [share, ...segments.slice(1)]
}

export type PathObjectKeyInput = {
  readonly path: string
  readonly contentType: string
  /**
   * Omit to mirror the path exactly, so the same source file always lands on
   * the same key and a replacement overwrites it — one permanent URL per file,
   * whose content follows the file. Supply it to append a short digest instead,
   * which makes each version its own immutable object.
   */
  readonly contentHash?: string | undefined
}

/**
 * Builds a key that mirrors the source share path: share/dir/.../name.{ext}
 * The same source file therefore always lands on the same key, and replacing
 * it overwrites the object in place, so one link keeps pointing at whatever
 * that file currently is. Such a key is not immutable and must not be served
 * with a one-year cache — see mutableCacheControl in store.ts.
 *
 * With a contentHash the digest goes before the extension instead, making each
 * version its own object that can keep the immutable cache.
 */
export function buildPathObjectKey(input: PathObjectKeyInput): string {
  const extension = extensionForMime(input.contentType)
  if (input.contentHash !== undefined && !/^[0-9a-f]{7,64}$/.test(input.contentHash)) {
    throw new ApiError('invalid_upload', 400, 'contentHash must be 7-64 lowercase hex characters')
  }
  const segments = normalizeSourcePath(input.path)
  const filename = segments[segments.length - 1] ?? ''
  const stem = filename.replace(/\.[^.]*$/, '') || 'image'
  const suffix =
    input.contentHash === undefined ? '' : '.' + input.contentHash.slice(0, HASH_LENGTH)
  return [...segments.slice(0, -1), stem + suffix + '.' + extension].join('/')
}

/**
 * Listing has to reach the same keys the path rule produces, so it accepts any
 * segment a key may hold rather than the restricted folder syntax used when the
 * server names an upload itself.
 */
export function normalizeListPrefix(input: string): string {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, '')
  if (trimmed === '') return DEFAULT_FOLDER
  return normalizeSourcePathPrefix(trimmed)
}

function normalizeSourcePathPrefix(trimmed: string): string {
  const segments = trimmed.split('/').filter((segment) => segment !== '')
  if (segments.length > MAX_PATH_SEGMENTS) {
    throw new ApiError(
      'invalid_upload',
      400,
      'folder must have at most ' + String(MAX_PATH_SEGMENTS) + ' segments',
    )
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new ApiError('invalid_upload', 400, 'folder must not contain . or .. segments')
    }
    if (FORBIDDEN_IN_SEGMENT.test(segment)) {
      throw new ApiError('invalid_upload', 400, 'folder segment has an unusable character')
    }
  }
  return segments.join('/')
}

export function assertSafeKey(key: string): void {
  if (key.length === 0 || key.length > 1024) {
    throw new ApiError('unsafe_key', 400, 'object key must be 1-1024 characters')
  }
  if (key.startsWith('/') || key.includes('//')) {
    throw new ApiError(
      'unsafe_key',
      400,
      'object key must be a relative path without empty segments',
    )
  }
  for (const segment of key.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new ApiError('unsafe_key', 400, 'object key must not contain . or .. segments')
    }
  }
}
