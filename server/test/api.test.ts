import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { loadConfig } from '../src/config'

const config = loadConfig({
  MOCK_S3: 'true',
  IMAGE_API_TOKEN: 'secret-token',
  MAX_UPLOAD_BYTES: '1000',
})
const { app } = createApp(config)
const AUTH = { Authorization: 'Bearer secret-token' }

async function presignAndUpload(body: Record<string, unknown>): Promise<string> {
  const presigned = await app.request('/api/images/presign', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(presigned.status).toBe(200)
  const presignBody = (await presigned.json()) as {
    key: string
    url: string
    headers: Record<string, string>
  }
  const put = await app.request(presignBody.url.replace('http://127.0.0.1:8787', ''), {
    method: 'PUT',
    headers: presignBody.headers,
    body: new Uint8Array([1, 2, 3]),
  })
  expect(put.status).toBe(200)
  return presignBody.key
}

describe('POST /api/images/presign', () => {
  it('returns a presigned PUT with a server-generated key', async () => {
    const response = await app.request('/api/images/presign', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'shoe.png',
        contentType: 'image/png',
        size: 300,
        folder: 'products',
      }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { key: string; method: string; url: string }
    expect(body.method).toBe('PUT')
    expect(body.key).toMatch(/^products\/[0-9a-f-]+-shoe\.png$/)
    expect(body.url).toContain('/mock-put/')
  })

  it('rejects a disallowed MIME type', async () => {
    const response = await app.request('/api/images/presign', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'movie.mp4', contentType: 'video/mp4', size: 10 }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects an oversized upload', async () => {
    const response = await app.request('/api/images/presign', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'big.png', contentType: 'image/png', size: 2000 }),
    })
    expect(response.status).toBe(400)
  })
})

describe('auth', () => {
  it('rejects requests without the bearer token', async () => {
    const response = await app.request('/api/images')
    expect(response.status).toBe(401)
  })
})

/**
 * The mock enforces what the signature enforces at S3, so these cover the gap
 * that used to exist: the API validated the declared size, type and cache
 * policy, and then nothing held the upload to them.
 */
describe('an upload is held to what was presigned', () => {
  async function presign(size: number): Promise<{ url: string; headers: Record<string, string> }> {
    const response = await app.request('/api/images/presign', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'claim.png',
        contentType: 'image/png',
        size,
        folder: 'products',
      }),
    })
    expect(response.status).toBe(200)
    return (await response.json()) as { url: string; headers: Record<string, string> }
  }

  async function put(
    presigned: { url: string; headers: Record<string, string> },
    headers: Record<string, string>,
    body: Uint8Array,
  ): Promise<Response> {
    return await app.request(presigned.url.replace('http://127.0.0.1:8787', ''), {
      method: 'PUT',
      headers: { ...presigned.headers, ...headers },
      body,
    })
  }

  it('refuses a body that is not the size the URL was issued for', async () => {
    const presigned = await presign(3)
    const response = await put(presigned, {}, new Uint8Array([1, 2, 3, 4, 5, 6]))
    expect(response.status).toBe(403)
  })

  it('refuses an upload that swaps the declared content type', async () => {
    const presigned = await presign(3)
    const response = await put(
      presigned,
      { 'Content-Type': 'text/html' },
      new Uint8Array([1, 2, 3]),
    )
    expect(response.status).toBe(403)
  })

  // A path-mirrored key is overwritten when the source file changes, so it is
  // signed with a short TTL. Letting a client raise that to a year would strand
  // the old image in caches that the replacement can never reach.
  it('refuses to turn an overwritable key into a year of immutability', async () => {
    const response = await app.request('/api/images/presign', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'public/사진/monkey.png', contentType: 'image/png', size: 3 }),
    })
    expect(response.status).toBe(200)
    const presigned = (await response.json()) as { url: string; headers: Record<string, string> }
    expect(presigned.headers['Cache-Control']).toBe('public, max-age=60, must-revalidate')

    const forged = await put(
      presigned,
      { 'Cache-Control': 'public, max-age=31536000, immutable' },
      new Uint8Array([1, 2, 3]),
    )
    expect(forged.status).toBe(403)
  })

  it('accepts the upload the URL was actually issued for', async () => {
    const presigned = await presign(3)
    expect((await put(presigned, {}, new Uint8Array([1, 2, 3]))).status).toBe(200)
  })
})

describe('upload, list, delete flow', () => {
  it('returns and exposes an ETag so browser uploads can detect success', async () => {
    const presigned = await app.request('/api/images/presign', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'tag.png',
        contentType: 'image/png',
        size: 3,
        folder: 'products',
      }),
    })
    expect(presigned.status).toBe(200)
    const presignBody = (await presigned.json()) as {
      url: string
      headers: Record<string, string>
    }
    const put = await app.request(presignBody.url.replace('http://127.0.0.1:8787', ''), {
      method: 'PUT',
      headers: { ...presignBody.headers, Origin: 'http://localhost:5174' },
      body: new Uint8Array([1, 2, 3]),
    })
    expect(put.status).toBe(200)
    expect(put.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/)
    expect(put.headers.get('Access-Control-Expose-Headers')).toContain('ETag')
  })

  it('uploads through the presigned URL, lists, and deletes', async () => {
    const key = await presignAndUpload({
      filename: 'hero.png',
      contentType: 'image/png',
      size: 3,
      folder: 'products',
    })

    const parentFolder = key.slice(0, key.lastIndexOf('/'))
    const listed = await app.request('/api/images?folder=' + encodeURIComponent(parentFolder), {
      headers: AUTH,
    })
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as {
      objects: { key: string; size: number; lastModified: string }[]
      folders: string[]
    }
    expect(listBody.objects.map((object) => object.key)).toContain(key)

    const rootListed = await app.request('/api/images', { headers: AUTH })
    const rootBody = (await rootListed.json()) as { folders: string[] }
    expect(rootBody.folders).toContain('products')

    const deleted = await app.request('/api/images/' + key, { method: 'DELETE', headers: AUTH })
    expect(deleted.status).toBe(204)

    const afterDelete = await app.request(
      '/api/images?folder=' + encodeURIComponent(parentFolder),
      {
        headers: AUTH,
      },
    )
    expect(afterDelete.status).toBe(200)
    const afterBody = (await afterDelete.json()) as { objects: { key: string }[] }
    expect(afterBody.objects.map((object) => object.key)).not.toContain(key)
  })
})
