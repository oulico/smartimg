import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { createUploader } from '../src/uploader'

type FakeServer = {
  readonly server: Server
  readonly baseUrl: string
  readonly requests: { readonly path: string; readonly auth: string }[]
}

const servers: Server[] = []

afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

async function startFakeApi(
  handle: (
    request: FakeServer['requests'][number],
    respond: (status: number, body: string, contentType?: string) => void,
  ) => void,
): Promise<FakeServer> {
  const requests: FakeServer['requests'] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const seen = { path: request.url ?? '', auth: request.headers.authorization ?? '' }
      requests.push(seen)
      handle(seen, (status, body, contentType) => {
        response.writeHead(status, { 'Content-Type': contentType ?? 'application/json' })
        response.end(body)
      })
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: 'http://127.0.0.1:' + String(port), requests }
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('createUploader', () => {
  it('presigns, PUTs the bytes, and returns the key with a CDN url', async () => {
    const api = await startFakeApi((request, respond) => {
      if (request.path === '/api/images/presign') {
        respond(
          200,
          JSON.stringify({
            key: 'uploads/2026/09/abc-photo.png',
            method: 'PUT',
            url: apiPresignTarget,
            headers: { 'Content-Type': 'image/png' },
          }),
        )
        return
      }
      respond(200, '', 'text/plain')
    })
    const apiPresignTarget = api.baseUrl + '/put-uploads/2026/09/abc-photo.png'
    const upload = createUploader({
      apiBaseUrl: api.baseUrl + '/api',
      apiToken: 'secret-token',
      folder: 'uploads',
      cdnBase: 'http://cdn.test/',
    })

    const uploaded = await upload({
      filename: 'photo.png',
      contentType: 'image/png',
      bytes: PNG_BYTES,
    })

    expect(uploaded.key).toBe('uploads/2026/09/abc-photo.png')
    expect(uploaded.url).toBe('http://cdn.test/uploads/2026/09/abc-photo.png')
    expect(api.requests[0]?.auth).toBe('Bearer secret-token')
    expect(api.requests[1]?.path).toBe('/put-uploads/2026/09/abc-photo.png')
  })

  it('surfaces the API error message when presign rejects the file', async () => {
    const api = await startFakeApi((_request, respond) => {
      respond(
        400,
        JSON.stringify({ error: { code: 'invalid_upload', message: 'size exceeds maximum' } }),
      )
    })
    const upload = createUploader({
      apiBaseUrl: api.baseUrl + '/api',
      apiToken: undefined,
      folder: 'uploads',
      cdnBase: 'http://cdn.test',
    })

    await expect(
      upload({ filename: 'big.png', contentType: 'image/png', bytes: PNG_BYTES }),
    ).rejects.toThrow('size exceeds maximum')
  })

  it('reports a failed object PUT with its HTTP status', async () => {
    const api = await startFakeApi((request, respond) => {
      if (request.path === '/api/images/presign') {
        respond(
          200,
          JSON.stringify({
            key: 'uploads/2026/09/x.png',
            method: 'PUT',
            url: api.baseUrl + '/put/x.png',
            headers: { 'Content-Type': 'image/png' },
          }),
        )
        return
      }
      respond(403, 'denied', 'text/plain')
    })
    const upload = createUploader({
      apiBaseUrl: api.baseUrl + '/api',
      apiToken: undefined,
      folder: 'uploads',
      cdnBase: 'http://cdn.test',
    })

    await expect(
      upload({ filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES }),
    ).rejects.toThrow('403')
  })
})
