import {
  assertKeySegments,
  assertPublishableFirstSegment,
  buildPathObjectKey as buildSharedPathObjectKey,
  InvalidKeyError,
  normalizeSourcePath as normalizeSharedSourcePath,
  type PathObjectKeyInput as SharedPathObjectKeyInput,
  splitKeySegments,
} from '@smartimg/shared'
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

function assertAllowedImageMime(mime: string): void {
  if (!isAllowedImageMime(mime)) {
    throw new ApiError(
      'invalid_upload',
      400,
      'contentType must be one of ' + ALLOWED_MIME_TYPES.join(', '),
    )
  }
}

function extensionForMime(mime: string): string {
  assertAllowedImageMime(mime)
  return MIME_EXTENSION[mime as keyof typeof MIME_EXTENSION]
}

/** The shared key rule reports with its own error; here it is an HTTP 400. */
function asApiError<T>(build: () => T): T {
  try {
    return build()
  } catch (error) {
    if (error instanceof InvalidKeyError) {
      throw new ApiError('invalid_upload', 400, error.message)
    }
    throw error
  }
}

/**
 * A key prefix as the listing hands it back: any segments a key may hold,
 * Korean and spaces included, so browsing reaches every key the path rule
 * produces.
 */
function normalizeKeyPrefix(input: string, what: string): string {
  const segments = splitKeySegments(input.trim())
  asApiError(() => assertKeySegments(segments, what))
  return segments.join('/')
}

/** Empty means the root of the bucket. */
export function normalizeListPrefix(input: string): string {
  return normalizeKeyPrefix(input, 'folder')
}

/**
 * The folder an upload is filed under is exactly the prefix given — the one
 * being browsed, so a file lands where the user is looking. There is no
 * default: nothing is stored at the root.
 */
export function normalizeUploadPrefix(input: string | undefined): string {
  const prefix = input === undefined ? '' : normalizeKeyPrefix(input, 'folder')
  if (prefix === '') {
    throw new ApiError('invalid_upload', 400, 'folder is required')
  }
  asApiError(() => assertPublishableFirstSegment(prefix.split('/')[0] ?? ''))
  return prefix
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
  readonly folder: string
  readonly uuid?: string | undefined
}

/**
 * {prefix}/{uuid}-{sanitized-name}.{ext} — the UUID makes overwrites
 * practically impossible, and the extension comes from the MIME type so the
 * filename is never trusted.
 */
export function buildObjectKey(input: ObjectKeyInput): string {
  const extension = extensionForMime(input.contentType)
  const prefix = normalizeUploadPrefix(input.folder)
  const uuid = input.uuid ?? crypto.randomUUID()
  return prefix + '/' + uuid + '-' + sanitizeFilename(input.filename) + '.' + extension
}

export function normalizeSourcePath(input: string): readonly string[] {
  return asApiError(() => normalizeSharedSourcePath(input))
}

export type PathObjectKeyInput = SharedPathObjectKeyInput & { readonly contentType: string }

/**
 * The key is the share path verbatim (see the shared rule). Without a
 * contentHash the object is overwritten in place, so it must not be served
 * with an immutable cache — see mutableCacheControl in store.ts.
 */
export function buildPathObjectKey(input: PathObjectKeyInput): string {
  // The extension is not taken from the MIME type here, but the type is still
  // checked: only real image types may be signed for upload.
  assertAllowedImageMime(input.contentType)
  return asApiError(() =>
    buildSharedPathObjectKey({ path: input.path, contentHash: input.contentHash }),
  )
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
