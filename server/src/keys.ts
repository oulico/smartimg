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

/**
 * Versioned objects live under this prefix instead of carrying the digest in
 * the filename. A digest spliced into the name (photo.9f3a2c1.jpg) is a key a
 * plain upload could also produce, from a source file that happens to be named
 * that way — rare, but the whole point of a versioned key is that nothing else
 * can ever land on it. Refusing such filenames would be the other way out, and
 * a worse one: it would reject a real file on the share to prevent a collision
 * that needs a 1-in-268-million digest match to happen at all. A reserved first
 * segment costs one unusable share name instead, and shares are few and chosen
 * by whoever sets the sync up.
 */
export const VERSION_PREFIX = '_v'

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
  if (share === VERSION_PREFIX) {
    throw new ApiError(
      'invalid_upload',
      400,
      'share name ' + VERSION_PREFIX + ' is reserved for versioned objects',
    )
  }
  return [share, ...segments.slice(1)]
}

export type PathObjectKeyInput = {
  readonly path: string
  readonly contentType: string
  /**
   * Digest of the bytes that are about to be stored — not of the source file
   * they were derived from. Omit it to mirror the path exactly, so the same
   * source file always lands on the same key and a replacement overwrites it —
   * one permanent URL per file, whose content follows the file. Supply it to
   * place the object under its own version prefix instead, which makes each
   * version its own immutable object.
   */
  readonly contentHash?: string | undefined
}

/**
 * Builds a key that is the source share path, verbatim:
 *
 *   김치.jpg -> share/김치.jpg
 *   김치.png -> share/김치.png
 *
 * The filename is carried across untouched, extension included. Deriving the
 * extension from the MIME type instead would map every 김치.* in a folder onto
 * one 김치.webp and let the last upload silently win, so the rule stays "the
 * path, exactly": distinct source files cannot help but get distinct keys, and
 * the URL is readable straight off the share.
 *
 * That only holds while the stored bytes keep the source format — see
 * compressImage, which re-encodes in place rather than converting. Delivery is
 * a separate matter: CloudFront negotiates WebP through the preset filters.
 *
 * The same source file therefore always lands on the same key, and replacing
 * it overwrites the object in place, so one link keeps pointing at whatever
 * that file currently is. Such a key is not immutable and must not be served
 * with a one-year cache — see mutableCacheControl in store.ts.
 *
 * With a contentHash the whole path moves under _v/{digest}/, making each
 * version its own object that can keep the immutable cache:
 *
 *   share/김치.jpg + 9f3a2c1... -> _v/9f3a2c1/share/김치.jpg
 *
 * The digest must cover the stored bytes. Hashing the source instead would let
 * two different objects — the same photo recompressed at another quality —
 * share one key that is served with a year of immutable caching, which is the
 * one thing a versioned key exists to rule out.
 */
export function buildPathObjectKey(input: PathObjectKeyInput): string {
  // The extension is not taken from the MIME type here, but the type is still
  // checked: only real image types may be signed for upload.
  if (!isAllowedImageMime(input.contentType)) {
    throw new ApiError(
      'invalid_upload',
      400,
      'contentType must be one of ' + ALLOWED_MIME_TYPES.join(', '),
    )
  }
  if (input.contentHash !== undefined && !/^[0-9a-f]{7,64}$/.test(input.contentHash)) {
    throw new ApiError('invalid_upload', 400, 'contentHash must be 7-64 lowercase hex characters')
  }
  const segments = normalizeSourcePath(input.path)
  if (input.contentHash === undefined) return segments.join('/')
  return [VERSION_PREFIX, input.contentHash.slice(0, HASH_LENGTH), ...segments].join('/')
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
