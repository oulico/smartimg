/**
 * The key rule for objects that mirror a NAS path. The server applies it when
 * it signs an upload and the agent applies it to predict the key for
 * --dry-run, so it lives here: one copy, and what the agent prints is what
 * the server will accept.
 */
export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

export const MAX_PATH_SEGMENTS = 16
/** share / folder / file — a file sitting at the share root is not published. */
export const MIN_PATH_SEGMENTS = 3
const MAX_SEGMENT_LENGTH = 255

/**
 * Versioned objects live under this prefix, so a plain upload can never land
 * on a versioned object's key whatever the source file is named. It costs one
 * unusable share name, which is refused below.
 */
export const VERSION_PREFIX = '_v'
export const HASH_LENGTH = 7
const CONTENT_HASH = /^[0-9a-f]{7,64}$/

// Segments are kept verbatim — Korean, spaces and dots all survive — and only
// what would break an S3 key or a CloudFront path is refused, loudly rather
// than rewritten, so the key can always be derived from the path and back.
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const FORBIDDEN_IN_SEGMENT = /[\\/\u0000-\u001f\u007f]/

/** A first segment that reads as a DIT transform directive would make the URL ambiguous. */
const TRANSFORM_LOOKALIKE = /^(?:\d+x\d+|fit-in|filters:.*|trim|meta)$/

export function splitKeySegments(input: string): readonly string[] {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '')
}

export function assertKeySegments(segments: readonly string[], what: string): void {
  if (segments.length > MAX_PATH_SEGMENTS) {
    throw new InvalidKeyError(
      what + ' must have at most ' + String(MAX_PATH_SEGMENTS) + ' segments',
    )
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new InvalidKeyError(what + ' must not contain . or .. segments')
    }
    if (FORBIDDEN_IN_SEGMENT.test(segment)) {
      throw new InvalidKeyError(what + ' segment has an unusable character: ' + segment)
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      throw new InvalidKeyError(
        what + ' segment exceeds ' + String(MAX_SEGMENT_LENGTH) + ' characters: ' + segment,
      )
    }
  }
}

/** The first segment of an uploaded key must not collide with a transform or the version prefix. */
export function assertPublishableFirstSegment(segment: string): void {
  if (TRANSFORM_LOOKALIKE.test(segment)) {
    throw new InvalidKeyError('share name must not look like a transform directive')
  }
  if (segment === VERSION_PREFIX) {
    throw new InvalidKeyError('share name ' + VERSION_PREFIX + ' is reserved for versioned objects')
  }
}

/** True when the path has a folder between the share and the filename. */
export function isPublishablePath(input: string): boolean {
  return splitKeySegments(input).length >= MIN_PATH_SEGMENTS
}

/** `share/dir/file` → segments, with only the share lowercased. */
export function normalizeSourcePath(input: string): readonly string[] {
  const segments = splitKeySegments(input)
  if (segments.length < MIN_PATH_SEGMENTS) {
    throw new InvalidKeyError('path must include a share, a folder and a filename')
  }
  assertKeySegments(segments, 'path')
  const share = (segments[0] ?? '').toLowerCase()
  assertPublishableFirstSegment(share)
  return [share, ...segments.slice(1)]
}

export type PathObjectKeyInput = {
  readonly path: string
  /**
   * Digest of the bytes about to be stored. Omit it and the key is the path,
   * so a replacement overwrites the object and one URL follows the file.
   * Supply it and the object moves under _v/{digest}/, where each version is
   * its own immutable object. It must cover the stored bytes, not the source:
   * the same photo recompressed at another quality is a different object.
   */
  readonly contentHash?: string | undefined
}

/**
 *   smartimg/김치.jpg              -> smartimg/김치.jpg
 *   smartimg/김치.jpg + 9f3a2c1…   -> _v/9f3a2c1/smartimg/김치.jpg
 *
 * The filename is kept verbatim, extension included: deriving it from the
 * stored format would fold 김치.jpg and 김치.png onto one key. Whether the
 * stored bytes keep the format the name suggests is the uploader's call.
 */
export function buildPathObjectKey(input: PathObjectKeyInput): string {
  if (input.contentHash !== undefined && !CONTENT_HASH.test(input.contentHash)) {
    throw new InvalidKeyError('contentHash must be 7-64 lowercase hex characters')
  }
  const segments = normalizeSourcePath(input.path)
  if (input.contentHash === undefined) return segments.join('/')
  return [VERSION_PREFIX, input.contentHash.slice(0, HASH_LENGTH), ...segments].join('/')
}
