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
