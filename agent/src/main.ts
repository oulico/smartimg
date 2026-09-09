import { mkdir } from 'node:fs/promises'
import chokidar from 'chokidar'
import { loadAgentConfig } from './config'
import { UploadPipeline } from './pipeline'
import { createUploader } from './uploader'

const BATCH_SETTLE_MS = 2000

function log(message: string): void {
  console.log('[smartimg-agent] ' + message)
}

async function run(): Promise<void> {
  const config = loadAgentConfig()
  await Promise.all(
    [config.dirs.inbox, config.dirs.uploaded, config.dirs.failed, config.dirs.results].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  )
  const pipeline = new UploadPipeline(
    { dirs: config.dirs, cdnBase: config.cdnBase, settleMs: BATCH_SETTLE_MS },
    createUploader(config),
    log,
  )
  const watcher = chokidar.watch(config.dirs.inbox, {
    awaitWriteFinish: { stabilityThreshold: config.stabilityMs, pollInterval: 100 },
    ignored: /(^|[\\/])\./,
    depth: 0,
  })
  watcher.on('add', (path) => {
    pipeline.enqueue(path)
  })
  watcher.on('error', (error) => {
    log('watcher error: ' + (error instanceof Error ? error.message : String(error)))
  })
  await new Promise<void>((resolve) => {
    watcher.once('ready', resolve)
  })
  log(
    'watching ' +
      config.dirs.inbox +
      ' (api ' +
      config.apiBaseUrl +
      ', folder ' +
      config.folder +
      ')',
  )

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    log('received ' + signal + ', finishing current batch')
    void (async () => {
      await watcher.close()
      await pipeline.close()
      process.exit(0)
    })()
  }
  process.on('SIGINT', () => {
    shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    shutdown('SIGTERM')
  })
}

await run()
