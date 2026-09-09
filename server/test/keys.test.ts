import { describe, expect, it } from 'vitest'
import { assertSafeKey, buildObjectKey, normalizeFolder, sanitizeFilename } from '../src/keys'

const FIXED_NOW = new Date('2026-09-09T00:00:00Z')
const FIXED_UUID = '0192f0c1-0000-7000-8000-000000000000'

describe('buildObjectKey', () => {
  it('builds a collision-safe key when given a messy original filename', () => {
    const key = buildObjectKey({
      filename: 'Hero Product FINAL!!..JPG',
      contentType: 'image/jpeg',
      folder: 'Products',
      now: FIXED_NOW,
      uuid: FIXED_UUID,
    })
    expect(key).toBe('products/2026/09/0192f0c1-0000-7000-8000-000000000000-hero-product-final.jpg')
  })

  it('derives the extension from the MIME type, never from the filename', () => {
    const key = buildObjectKey({
      filename: 'sneaky.png',
      contentType: 'image/webp',
      now: FIXED_NOW,
      uuid: FIXED_UUID,
    })
    expect(key.endsWith('-sneaky.webp')).toBe(true)
  })

  it('drops directory components from the filename', () => {
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('passwd')
  })
})

describe('normalizeFolder', () => {
  it('normalizes case, slashes and defaults', () => {
    expect(normalizeFolder('/Products/')).toBe('products')
    expect(normalizeFolder('  ')).toBe('uploads')
  })

  it('rejects traversal and unsafe segments', () => {
    expect(() => normalizeFolder('..')).toThrow()
    expect(() => normalizeFolder('products/../users')).toThrow()
    expect(() => normalizeFolder('a/b/c/d/e')).toThrow()
  })
})

describe('assertSafeKey', () => {
  it('accepts a normal nested key', () => {
    expect(() => assertSafeKey('products/2026/09/uuid-shoe.jpg')).not.toThrow()
  })

  it('rejects traversal, absolute paths and empty segments', () => {
    expect(() => assertSafeKey('/products/x.png')).toThrow()
    expect(() => assertSafeKey('products//x.png')).toThrow()
    expect(() => assertSafeKey('products/../x.png')).toThrow()
    expect(() => assertSafeKey('')).toThrow()
  })
})
