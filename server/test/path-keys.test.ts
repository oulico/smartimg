import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/errors'
import { buildPathObjectKey, normalizeListPrefix, normalizeSourcePath } from '../src/keys'

const HASH = '9f3a2c1d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9'

describe('normalizeSourcePath', () => {
  it('lowercases only the share and keeps every other segment verbatim', () => {
    expect(normalizeSourcePath('Public/1.업무보고서/박홍제/monkey.jpg')).toEqual([
      'public',
      '1.업무보고서',
      '박홍제',
      'monkey.jpg',
    ])
  })

  it('accepts a UNC-style path with backslashes', () => {
    expect(normalizeSourcePath('Public\\1.업무보고서\\박홍제\\monkey.jpg')).toEqual([
      'public',
      '1.업무보고서',
      '박홍제',
      'monkey.jpg',
    ])
  })

  it('keeps spaces, which real shares use', () => {
    expect(normalizeSourcePath('Public/오프라인 매장/a.png')).toEqual([
      'public',
      '오프라인 매장',
      'a.png',
    ])
  })

  it('refuses traversal', () => {
    expect(() => normalizeSourcePath('Public/../etc/passwd')).toThrow(ApiError)
  })

  it('refuses a share that would be read as a transform directive', () => {
    expect(() => normalizeSourcePath('fit-in/x/a.jpg')).toThrow(ApiError)
    expect(() => normalizeSourcePath('200x200/a.jpg')).toThrow(ApiError)
  })

  it('needs at least a share and a filename', () => {
    expect(() => normalizeSourcePath('monkey.jpg')).toThrow(ApiError)
  })
})

describe('buildPathObjectKey', () => {
  it('mirrors the share path exactly when no hash is given', () => {
    const key = buildPathObjectKey({
      path: 'Public/1.업무보고서/박홍제/monkey.jpg',
      contentType: 'image/webp',
    })
    expect(key).toBe('public/1.업무보고서/박홍제/monkey.webp')
  })

  it('gives one stable key per file, so a replacement overwrites it', () => {
    const before = buildPathObjectKey({
      path: 'Public/a/b.jpg',
      contentType: 'image/webp',
    })
    const after = buildPathObjectKey({
      path: 'Public/a/b.jpg',
      contentType: 'image/webp',
    })
    expect(after).toBe(before)
  })

  it('appends a short source hash when versioning is asked for', () => {
    const key = buildPathObjectKey({
      path: 'Public/1.업무보고서/박홍제/monkey.jpg',
      contentType: 'image/webp',
      contentHash: HASH,
    })
    expect(key).toBe('public/1.업무보고서/박홍제/monkey.9f3a2c1.webp')
  })

  it('is stable: the same path and source bytes always give the same key', () => {
    const once = buildPathObjectKey({
      path: 'Public/a/b.jpg',
      contentType: 'image/jpeg',
      contentHash: HASH,
    })
    const twice = buildPathObjectKey({
      path: 'Public/a/b.jpg',
      contentType: 'image/jpeg',
      contentHash: HASH,
    })
    expect(once).toBe(twice)
  })

  it('changes when the source content changes, so the old URL stays valid', () => {
    const before = buildPathObjectKey({
      path: 'Public/a/b.jpg',
      contentType: 'image/jpeg',
      contentHash: HASH,
    })
    const after = buildPathObjectKey({
      path: 'Public/a/b.jpg',
      contentType: 'image/jpeg',
      contentHash: 'deadbee' + HASH.slice(7),
    })
    expect(after).not.toBe(before)
  })

  it('takes the extension from the MIME type, never the filename', () => {
    const key = buildPathObjectKey({ path: 'Public/a/photo.jpeg.txt', contentType: 'image/png' })
    expect(key).toBe('public/a/photo.jpeg.png')
  })

  it('refuses a hash that is not hex', () => {
    expect(() =>
      buildPathObjectKey({
        path: 'Public/a/b.jpg',
        contentType: 'image/jpeg',
        contentHash: 'ZZZZZZZ',
      }),
    ).toThrow(ApiError)
  })
})

describe('normalizeListPrefix', () => {
  it('reaches the Korean folders the path rule produces', () => {
    expect(normalizeListPrefix('public/1.업무보고서/박홍제')).toBe('public/1.업무보고서/박홍제')
  })

  it('falls back to the default folder when empty', () => {
    expect(normalizeListPrefix('  ')).toBe('uploads')
  })

  it('refuses traversal', () => {
    expect(() => normalizeListPrefix('public/../secrets')).toThrow(ApiError)
  })
})
