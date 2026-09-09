import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basename, formatBytes } from '../src/lib/format'
import { image } from '../src/lib/images'

const CDN = 'https://cdn.example.com'

describe('image url builder', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_IMAGE_CDN_URL', CDN)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the bare object URL when no preset is given', () => {
    expect(image('uploads/2026/09/a-file.png')).toBe(CDN + '/uploads/2026/09/a-file.png')
  })

  it('builds a crop transform for the thumbnail preset', () => {
    expect(image('k.png', { preset: 'thumbnail' })).toBe(
      CDN + '/200x200/filters:format(auto):quality(75)/k.png',
    )
  })

  it('builds a crop transform for the productCard preset', () => {
    expect(image('k.png', { preset: 'productCard' })).toBe(
      CDN + '/480x480/filters:format(auto):quality(80)/k.png',
    )
  })

  it('builds a fit-in transform for the productDetail preset', () => {
    expect(image('k.png', { preset: 'productDetail' })).toBe(
      CDN + '/fit-in/1200x0/filters:format(auto):quality(80)/k.png',
    )
  })

  it('builds a fit-in transform for the hero preset', () => {
    expect(image('k.png', { preset: 'hero' })).toBe(
      CDN + '/fit-in/1920x0/filters:format(auto):quality(80)/k.png',
    )
  })

  it('strips a trailing slash from the CDN base', () => {
    vi.stubEnv('VITE_IMAGE_CDN_URL', CDN + '/')
    expect(image('k.png')).toBe(CDN + '/k.png')
  })

  it('encodes each key segment', () => {
    expect(image('my folder/my file.png')).toBe(CDN + '/my%20folder/my%20file.png')
  })

  it('throws when the CDN base is not configured', () => {
    vi.stubEnv('VITE_IMAGE_CDN_URL', '')
    expect(() => image('k.png')).toThrow()
  })
})

describe('format helpers', () => {
  it('formats bytes at each unit boundary', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('returns the last key segment as the filename', () => {
    expect(basename('uploads/2026/09/abc-photo.jpg')).toBe('abc-photo.jpg')
  })
})
