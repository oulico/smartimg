import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Config } from '../src/config'

const CONFIG: Config = {
  port: 0,
  bucket: '',
  bucketRegion: undefined,
  apiToken: undefined,
  mock: true,
  mockCorsOrigin: 'http://localhost:5173',
  maxUploadBytes: 10_485_760,
  presignTtlSeconds: 900,
  mutableMaxAgeSeconds: 60,
}

const PATH = 'Public/1.업무보고서/박홍제/monkey.png'

function png(marker: number): Uint8Array<ArrayBuffer> {
  // PNG magic followed by a marker byte, so two calls give genuinely different
  // bytes under the same filename.
  const bytes = new Uint8Array(new ArrayBuffer(32))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes[8] = marker
  return bytes
}

async function put(
  app: ReturnType<typeof createApp>['app'],
  presigned: { url: string; headers: Record<string, string> },
  body: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const response = await app.request(presigned.url.replace('http://localhost', ''), {
    method: 'PUT',
    headers: presigned.headers,
    body,
  })
  expect(response.status).toBe(200)
}

async function fetchStored(
  app: ReturnType<typeof createApp>['app'],
  key: string,
): Promise<Response> {
  return app.request('/mock-cdn/' + key.split('/').map(encodeURIComponent).join('/'))
}

async function presign(app: ReturnType<typeof createApp>['app'], body: unknown) {
  const response = await app.request('/api/images/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { key: string; url: string; headers: Record<string, string> }
}

describe('a path-mirrored key follows the source file', () => {
  it('keeps one URL and serves the new bytes after a replacement', async () => {
    const { app } = createApp(CONFIG)

    const first = await presign(app, { path: PATH, contentType: 'image/png', size: 32 })
    expect(first.key).toBe('public/1.업무보고서/박홍제/monkey.png')
    await put(app, first, png(1))
    expect(new Uint8Array(await (await fetchStored(app, first.key)).arrayBuffer())[8]).toBe(1)

    // The same source path a second time: same key, so the same URL.
    const second = await presign(app, { path: PATH, contentType: 'image/png', size: 32 })
    expect(second.key).toBe(first.key)
    await put(app, second, png(2))

    const served = await fetchStored(app, first.key)
    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())[8]).toBe(2)
  })

  it('is not advertised as immutable, since it can be overwritten', async () => {
    const { app } = createApp(CONFIG)
    const presigned = await presign(app, {
      path: PATH,
      contentType: 'image/png',
      size: 32,
    })
    expect(presigned.headers['Cache-Control']).toBe('public, max-age=60, must-revalidate')
    expect(presigned.headers['Cache-Control']).not.toContain('immutable')
  })

  it('still promises a year of caching for a versioned key', async () => {
    const { app } = createApp(CONFIG)
    const presigned = await presign(app, {
      path: PATH,
      contentType: 'image/png',
      contentHash: 'deadbee',
      size: 32,
    })
    expect(presigned.key).toBe('_v/deadbee/public/1.업무보고서/박홍제/monkey.png')
    expect(presigned.headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
  })

  it('still promises a year of caching for a UUID key', async () => {
    const { app } = createApp(CONFIG)
    const presigned = await presign(app, {
      filename: 'monkey.png',
      contentType: 'image/png',
      size: 32,
    })
    expect(presigned.headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
  })

  it('serves each object with the cache policy it was stored under', async () => {
    const { app } = createApp(CONFIG)
    const presigned = await presign(app, {
      path: PATH,
      contentType: 'image/png',
      size: png(3).byteLength,
    })

    await put(app, presigned, png(3))

    const got = await fetchStored(app, presigned.key)
    expect(got.status).toBe(200)
    expect(got.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate')
  })
})
