export type StoredImage = {
  readonly key: string
  readonly size: number
  readonly lastModified: Date
}

export type ListResult = {
  readonly objects: readonly StoredImage[]
  readonly folders: readonly string[]
  readonly nextToken: string | null
}

export type PresignedUpload = {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

/**
 * What the presigned URL commits the upload to. Every field here is signed, so
 * the store rejects an upload that declares anything else — the API's checks
 * are worth nothing if the client can simply send different values to S3.
 */
export type PresignPutRequest = {
  readonly key: string
  readonly contentType: string
  /** Exact byte count. The API's size limit is only real because this is signed. */
  readonly contentLength: number
  readonly cacheControl: string
}

export interface ImageStore {
  presignPut(request: PresignPutRequest): Promise<PresignedUpload>
  list(folder: string | null, nextToken?: string): Promise<ListResult>
  delete(key: string): Promise<void>
}

export const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * A key that mirrors a source path is overwritten in place when that file
 * changes, so it cannot claim to be immutable: the URL is meant to follow the
 * file. It gets a short TTL and revalidation instead, which is the price of
 * keeping one stable link per file.
 */
export function mutableCacheControl(maxAgeSeconds: number): string {
  return 'public, max-age=' + String(maxAgeSeconds) + ', must-revalidate'
}
