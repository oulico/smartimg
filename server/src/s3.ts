import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Config } from './config'
import {
  CACHE_CONTROL,
  type ImageStore,
  type ListResult,
  type PresignedUpload,
  type StoredImage,
} from './store'

export function createS3Store(config: Config): ImageStore {
  const client = new S3Client(
    config.bucketRegion === undefined ? {} : { region: config.bucketRegion },
  )

  return {
    async presignPut(key: string, contentType: string): Promise<PresignedUpload> {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        CacheControl: CACHE_CONTROL,
      })
      const url = await getSignedUrl(client, command, {
        expiresIn: config.presignTtlSeconds,
        unhoistableHeaders: new Set(['content-type', 'cache-control']),
      })
      return {
        url,
        headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
      }
    },

    async list(folder: string | null, nextToken?: string): Promise<ListResult> {
      const prefix = folder === null ? '' : folder + '/'
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ...(nextToken === undefined ? {} : { ContinuationToken: nextToken }),
        }),
      )
      const objects: StoredImage[] = (result.Contents ?? [])
        .filter((item) => (item.Key ?? '').endsWith('/') === false)
        .map((item) => ({
          key: item.Key ?? '',
          size: item.Size ?? 0,
          lastModified: item.LastModified ?? new Date(0),
        }))
      const folders = (result.CommonPrefixes ?? [])
        .map((item) => (item.Prefix ?? '').replace(/\/$/, ''))
        .filter((item) => item !== '')
      const nextTokenOut =
        result.IsTruncated === true ? (result.NextContinuationToken ?? null) : null
      return { objects, folders, nextToken: nextTokenOut }
    },

    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    },
  }
}
