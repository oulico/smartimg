import { beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../src/config'
import { createS3Store } from '../src/s3'
import { CACHE_CONTROL, mutableCacheControl } from '../src/store'

/**
 * The mock store cannot check a signature, so these tests sign for real against
 * dummy credentials and read the result out of the URL. What matters is
 * X-Amz-SignedHeaders: a header missing from that list is one the client can
 * change freely, however carefully the API validated it first.
 */
const CONFIG: Config = {
  port: 0,
  bucket: 'smartimg-originals',
  bucketRegion: 'ap-northeast-2',
  apiToken: 'secret',
  mock: false,
  mockCorsOrigin: '',
  maxUploadBytes: 10_485_760,
  presignTtlSeconds: 900,
  mutableMaxAgeSeconds: 60,
}

beforeAll(() => {
  process.env['AWS_ACCESS_KEY_ID'] = 'AKIAIOSFODNN7EXAMPLE'
  process.env['AWS_SECRET_ACCESS_KEY'] = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  delete process.env['AWS_SESSION_TOKEN']
})

async function signedHeadersOf(cacheControl: string): Promise<readonly string[]> {
  const { url } = await createS3Store(CONFIG).presignPut({
    key: 'public/사진/monkey.png',
    contentType: 'image/png',
    contentLength: 2048,
    cacheControl,
  })
  const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? ''
  return signed.split(';')
}

describe('presigned PUT', () => {
  it('signs the content type, so an upload cannot declare another one', async () => {
    expect(await signedHeadersOf(CACHE_CONTROL)).toContain('content-type')
  })

  it('signs the byte count, so the size limit holds at the bucket', async () => {
    expect(await signedHeadersOf(CACHE_CONTROL)).toContain('content-length')
  })

  it('signs the cache policy of an overwritable key, which must not be cached for a year', async () => {
    const cacheControl = mutableCacheControl(60)
    expect(await signedHeadersOf(cacheControl)).toContain('cache-control')
    const { headers } = await createS3Store(CONFIG).presignPut({
      key: 'public/사진/monkey.png',
      contentType: 'image/png',
      contentLength: 2048,
      cacheControl,
    })
    expect(headers['Cache-Control']).toBe(cacheControl)
  })

  it('leaves Content-Length out of the returned headers for the browser to fill in', async () => {
    const { headers } = await createS3Store(CONFIG).presignPut({
      key: 'public/사진/monkey.png',
      contentType: 'image/png',
      contentLength: 2048,
      cacheControl: CACHE_CONTROL,
    })
    expect(Object.keys(headers).map((name) => name.toLowerCase())).toEqual([
      'content-type',
      'cache-control',
    ])
  })
})
