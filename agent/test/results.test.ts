import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Batch, type UploadResult, writeBatchResults } from '../src/results'

async function makeResultsDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'smartimg-results-'))
  const dir = join(base, 'results')
  await mkdir(dir, { recursive: true })
  return dir
}

function batch(id: string, finishedAt: Date, results: readonly UploadResult[]): Batch {
  return { id, finishedAt, cdnBase: 'http://cdn.test', results }
}

describe('writeBatchResults', () => {
  it('writes JSON and Markdown containing keys and CDN URLs per preset', async () => {
    const dir = await makeResultsDir()
    const results: readonly UploadResult[] = [
      {
        status: 'uploaded',
        source: 'photo.png',
        key: 'uploads/2026/09/uuid-photo.png',
        url: 'http://cdn.test/uploads/2026/09/uuid-photo.png',
      },
      { status: 'failed', source: 'notes.txt', error: 'unsupported file type' },
    ]

    const paths = await writeBatchResults(
      dir,
      batch('batch-1', new Date('2026-09-09T13:00:00Z'), results),
    )

    const json = JSON.parse(await readFile(paths.jsonPath, 'utf8')) as {
      batchId: string
      results: readonly {
        status: string
        source: string
        key?: string
        url?: string
        presets?: Record<string, string>
        error?: string
      }[]
    }
    expect(json.batchId).toBe('batch-1')
    const uploaded = json.results.find((entry) => entry.status === 'uploaded')
    expect(uploaded?.key).toBe('uploads/2026/09/uuid-photo.png')
    expect(uploaded?.url).toBe('http://cdn.test/uploads/2026/09/uuid-photo.png')
    expect(uploaded?.presets?.['hero']).toBe(
      'http://cdn.test/fit-in/1920x0/filters:format(auto):quality(80)/uploads/2026/09/uuid-photo.png',
    )
    const failed = json.results.find((entry) => entry.status === 'failed')
    expect(failed?.error).toBe('unsupported file type')

    const markdown = await readFile(paths.mdPath, 'utf8')
    expect(markdown).toContain('uploads/2026/09/uuid-photo.png')
    expect(markdown).toContain(
      'http://cdn.test/fit-in/1920x0/filters:format(auto):quality(80)/uploads/2026/09/uuid-photo.png',
    )
    expect(markdown).toContain('notes.txt')
  })

  it('never overwrites an existing batch file', async () => {
    const dir = await makeResultsDir()
    const results: readonly UploadResult[] = [{ status: 'failed', source: 'a.png', error: 'boom' }]

    const first = await writeBatchResults(dir, batch('batch-x', new Date(), results))
    await writeFile(first.jsonPath, 'sentinel')
    const second = await writeBatchResults(dir, batch('batch-x', new Date(), results))

    expect(second.jsonPath).not.toBe(first.jsonPath)
    expect(await readFile(first.jsonPath, 'utf8')).toBe('sentinel')
  })

  it('lists only its own files in the results directory', async () => {
    const dir = await makeResultsDir()
    await writeFile(join(dir, 'keep.txt'), 'x')
    await writeBatchResults(
      dir,
      batch('batch-y', new Date(), [{ status: 'failed', source: 'a.png', error: 'boom' }]),
    )
    const names = await readdir(dir)
    expect(names).toContain('keep.txt')
    expect(names.filter((name) => name.startsWith('batch-y')).length).toBe(2)
  })
})
