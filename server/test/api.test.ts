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
    expect(body.key).toMatch(/^products\/\d{4}\/\d{2}\/[0-9a-f-]+-shoe\.png$/)
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

    const rootListed = await app.request('/api/images?folder=products', { headers: AUTH })
    const rootBody = (await rootListed.json()) as { folders: string[] }
    expect(rootBody.folders.length).toBeGreaterThan(0)

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
