import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentDirs } from '../src/config'
import { UploadPipeline } from '../src/pipeline'
import type { UploadedImage, UploadRequest } from '../src/uploader'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const NOT_AN_IMAGE = new TextEncoder().encode('definitely not image bytes')

async function makeDirs(): Promise<AgentDirs> {
  const root = await mkdtemp(join(tmpdir(), 'smartimg-pipeline-'))
  const dirs = {
    inbox: join(root, 'Inbox'),
    uploaded: join(root, 'Uploaded'),
    failed: join(root, 'Failed'),
    results: join(root, 'Results'),
  }
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })))
  return dirs
}

function fakeUploader(): (request: UploadRequest) => Promise<UploadedImage> {
  return async (request) => {
    const extension = request.contentType === 'image/png' ? 'png' : 'img'
    const key = 'uploads/2026/09/' + request.filename.replace(/\.[^.]+$/, '') + '-x.' + extension
    return { key, url: 'http://cdn.test/' + key }
  }
}

async function waitFor(predicate: () => Promise<boolean>, deadlineMs = 2000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await predicate()) return
    if (Date.now() - start > deadlineMs) {
      throw new Error('waitFor deadline exceeded')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function putFile(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

type BatchJson = {
  readonly results: readonly {
    readonly status: string
    readonly source: string
    readonly key?: string
    readonly url?: string
    readonly error?: string
  }[]
}

describe('UploadPipeline', () => {
  it('uploads valid images, quarantines invalid ones, and writes one batch result', async () => {
    const dirs = await makeDirs()
    const pipeline = new UploadPipeline(
      { dirs, cdnBase: 'http://cdn.test', settleMs: 30 },
      fakeUploader(),
    )

    pipeline.enqueue(await putFile(dirs.inbox, 'a.png', PNG_BYTES))
    pipeline.enqueue(await putFile(dirs.inbox, 'c.txt', NOT_AN_IMAGE))
    pipeline.enqueue(await putFile(dirs.inbox, 'b.png', PNG_BYTES))
    await pipeline.idle()
    await pipeline.close()

    expect(await readdir(dirs.uploaded)).toEqual(['a.png', 'b.png'])
    expect(await readdir(dirs.failed)).toEqual(['c.txt'])
    const resultFiles = await readdir(dirs.results)
    expect(resultFiles.filter((name) => name.endsWith('.json'))).toHaveLength(1)
    expect(resultFiles.filter((name) => name.endsWith('.md'))).toHaveLength(1)
    const jsonPath = join(dirs.results, resultFiles.find((name) => name.endsWith('.json')) ?? '')
    const batch = JSON.parse(await readFile(jsonPath, 'utf8')) as BatchJson
    expect(batch.results).toHaveLength(3)
    const uploaded = batch.results.filter((entry) => entry.status === 'uploaded')
    expect(uploaded.map((entry) => entry.source)).toEqual(['a.png', 'b.png'])
    expect(uploaded.every((entry) => entry.url === 'http://cdn.test/' + entry.key)).toBe(true)
    const failed = batch.results.find((entry) => entry.status === 'failed')
    expect(failed?.source).toBe('c.txt')
  })

  it('opens a separate batch when files arrive after the previous batch settled', async () => {
    const dirs = await makeDirs()
    const pipeline = new UploadPipeline(
      { dirs, cdnBase: 'http://cdn.test', settleMs: 30 },
      fakeUploader(),
    )

    pipeline.enqueue(await putFile(dirs.inbox, 'first.png', PNG_BYTES))
    await pipeline.idle()
    pipeline.enqueue(await putFile(dirs.inbox, 'second.png', PNG_BYTES))
    await pipeline.idle()
    await pipeline.close()

    const jsonFiles = (await readdir(dirs.results)).filter((name) => name.endsWith('.json'))
    expect(jsonFiles).toHaveLength(2)
    for (const name of jsonFiles) {
      const batch = JSON.parse(await readFile(join(dirs.results, name), 'utf8')) as BatchJson
      expect(batch.results).toHaveLength(1)
    }
  })

  it('prefixes a short UUID when Uploaded already holds the same filename', async () => {
    const dirs = await makeDirs()
    await writeFile(join(dirs.uploaded, 'a.png'), 'existing')
    const pipeline = new UploadPipeline(
      { dirs, cdnBase: 'http://cdn.test', settleMs: 30 },
      fakeUploader(),
    )

    pipeline.enqueue(await putFile(dirs.inbox, 'a.png', PNG_BYTES))
    await pipeline.idle()
    await pipeline.close()

    const names = await readdir(dirs.uploaded)
    expect(names).toHaveLength(2)
    expect(names.some((name) => /^[0-9a-f]{8}-a\.png$/.test(name))).toBe(true)
  })

  it('close() writes the pending batch without waiting for the settle window', async () => {
    const dirs = await makeDirs()
    const pipeline = new UploadPipeline(
      { dirs, cdnBase: 'http://cdn.test', settleMs: 60_000 },
      fakeUploader(),
    )

    pipeline.enqueue(await putFile(dirs.inbox, 'a.png', PNG_BYTES))
    await waitFor(async () => (await readdir(dirs.uploaded)).length === 1)
    await pipeline.close()

    expect((await readdir(dirs.results)).filter((name) => name.endsWith('.json'))).toHaveLength(1)
  })
})
