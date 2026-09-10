import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { CompressError, type CompressOptions, compressImage, DEFAULT_COMPRESS } from './compress'
import { GALLERY_FILENAME, type GalleryEntry, renderGallery } from './gallery'
import { parseShareMounts, type ShareMount, toSharePath } from './nas'
import { sniffImageMime } from './sniff'
import { createUploader, UploadError } from './uploader'

const SKIPPED_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.AppleDouble', GALLERY_FILENAME])

export type WatchConfig = {
  readonly root: string
  readonly share: string
  readonly apiBaseUrl: string
  readonly apiToken: string | undefined
  readonly cdnBase: string
  readonly compress: CompressOptions
  readonly pollMs: number
  /** A file must look unchanged for this long before it is read, so a copy in
   *  progress over SMB is not uploaded half-written. */
  readonly settleMs: number
  readonly statePath: string
}

export function loadWatchConfig(env: NodeJS.ProcessEnv): WatchConfig {
  const apiBaseUrl = env['IMAGE_API_URL']
  const cdnBase = env['IMAGE_CDN_BASE']
  if (apiBaseUrl === undefined || cdnBase === undefined) {
    throw new Error('IMAGE_API_URL and IMAGE_CDN_BASE must be set')
  }
  const root = env['SMARTIMG_WATCH_ROOT'] ?? '/mnt/smartimg'
  return {
    root,
    share: env['SMARTIMG_SHARE_NAME'] ?? (root.split(sep).pop() ?? 'smartimg').toLowerCase(),
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    apiToken: env['IMAGE_API_TOKEN'],
    cdnBase: cdnBase.replace(/\/+$/, ''),
    compress: {
      maxEdge: Number(env['SMARTIMG_MAX_EDGE'] ?? DEFAULT_COMPRESS.maxEdge),
      quality: Number(env['SMARTIMG_QUALITY'] ?? DEFAULT_COMPRESS.quality),
      toWebp: env['SMARTIMG_TO_WEBP'] === 'true',
    },
    pollMs: Number(env['SMARTIMG_POLL_MS'] ?? 10_000),
    settleMs: Number(env['SMARTIMG_SETTLE_MS'] ?? 4_000),
    statePath:
      env['SMARTIMG_STATE'] ?? join(homedir(), '.local', 'state', 'smartimg', 'uploaded.json'),
  }
}

type StateRecord = {
  readonly hash: string
  readonly key: string
  readonly size: number
  readonly mtimeMs: number
  readonly sourceBytes: number
  readonly storedBytes: number
  readonly uploadedAt: string
}

type State = Record<string, StateRecord>

export async function loadState(path: string): Promise<State> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as State
  } catch {
    return {}
  }
}

/** Written via a temp file so a crash mid-write cannot leave unreadable state. */
export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.tmp'
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
  await rename(temp, path)
}

type Candidate = { readonly path: string; readonly size: number; readonly mtimeMs: number }

type Scan = {
  readonly found: Candidate[]
  /**
   * Directories this pass could not read. Their contents are unknown, which is
   * a different thing from absent, and the difference decides whether an upload
   * may be forgotten — see the pruning step in runPass.
   */
  readonly unreadable: string[]
}

async function collect(dir: string, scan: Scan): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    scan.unreadable.push(dir)
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('#') || entry.name.startsWith('.') || SKIPPED_NAMES.has(entry.name)) {
      continue
    }
    const child = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collect(child, scan)
    } else if (entry.isFile()) {
      try {
        const info = await stat(child)
        scan.found.push({ path: child, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // Vanished between readdir and stat; it will turn up on the next pass.
      }
    }
  }
}

/**
 * Share-path prefixes covering everything this pass could not see. The watch
 * root maps to the bare share name, which is why it is handled here rather than
 * through toSharePath: relative(mount, mount) is empty and that is not a path.
 */
function unscannedPrefixes(
  config: WatchConfig,
  mounts: readonly ShareMount[],
  dirs: readonly string[],
): readonly string[] {
  const prefixes: string[] = []
  for (const dir of dirs) {
    if (dir === config.root) {
      prefixes.push(config.share)
      continue
    }
    try {
      prefixes.push(toSharePath(dir, mounts))
    } catch {
      // Outside every mount, so nothing in the state can sit under it.
    }
  }
  return prefixes
}

export type PassResult = {
  readonly uploaded: number
  readonly failed: number
  readonly skipped: number
  readonly galleryWritten: boolean
  /** Directories the pass could not read; non-empty means its view of the share is partial. */
  readonly unreadable: readonly string[]
}

function log(message: string): void {
  process.stdout.write('[smartimg-watch] ' + message + '\n')
}

export async function runPass(
  config: WatchConfig,
  mounts: readonly ShareMount[],
  upload: ReturnType<typeof createUploader>,
): Promise<PassResult> {
  const state = await loadState(config.statePath)
  const scan: Scan = { found: [], unreadable: [] }
  await collect(config.root, scan)
  const found = scan.found

  const now = Date.now()
  let uploaded = 0
  let failed = 0
  let skipped = 0
  let dirty = false

  const live = new Set<string>()

  for (const candidate of found) {
    const sharePath = (() => {
      try {
        return toSharePath(candidate.path, mounts)
      } catch {
        return null
      }
    })()
    if (sharePath === null) continue

    const previous = state[sharePath]
    live.add(sharePath)

    // Unchanged since the last upload: nothing to do, and no file to read.
    if (
      previous !== undefined &&
      previous.size === candidate.size &&
      previous.mtimeMs === candidate.mtimeMs
    ) {
      continue
    }

    // Still being written: wait for it to hold still before reading.
    if (now - candidate.mtimeMs < config.settleMs) continue

    let bytes: Buffer
    try {
      bytes = await readFile(candidate.path)
    } catch {
      continue
    }

    const source = new Uint8Array(bytes)
    const mime = sniffImageMime(source)
    if (mime === null) {
      skipped += 1
      continue
    }

    const hash = createHash('sha256').update(bytes).digest('hex')
    if (previous !== undefined && previous.hash === hash) {
      // Only the timestamp moved — record it so the next pass stays cheap.
      state[sharePath] = { ...previous, size: candidate.size, mtimeMs: candidate.mtimeMs }
      dirty = true
      continue
    }

    let compressed: Awaited<ReturnType<typeof compressImage>>
    try {
      compressed = await compressImage(source, mime, config.compress)
    } catch (error) {
      failed += 1
      log(
        '압축 실패 ' + sharePath + ': ' + (error instanceof CompressError ? error.message : error),
      )
      continue
    }

    try {
      const result = await upload({
        filename: candidate.path,
        contentType: compressed.contentType,
        bytes: compressed.bytes,
        path: sharePath,
      })
      state[sharePath] = {
        hash,
        key: result.key,
        size: candidate.size,
        mtimeMs: candidate.mtimeMs,
        sourceBytes: source.byteLength,
        storedBytes: compressed.bytes.byteLength,
        uploadedAt: new Date().toISOString(),
      }
      dirty = true
      uploaded += 1
      log('업로드 ' + sharePath + ' -> ' + result.key)
    } catch (error) {
      failed += 1
      log(
        '업로드 실패 ' + sharePath + ': ' + (error instanceof UploadError ? error.message : error),
      )
    }
  }

  // Files removed from the share drop out of the listing. The S3 object is left
  // alone: a link already given out should not die because someone tidied the
  // folder, and deleting is a deliberate act through the library.
  //
  // A directory that could not be read is not a directory that is empty, and an
  // SMB mount that has dropped looks exactly like a share whose files were all
  // deleted at once. Uploads recorded below one are therefore kept: forgetting
  // them costs a re-upload of everything once the mount comes back, and takes
  // the link list down with it in the meantime.
  const unscanned = unscannedPrefixes(config, mounts, scan.unreadable)
  for (const known of Object.keys(state)) {
    if (live.has(known)) continue
    if (unscanned.some((prefix) => known === prefix || known.startsWith(prefix + '/'))) continue
    delete state[known]
    dirty = true
  }

  if (dirty) await saveState(config.statePath, state)

  const galleryWritten = dirty ? await writeGallery(config, state) : false
  return { uploaded, failed, skipped, galleryWritten, unreadable: scan.unreadable }
}

async function writeGallery(config: WatchConfig, state: State): Promise<boolean> {
  const entries: GalleryEntry[] = Object.entries(state).map(([sharePath, record]) => ({
    sharePath: sharePath.startsWith(config.share + '/')
      ? sharePath.slice(config.share.length + 1)
      : sharePath,
    key: record.key,
    sourceBytes: record.sourceBytes,
    storedBytes: record.storedBytes,
    uploadedAt: record.uploadedAt,
  }))
  const html = renderGallery(entries, config.cdnBase)
  const target = join(config.root, GALLERY_FILENAME)
  try {
    const temp = join(config.root, '.' + GALLERY_FILENAME + '.tmp')
    await writeFile(temp, html, 'utf8')
    await rename(temp, target)
    return true
  } catch (error) {
    log('링크 목록 작성 실패: ' + String(error))
    return false
  }
}

export async function main(env: NodeJS.ProcessEnv): Promise<number> {
  const config = loadWatchConfig(env)
  const mounts = parseShareMounts(config.root + '=' + config.share)
  const upload = createUploader({
    apiBaseUrl: config.apiBaseUrl,
    apiToken: config.apiToken,
    cdnBase: config.cdnBase,
    folder: 'uploads',
  })

  log('감시 시작: ' + config.root + ' (share: ' + config.share + ')')
  log('폴링 ' + String(config.pollMs) + 'ms · 안정화 대기 ' + String(config.settleMs) + 'ms')

  let stop = false
  const halt = () => {
    stop = true
    log('종료 요청 받음')
  }
  process.on('SIGINT', halt)
  process.on('SIGTERM', halt)

  let degraded = false
  while (!stop) {
    try {
      const result = await runPass(config, mounts, upload)
      // Logged on the way in and on the way out only: a mount that stays down
      // would otherwise write one line per poll for as long as it is down.
      if (result.unreadable.length > 0 && !degraded) {
        degraded = true
        log(
          '읽을 수 없는 경로 ' +
            String(result.unreadable.length) +
            '개 (' +
            (result.unreadable[0] ?? '') +
            '). 마운트를 확인하세요. 그 아래 업로드 기록은 지우지 않습니다',
        )
      } else if (result.unreadable.length === 0 && degraded) {
        degraded = false
        log('경로를 다시 읽을 수 있습니다')
      }
      if (result.uploaded > 0 || result.failed > 0) {
        log(
          '완료: 업로드 ' +
            String(result.uploaded) +
            ' · 실패 ' +
            String(result.failed) +
            (result.galleryWritten ? ' · 목록 갱신됨' : ''),
        )
      }
    } catch (error) {
      log('패스 오류: ' + String(error))
    }
    if (stop) break
    await new Promise((resolve) => setTimeout(resolve, config.pollMs))
  }
  return 0
}

if (import.meta.main) {
  main(process.env).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n')
      process.exitCode = 1
    },
  )
}
