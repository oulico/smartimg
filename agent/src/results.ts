import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildPresetUrls, IMAGE_PRESETS, type ImagePreset } from '@smartimg/shared'
import { hasErrnoCode } from './errno'

type UploadedResult = {
  readonly status: 'uploaded'
  readonly source: string
  readonly key: string
  readonly url: string
}

type FailedResult = {
  readonly status: 'failed'
  readonly source: string
  readonly error: string
}

export type UploadResult = UploadedResult | FailedResult

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

const PRESET_IDS = Object.keys(IMAGE_PRESETS) as readonly ImagePreset[]

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

type JsonEntry =
  | (UploadedResult & { readonly presets: Readonly<Record<ImagePreset, string>> })
  | FailedResult

function toJsonEntry(result: UploadResult, cdnBase: string): JsonEntry {
  switch (result.status) {
    case 'uploaded': {
      return { ...result, presets: buildPresetUrls(cdnBase, result.key) }
    }
    case 'failed':
      return result
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
    lines.push('- ' + entry.source + ' -> ' + entry.key)
    lines.push('  - original: ' + entry.url)
    for (const preset of PRESET_IDS) {
      lines.push('  - ' + preset + ': ' + entry.presets[preset])
    }
  }
  lines.push('', '## Failed', '')
  for (const entry of entries) {
    if (entry.status !== 'failed') {
      continue
    }
    lines.push('- ' + entry.source + ': ' + entry.error)
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
