import { Hono } from 'hono'
import { z } from 'zod'
import type { Config } from './config'
import { ApiError } from './errors'
import {
  ALLOWED_MIME_TYPES,
  assertSafeKey,
  buildObjectKey,
  isAllowedImageMime,
  normalizeFolder,
} from './keys'
import type { ImageStore } from './store'

const PresignBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string(),
  size: z.number().int().positive(),
  folder: z.string().optional(),
})

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
    const key = buildObjectKey({
      filename: body.filename,
      contentType: body.contentType,
      folder: body.folder,
    })
    const { url, headers } = await store.presignPut(key, body.contentType)
    return c.json({ key, method: 'PUT' as const, url, headers })
  })

  app.get('/', async (c) => {
    const query = ListQuerySchema.parse(c.req.query())
    const folder = query.folder === undefined ? null : normalizeFolder(query.folder)
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
