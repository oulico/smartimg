import { describe, expect, it } from 'vitest'
import { loadAgentConfig } from '../src/config'

const BASE_ENV = {
  IMAGE_API_URL: 'http://127.0.0.1:8787/api/',
  IMAGE_CDN_BASE: 'http://127.0.0.1:8787/mock-cdn/',
}

describe('loadAgentConfig', () => {
  it('applies defaults and trims trailing slashes', () => {
    const config = loadAgentConfig(BASE_ENV)
    expect(config.apiBaseUrl).toBe('http://127.0.0.1:8787/api')
    expect(config.cdnBase).toBe('http://127.0.0.1:8787/mock-cdn')
    expect(config.folder).toBe('uploads')
    expect(config.stabilityMs).toBe(1000)
    expect(config.apiToken).toBeUndefined()
  })

  it('expands a leading tilde in AGENT_ROOT into the four watched directories', () => {
    const config = loadAgentConfig({ ...BASE_ENV, AGENT_ROOT: '~/DropRoot' })
    expect(config.dirs.inbox.endsWith('/DropRoot/Inbox')).toBe(true)
    expect(config.dirs.uploaded.endsWith('/DropRoot/Uploaded')).toBe(true)
    expect(config.dirs.failed.endsWith('/DropRoot/Failed')).toBe(true)
    expect(config.dirs.results.endsWith('/DropRoot/Results')).toBe(true)
  })

  it('rejects a non-URL IMAGE_API_URL', () => {
    expect(() => loadAgentConfig({ ...BASE_ENV, IMAGE_API_URL: 'not-a-url' })).toThrow()
  })
})
