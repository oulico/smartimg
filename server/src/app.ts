import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { z } from 'zod'
import { requireAuth } from './auth'
import type { Config } from './config'
import { ApiError } from './errors'
import { assertSafeKey, isAllowedImageMime } from './keys'
import { MockStore } from './mock-store'
import { imagesApi } from './routes'
import { createS3Store } from './s3'
import { CACHE_CONTROL, type ImageStore } from './store'

export function createApp(config: Config): { app: Hono; mockStore: MockStore | null } {
  const app = new Hono()

  app.use(logger())
  if (config.mock) {
    app.use(cors({ origin: config.mockCorsOrigin, exposeHeaders: ['ETag'] }))
  }

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status)
    }
    if (err instanceof z.ZodError) {
      return c.json({ error: { code: 'invalid_request', message: z.prettifyError(err) } }, 400)
    }
    console.error('[smartimg] unhandled error:', err)
    return c.json({ error: { code: 'internal', message: 'internal server error' } }, 500)
  })

  app.use('/api/*', requireAuth(config.apiToken))

  const mockStore = config.mock ? new MockStore('http://127.0.0.1:' + String(config.port)) : null
  const store: ImageStore = mockStore ?? createS3Store(config)
  app.route('/api/images', imagesApi(config, store))

  if (mockStore !== null) {
    app.put('/mock-put/*', async (c) => {
      const key = c.req.path.replace(/^\/mock-put\//, '')
      assertSafeKey(key)
      const contentType = c.req.header('Content-Type') ?? ''
      if (!isAllowedImageMime(contentType)) {
        throw new ApiError('invalid_upload', 400, 'Content-Type must be an allowed image type')
      }
      const body = new Uint8Array(await c.req.arrayBuffer())
      if (body.byteLength === 0 || body.byteLength > config.maxUploadBytes) {
        throw new ApiError('invalid_upload', 400, 'request body exceeds the upload size limit')
      }
      mockStore.put(key, body, contentType, c.req.header('Cache-Control') ?? CACHE_CONTROL)
      const digest = await crypto.subtle.digest('SHA-256', body)
      const etag = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      return c.body(null, 200, { ETag: '"' + etag + '"' })
    })

    app.get('/mock-cdn/*', (c) => {
      const segments = c.req.path.replace(/^\/mock-cdn\//, '').split('/')
      const key = mockStore.resolveKeyFromPath(segments)
      const object = key === null ? undefined : mockStore.read(key)
      if (object === undefined) {
        return c.text('not found', 404)
      }
      return c.body(object.body, 200, {
        'Content-Type': object.contentType,
        'Cache-Control': object.cacheControl,
      })
    })
  }

  return { app, mockStore }
}
