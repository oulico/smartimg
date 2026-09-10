import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  it('refuses to start against a real bucket without an API token', () => {
    expect(() => loadConfig({ IMAGE_BUCKET: 'smartimg-originals' })).toThrow(
      /IMAGE_API_TOKEN is required/,
    )
  })

  it('accepts a real bucket once a token is set', () => {
    const config = loadConfig({ IMAGE_BUCKET: 'smartimg-originals', IMAGE_API_TOKEN: 'secret' })
    expect(config.mock).toBe(false)
    expect(config.apiToken).toBe('secret')
  })

  it('still allows an unauthenticated mock server for local development', () => {
    expect(loadConfig({ MOCK_S3: 'true' }).apiToken).toBeUndefined()
  })
})
