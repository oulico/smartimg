import { randomUUID } from 'node:crypto'
import { readFile, rename, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AgentDirs } from './config'
import { hasErrnoCode } from './errno'
import { type UploadResult, writeBatchResults } from './results'
import { sniffImageMime } from './sniff'
import type { UploadedImage, UploadRequest } from './uploader'

export type PipelineConfig = {
  readonly dirs: AgentDirs
  readonly cdnBase: string
  readonly settleMs: number
}

export type Upload = (request: UploadRequest) => Promise<UploadedImage>
export type Log = (message: string) => void

function batchId(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  return 'batch-' + stamp + '-' + randomUUID().slice(0, 8)
}

async function uniqueTarget(dir: string, filename: string): Promise<string> {
  const direct = join(dir, filename)
  try {
    await stat(direct)
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return direct
    }
    throw error
  }
  return join(dir, randomUUID().slice(0, 8) + '-' + filename)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class UploadPipeline {
  readonly #config: PipelineConfig
  readonly #upload: Upload
  readonly #log: Log
  readonly #queue: string[] = []
  readonly #queued = new Set<string>()
  readonly #waiters: (() => void)[] = []
  #batch: UploadResult[] | null = null
  #running = false
  #settleTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false

  constructor(config: PipelineConfig, upload: Upload, log: Log = () => {}) {
    this.#config = config
    this.#upload = upload
    this.#log = log
  }

  enqueue(path: string): void {
    if (this.#closed || this.#queued.has(path)) {
      return
    }
    if (this.#settleTimer !== null) {
      clearTimeout(this.#settleTimer)
      this.#settleTimer = null
    }
    this.#queued.add(path)
    this.#queue.push(path)
    void this.#pump()
  }

  async idle(): Promise<void> {
    while (
      this.#queue.length > 0 ||
      this.#running ||
      this.#batch !== null ||
      this.#settleTimer !== null
    ) {
      await new Promise<void>((resolve) => {
        this.#waiters.push(resolve)
      })
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#queue.length = 0
    this.#queued.clear()
    if (this.#settleTimer !== null) {
      clearTimeout(this.#settleTimer)
      this.#settleTimer = null
    }
    while (this.#running) {
      await new Promise<void>((resolve) => {
        this.#waiters.push(resolve)
      })
    }
    await this.#flushBatch()
    this.#wake()
  }

  async #pump(): Promise<void> {
    if (this.#running) {
      return
    }
    this.#running = true
    try {
      while (!this.#closed && this.#queue.length > 0) {
        const next = this.#queue.shift()
        if (next === undefined) {
          break
        }
        this.#queued.delete(next)
        await this.#process(next)
      }
    } finally {
      this.#running = false
      this.#maybeScheduleSettle()
      this.#wake()
    }
  }

  async #process(path: string): Promise<void> {
    const filename = basename(path)
    let result: UploadResult
    try {
      const info = await stat(path)
      if (!info.isFile()) {
        return
      }
      const bytes = await readFile(path)
      const mime = sniffImageMime(bytes)
      if (mime === null) {
        result = { status: 'failed', source: filename, error: 'unsupported image type' }
      } else {
        const uploaded = await this.#upload({ filename, contentType: mime, bytes })
        const target = await uniqueTarget(this.#config.dirs.uploaded, filename)
        await rename(path, target)
        result = { status: 'uploaded', source: filename, key: uploaded.key, url: uploaded.url }
      }
    } catch (error) {
      result = { status: 'failed', source: filename, error: errorMessage(error) }
    }
    if (result.status === 'failed') {
      try {
        const target = await uniqueTarget(this.#config.dirs.failed, filename)
        await rename(path, target)
      } catch (moveError) {
        this.#log('could not move ' + filename + ' to Failed: ' + errorMessage(moveError))
      }
    }
    if (this.#batch === null) {
      this.#batch = []
    }
    this.#batch.push(result)
    this.#log(
      result.status === 'uploaded'
        ? 'uploaded ' + result.source + ' -> ' + result.key
        : 'failed ' + result.source + ': ' + result.error,
    )
  }

  #maybeScheduleSettle(): void {
    if (
      this.#running ||
      this.#queue.length > 0 ||
      this.#batch === null ||
      this.#settleTimer !== null ||
      this.#closed
    ) {
      return
    }
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = null
      void this.#settle()
    }, this.#config.settleMs)
  }

  async #settle(): Promise<void> {
    await this.#flushBatch()
    this.#wake()
  }

  async #flushBatch(): Promise<void> {
    const results = this.#batch
    this.#batch = null
    if (results === null || results.length === 0) {
      return
    }
    const uploadedCount = results.filter((result) => result.status === 'uploaded').length
    const id = batchId(new Date())
    await writeBatchResults(this.#config.dirs.results, {
      id,
      finishedAt: new Date(),
      cdnBase: this.#config.cdnBase,
      results,
    })
    this.#log(
      'batch ' +
        id +
        ' done: ' +
        String(uploadedCount) +
        ' uploaded, ' +
        String(results.length - uploadedCount) +
        ' failed',
    )
  }

  #wake(): void {
    const waiters = [...this.#waiters]
    this.#waiters.length = 0
    for (const waiter of waiters) {
      waiter()
    }
  }
}
