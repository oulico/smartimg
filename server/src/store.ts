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

export interface ImageStore {
  presignPut(key: string, contentType: string): Promise<PresignedUpload>
  list(folder: string | null, nextToken?: string): Promise<ListResult>
  delete(key: string): Promise<void>
}

export const CACHE_CONTROL = 'public, max-age=31536000, immutable'
