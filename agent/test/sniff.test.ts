import { describe, expect, it } from 'vitest'
import { sniffImageMime } from '../src/sniff'

describe('sniffImageMime', () => {
  it('detects a PNG signature', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(sniffImageMime(png)).toBe('image/png')
  })

  it('detects a JPEG signature', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffImageMime(jpeg)).toBe('image/jpeg')
  })

  it('detects GIF87a and GIF89a', () => {
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe('image/gif')
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
  })

  it('detects WebP from the RIFF/WEBP container', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(sniffImageMime(webp)).toBe('image/webp')
  })

  it('detects AVIF from an ftyp box with an avif brand', () => {
    const avif = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ])
    expect(sniffImageMime(avif)).toBe('image/avif')
  })

  it('detects AVIF when avif is only a compatible brand', () => {
    const avif = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0x00, 0x00, 0x00,
      0x00, 0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x61, 0x66,
    ])
    expect(sniffImageMime(avif)).toBe('image/avif')
  })

  it('returns null for non-image bytes', () => {
    expect(sniffImageMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull()
    expect(sniffImageMime(new Uint8Array())).toBeNull()
  })
})
