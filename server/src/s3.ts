import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Config } from './config'
import type {
  ImageStore,
  ListResult,
  PresignedUpload,
  PresignPutRequest,
  StoredImage,
} from './store'

export function createS3Store(config: Config): ImageStore {
  const client = new S3Client(
    config.bucketRegion === undefined ? {} : { region: config.bucketRegion },
  )

  return {
    async presignPut(request: PresignPutRequest): Promise<PresignedUpload> {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: request.key,
        ContentType: request.contentType,
        ContentLength: request.contentLength,
        CacheControl: request.cacheControl,
      })
      const url = await getSignedUrl(client, command, {
        expiresIn: config.presignTtlSeconds,
        // Naming these is the only thing that makes them binding, and it has to
        // be signableHeaders: the S3 presigner unconditionally adds
        // `content-type` to unsignableHeaders, and `cache-control` sits in
        // signature-v4's ALWAYS_UNSIGNABLE_HEADERS. Only an explicit
        // signableHeaders entry survives either exclusion. (unhoistableHeaders,
        // used here before, governs whether x-amz-* headers move into the query
        // string and does nothing at all for these three.)
        signableHeaders: new Set(['content-type', 'cache-control', 'content-length']),
      })
      return {
        url,
        // Content-Length is signed but deliberately absent here: browsers refuse
        // to let a script set it and fill it in from the body instead, which is
        // exactly the value that was signed.
        headers: {
          'Content-Type': request.contentType,
          'Cache-Control': request.cacheControl,
        },
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
