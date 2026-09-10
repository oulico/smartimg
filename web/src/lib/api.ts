import ky from 'ky'

export type ImageObject = {
  readonly key: string
  readonly size: number
  readonly lastModified: string
}

export type ListImagesResponse = {
  readonly objects: readonly ImageObject[]
  readonly folders: readonly string[]
  readonly nextToken: string | null
}

export type PresignRequest = {
  readonly filename: string
  readonly contentType: string
  readonly size: number
  readonly folder: string
}

export type PresignResponse = {
  readonly key: string
  readonly method: 'PUT'
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

const token = import.meta.env.VITE_IMAGE_API_TOKEN ?? ''

const client = ky.create({
  prefixUrl: '/api',
  headers: token === '' ? {} : { Authorization: 'Bearer ' + token },
})

/**
 * One page. A response with a nextToken has more behind it: pass that token
 * back to get the next page, which is what the images list does as you reach
 * the end of it.
 */
export function listImages(
  folder: string | null,
  nextToken?: string | undefined,
): Promise<ListImagesResponse> {
  const searchParams: Record<string, string> = {}
  if (folder !== null) searchParams['folder'] = folder
  if (nextToken !== undefined) searchParams['nextToken'] = nextToken
  return client.get('images', { searchParams }).json<ListImagesResponse>()
}

export function presignUpload(body: PresignRequest): Promise<PresignResponse> {
  return client.post('images/presign', { json: body }).json<PresignResponse>()
}

export async function deleteImage(key: string): Promise<void> {
  await client.delete('images/' + key)
}
