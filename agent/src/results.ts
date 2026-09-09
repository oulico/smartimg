import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildImageUrl, IMAGE_PRESETS, type ImagePreset } from '@smartimg/shared'
import { hasErrnoCode } from './errno'

export type UploadResult =
  | {
      readonly status: 'uploaded'
      readonly source: string
      readonly key: string
      readonly url: string
    }
  | {
      readonly status: 'failed'
      readonly source: string
      readonly error: string
    }

export type Batch = {
  readonly id: string
  readonly finishedAt: Date
  readonly cdnBase: string
  readonly results: readonly UploadResult[]
}

export type BatchPaths = {
  readonly jsonPath: string
  readonly mdPath: string
}

const PRESET_IDS = [
  'thumbnail',
  'productCard',
  'productDetail',
  'hero',
] as const satisfies readonly ImagePreset[]

function assertNever(value: never): never {
  throw new Error('unexpected variant: ' + String(value))
}

async function writeExclusive(path: string, contents: string): Promise<boolean> {
  try {
    await writeFile(path, contents, { flag: 'wx' })
    return true
  } catch (error) {
    if (hasErrnoCode(error, 'EEXIST')) {
      return false
    }
    throw error
  }
}

type JsonEntry = {
  readonly status: string
  readonly source: string
  readonly key?: string
  readonly url?: string
  readonly presets?: Readonly<Record<string, string>>
  readonly error?: string
}

function toJsonEntry(result: UploadResult, cdnBase: string): JsonEntry {
  switch (result.status) {
    case 'uploaded': {
      const presets: Record<string, string> = {}
      for (const preset of PRESET_IDS) {
        presets[preset] = buildImageUrl(cdnBase, result.key, { preset })
      }
      return {
        status: result.status,
        source: result.source,
        key: result.key,
        url: result.url,
        presets,
      }
    }
    case 'failed':
      return { status: result.status, source: result.source, error: result.error }
    default:
      return assertNever(result)
  }
}

function markdownFor(batch: Batch, entries: readonly JsonEntry[]): string {
  const lines: string[] = ['# Upload batch ' + batch.id, '', '## Uploaded', '']
  for (const entry of entries) {
    if (entry.status !== 'uploaded') {
      continue
    }
    lines.push('- ' + entry.source + ' -> ' + (entry.key ?? ''))
    lines.push('  - original: ' + (entry.url ?? ''))
    for (const preset of PRESET_IDS) {
      lines.push('  - ' + preset + ': ' + (entry.presets?.[preset] ?? ''))
    }
  }
  lines.push('', '## Failed', '')
  for (const entry of entries) {
    if (entry.status !== 'failed') {
      continue
    }
    lines.push('- ' + entry.source + ': ' + (entry.error ?? ''))
  }
  return lines.join('\n') + '\n'
}

export async function writeBatchResults(dir: string, batch: Batch): Promise<BatchPaths> {
  await mkdir(dir, { recursive: true })
  const entries = batch.results.map((result) => toJsonEntry(result, batch.cdnBase))
  const jsonText = JSON.stringify(
    { batchId: batch.id, finishedAt: batch.finishedAt.toISOString(), results: entries },
    null,
    2,
  )
  const mdText = markdownFor(batch, entries)
  for (let attempt = 1; attempt <= 100; attempt++) {
    const suffix = attempt === 1 ? batch.id : batch.id + '-' + String(attempt)
    const jsonPath = join(dir, suffix + '.json')
    const mdPath = join(dir, suffix + '.md')
    if (!(await writeExclusive(jsonPath, jsonText))) {
      continue
    }
    if (!(await writeExclusive(mdPath, mdText))) {
      continue
    }
    return { jsonPath, mdPath }
  }
  throw new Error('could not allocate a unique result file name for batch ' + batch.id)
}
