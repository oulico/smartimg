import { Hono } from 'hono'
import { z } from 'zod'
import type { Config } from './config'
import { ApiError } from './errors'
import {
  ALLOWED_MIME_TYPES,
  assertSafeKey,
  buildObjectKey,
  buildPathObjectKey,
  isAllowedImageMime,
  normalizeListPrefix,
} from './keys'
import { CACHE_CONTROL, type ImageStore, mutableCacheControl } from './store'

/**
 * Two ways to name an upload, and the server still builds the key either way.
 * `path` mirrors a NAS share path, so the key is stable and the object is
 * overwritten when the source changes; adding `contentHash` — a digest of the
 * bytes about to be uploaded — versions it under `_v/{digest}/` instead. `filename` is the original mode, where the server invents a UUID.
 */
const PresignBodySchema = z.union([
  z.object({
    path: z.string().trim().min(1).max(1024),
    contentHash: z.string().trim().min(7).max(64).optional(),
    contentType: z.string(),
    size: z.number().int().positive(),
  }),
  z.object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.string(),
    size: z.number().int().positive(),
    folder: z.string(),
  }),
])

const ListQuerySchema = z.object({
  folder: z.string().optional(),
  nextToken: z.string().optional(),
})

export function imagesApi(config: Config, store: ImageStore): Hono {
  const app = new Hono()

  app.post('/presign', async (c) => {
    const body = PresignBodySchema.parse(await c.req.json())
    if (body.size > config.maxUploadBytes) {
      throw new ApiError(
        'invalid_upload',
        400,
        'size exceeds the maximum of ' + String(config.maxUploadBytes) + ' bytes',
      )
    }
    if (!isAllowedImageMime(body.contentType)) {
      throw new ApiError(
        'invalid_upload',
        400,
        'contentType must be one of ' + ALLOWED_MIME_TYPES.join(', '),
      )
    }
    const mirrorsSourcePath = 'path' in body
    const key = mirrorsSourcePath
      ? buildPathObjectKey({
          path: body.path,
          contentType: body.contentType,
          contentHash: body.contentHash,
        })
      : buildObjectKey({
          filename: body.filename,
          contentType: body.contentType,
          folder: body.folder,
        })
    // Only a key nothing will overwrite may promise a year of caching.
    const overwritable = mirrorsSourcePath && body.contentHash === undefined
    const cacheControl = overwritable
      ? mutableCacheControl(config.mutableMaxAgeSeconds)
      : CACHE_CONTROL
    // The declared size is signed, so it is the size S3 will actually accept —
    // the check above is only a limit because of that.
    const { url, headers } = await store.presignPut({
      key,
      contentType: body.contentType,
      contentLength: body.size,
      cacheControl,
    })
    return c.json({ key, method: 'PUT' as const, url, headers })
  })

  app.get('/', async (c) => {
    const query = ListQuerySchema.parse(c.req.query())
    const prefix = normalizeListPrefix(query.folder ?? '')
    const folder = prefix === '' ? null : prefix
    const result = await store.list(folder, query.nextToken)
    return c.json({
      objects: result.objects.map((object) => ({
        key: object.key,
        size: object.size,
        lastModified: object.lastModified.toISOString(),
      })),
      folders: result.folders,
      nextToken: result.nextToken,
    })
  })

  app.delete('/:key{.+}', async (c) => {
    const key = c.req.param('key')
    assertSafeKey(key)
    await store.delete(key)
    return c.body(null, 204)
  })

  return app
}
