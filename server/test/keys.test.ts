import { describe, expect, it } from 'vitest'
import { assertSafeKey, buildObjectKey, normalizeUploadPrefix, sanitizeFilename } from '../src/keys'

const FIXED_UUID = '0192f0c1-0000-7000-8000-000000000000'

describe('buildObjectKey', () => {
  it('builds a collision-safe key when given a messy original filename', () => {
    const key = buildObjectKey({
      filename: 'Hero Product FINAL!!..JPG',
      contentType: 'image/jpeg',
      folder: 'Products',
      uuid: FIXED_UUID,
    })
    expect(key).toBe('Products/0192f0c1-0000-7000-8000-000000000000-hero-product-final.jpg')
  })

  it('derives the extension from the MIME type, never from the filename', () => {
    const key = buildObjectKey({
      filename: 'sneaky.png',
      contentType: 'image/webp',
      folder: 'products',
      uuid: FIXED_UUID,
    })
    expect(key.endsWith('-sneaky.webp')).toBe(true)
  })

  it('drops directory components from the filename', () => {
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('passwd')
  })
})

describe('normalizeUploadPrefix', () => {
  // The prefix being browsed is where the upload goes, so it has to accept
  // every folder a listing can show — the NAS mirrors included.
  it('keeps the browsed prefix as it is, Korean and dates included', () => {
    expect(normalizeUploadPrefix('smartimg/상품/여름')).toBe('smartimg/상품/여름')
    expect(normalizeUploadPrefix('uploads/2026/09')).toBe('uploads/2026/09')
    expect(normalizeUploadPrefix('/products/')).toBe('products')
  })

  it('has no default: nothing is filed at the root', () => {
    expect(() => normalizeUploadPrefix(undefined)).toThrow(/folder is required/)
    expect(() => normalizeUploadPrefix('  ')).toThrow(/folder is required/)
  })

  it('rejects traversal, unusable characters and reserved first segments', () => {
    expect(() => normalizeUploadPrefix('..')).toThrow()
    expect(() => normalizeUploadPrefix('products/../users')).toThrow()
    expect(() => normalizeUploadPrefix('_v/abc')).toThrow()
    expect(() => normalizeUploadPrefix('200x200/a')).toThrow()
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
