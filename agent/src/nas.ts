import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  buildImageUrl,
  buildPathObjectKey,
  buildPresetUrls,
  IMAGE_PRESETS,
  type ImagePreset,
  InvalidKeyError,
  isPublishablePath,
} from '@smartimg/shared'
import { CompressError, type CompressOptions, compressImage, DEFAULT_COMPRESS } from './compress'
import { sniffImageMime } from './sniff'
import { createUploader, UploadError } from './uploader'

/**
 * Mount points on this host, mapped back to the share name the NAS itself uses.
 * The share becomes the first segment of the object key, so a UNC path and a
 * mounted path always resolve to the same URL:
 *   \\192.168.0.200\Public\...  ==  /mnt/Public/...  ->  public/...
 */
export type ShareMount = { readonly mountPoint: string; readonly share: string }

export function parseShareMounts(spec: string): readonly ShareMount[] {
  return spec
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [mountPoint, share] = entry.split('=')
      if (mountPoint === undefined || mountPoint === '') {
        throw new Error('share mount must look like /mnt/Public=public')
      }
      const resolved = resolve(mountPoint)
      return {
        mountPoint: resolved,
        share: (share ?? resolved.split(sep).pop() ?? '').toLowerCase(),
      }
    })
}

/**
 * One share, on purpose. Keys mirror the source path, so a published URL is
 * guessable from the path — which is fine only when everything under the share
 * is meant to be published. Confining uploads to a share that exists for that
 * makes "is this publishable?" a question answered by where the file sits,
 * rather than by whoever runs the command.
 */
export const DEFAULT_SHARE_MOUNTS = '/mnt/smartimg'

export class NasPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NasPathError'
  }
}

/** Accepts either a local mounted path or the UNC path people paste from Windows. */
export function toSharePath(input: string, mounts: readonly ShareMount[]): string {
  const unc = input.match(/^\\\\[^\\]+\\([^\\]+)\\(.+)$/)
  if (unc !== null) {
    const share = (unc[1] ?? '').toLowerCase()
    const rest = (unc[2] ?? '').replace(/\\/g, '/')
    return share + '/' + rest
  }

  const absolute = resolve(input)
  for (const mount of mounts) {
    const rel = relative(mount.mountPoint, absolute)
    if (rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) {
      return mount.share + '/' + rel.split(sep).join('/')
    }
  }
  throw new NasPathError(
    absolute + ' is not under a known share (' + mounts.map((m) => m.mountPoint).join(', ') + ')',
  )
}

/**
 * A UNC path names a share on the NAS, not a file this host can open, so it is
 * translated back to the mount point before anything tries to read it.
 */
export function toLocalPath(input: string, mounts: readonly ShareMount[]): string {
  const unc = input.match(/^\\\\[^\\]+\\([^\\]+)\\(.+)$/)
  if (unc === null) return input
  const share = (unc[1] ?? '').toLowerCase()
  const mount = mounts.find((candidate) => candidate.share === share)
  if (mount === undefined) {
    throw new NasPathError('share "' + share + '" is not mounted on this host')
  }
  return join(mount.mountPoint, ...(unc[2] ?? '').split('\\'))
}

const SKIPPED = new Set(['.DS_Store', 'Thumbs.db', '.AppleDouble'])

async function collectFiles(target: string, recursive: boolean): Promise<readonly string[]> {
  const info = await stat(target)
  if (info.isFile()) return [target]
  if (!info.isDirectory()) return []
  const entries = await readdir(target, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('#') || SKIPPED.has(entry.name)) continue
    const child = join(target, entry.name)
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await collectFiles(child, recursive)))
    } else if (entry.isFile()) {
      out.push(child)
    }
  }
  return out.sort()
}

export type NasUploadOutcome =
  | {
      readonly status: 'uploaded'
      readonly source: string
      readonly sharePath: string
      readonly key: string
      readonly url: string
      readonly presets: Readonly<Record<ImagePreset, string>>
      readonly sourceBytes: number
      readonly storedBytes: number
    }
  | { readonly status: 'skipped' | 'failed'; readonly source: string; readonly reason: string }

export type NasRunOptions = {
  readonly apiBaseUrl: string
  readonly apiToken: string | undefined
  readonly cdnBase: string
  readonly mounts: readonly ShareMount[]
  readonly compress: CompressOptions
  readonly recursive: boolean
  readonly dryRun: boolean
  /** Store under a digest of the uploaded bytes, so each version is its own
   *  immutable object. */
  readonly versioned: boolean
}

export async function uploadNasPaths(
  targets: readonly string[],
  options: NasRunOptions,
): Promise<readonly NasUploadOutcome[]> {
  const upload = createUploader({
    apiBaseUrl: options.apiBaseUrl,
    apiToken: options.apiToken,
    cdnBase: options.cdnBase,
  })

  const outcomes: NasUploadOutcome[] = []
  for (const target of targets) {
    let files: readonly string[]
    try {
      files = await collectFiles(toLocalPath(target, options.mounts), options.recursive)
    } catch (error) {
      outcomes.push({
        status: 'failed',
        source: target,
        reason: error instanceof Error ? error.message : 'cannot read path',
      })
      continue
    }

    for (const file of files) {
      outcomes.push(await uploadOne(file, options, upload))
    }
  }
  return outcomes
}

async function uploadOne(
  file: string,
  options: NasRunOptions,
  upload: ReturnType<typeof createUploader>,
): Promise<NasUploadOutcome> {
  let source: Buffer
  let sharePath: string
  try {
    sharePath = toSharePath(file, options.mounts)
    source = await readFile(file)
  } catch (error) {
    return {
      status: 'failed',
      source: file,
      reason: error instanceof Error ? error.message : 'cannot read file',
    }
  }

  if (!isPublishablePath(sharePath)) {
    return { status: 'skipped', source: file, reason: 'sits at the share root, not in a folder' }
  }

  const sourceBytes = new Uint8Array(source)
  const mime = sniffImageMime(sourceBytes)
  if (mime === null) {
    return { status: 'skipped', source: file, reason: 'not a supported image' }
  }

  let compressed: Awaited<ReturnType<typeof compressImage>>
  try {
    compressed = await compressImage(sourceBytes, mime, options.compress)
  } catch (error) {
    if (error instanceof CompressError) {
      return { status: 'failed', source: file, reason: 'compress: ' + error.message }
    }
    throw error
  }

  // Only computed when versioning is asked for, and over the compressed output
  // rather than the source. Hashing the source would keep the URL stable across
  // a change of quality setting, which sounds like a feature until you notice it
  // means two different images sharing one key that is served with a year of
  // immutable caching. A versioned URL has to name the bytes behind it.
  const contentHash = options.versioned
    ? createHash('sha256').update(compressed.bytes).digest('hex')
    : undefined

  if (options.dryRun) {
    // The same rule the server applies, so a path it would refuse fails here too.
    let key: string
    try {
      key = buildPathObjectKey({ path: sharePath, contentHash })
    } catch (error) {
      if (error instanceof InvalidKeyError) {
        return { status: 'failed', source: file, reason: error.message }
      }
      throw error
    }
    return {
      status: 'uploaded',
      source: file,
      sharePath,
      key,
      url: buildImageUrl(options.cdnBase, key),
      presets: buildPresetUrls(options.cdnBase, key),
      sourceBytes: sourceBytes.byteLength,
      storedBytes: compressed.bytes.byteLength,
    }
  }

  try {
    const uploaded = await upload({
      filename: file,
      contentType: compressed.contentType,
      bytes: compressed.bytes,
      path: sharePath,
      contentHash,
    })
    return {
      status: 'uploaded',
      source: file,
      sharePath,
      key: uploaded.key,
      url: uploaded.url,
      presets: buildPresetUrls(options.cdnBase, uploaded.key),
      sourceBytes: sourceBytes.byteLength,
      storedBytes: compressed.bytes.byteLength,
    }
  } catch (error) {
    if (error instanceof UploadError) {
      return { status: 'failed', source: file, reason: error.message }
    }
    throw error
  }
}

// ---------------------------------------------------------------- entry point

function formatBytes(value: number): string {
  if (value < 1024) return String(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

type Flags = {
  readonly targets: readonly string[]
  readonly preset: ImagePreset | undefined
  readonly json: boolean
  readonly recursive: boolean
  readonly dryRun: boolean
  readonly versioned: boolean
}

export function parseArgs(argv: readonly string[]): Flags {
  const targets: string[] = []
  let preset: ImagePreset | undefined
  let json = false
  let recursive = false
  let dryRun = false
  let versioned = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--json') json = true
    else if (arg === '--recursive' || arg === '-r') recursive = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--versioned') versioned = true
    else if (arg === '--preset') {
      const value = argv[++i] ?? ''
      if (!(value in IMAGE_PRESETS)) {
        throw new Error(
          'unknown preset: ' + value + ' (' + Object.keys(IMAGE_PRESETS).join(', ') + ')',
        )
      }
      preset = value as ImagePreset
    } else if (arg.startsWith('-')) {
      throw new Error('unknown flag: ' + arg)
    } else {
      targets.push(arg)
    }
  }
  return { targets, preset, json, recursive, dryRun, versioned }
}

const USAGE = `smartimg nas — compress a NAS image and upload it, then print its URL

  bun run --cwd agent src/nas.ts <path>... [options]

  The object key mirrors the share path, so re-uploading a changed file
  overwrites it and the same URL starts serving the new image.

  <path>          a mounted path (/mnt/Public/…) or a UNC path (\\\\192.168.0.200\\Public\\…)
  --preset NAME   print the preset URL instead of the original (${Object.keys(IMAGE_PRESETS).join(', ')})
  -r, --recursive descend into directories
  --dry-run       compress and show the URL without uploading
  --versioned     store under _v/{digest}/, so each version is its own
                  immutable object and old links keep resolving
  --json          machine-readable output

  env: IMAGE_API_URL, IMAGE_CDN_BASE, IMAGE_API_TOKEN,
       SMARTIMG_SHARES (default ${DEFAULT_SHARE_MOUNTS}),
       SMARTIMG_MAX_EDGE (${DEFAULT_COMPRESS.maxEdge}), SMARTIMG_QUALITY (${DEFAULT_COMPRESS.quality}),
       SMARTIMG_TO_WEBP (set to 'true' to store WebP instead of the source format)
`

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let flags: Flags
  try {
    flags = parseArgs(argv)
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    return 2
  }

  if (flags.targets.length === 0) {
    process.stdout.write(USAGE)
    return flags.targets.length === 0 && argv.length === 0 ? 0 : 2
  }

  const apiBaseUrl = env['IMAGE_API_URL']
  const cdnBase = env['IMAGE_CDN_BASE']
  if (apiBaseUrl === undefined || cdnBase === undefined) {
    process.stderr.write('IMAGE_API_URL and IMAGE_CDN_BASE must be set\n')
    return 2
  }

  const outcomes = await uploadNasPaths(flags.targets, {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    apiToken: env['IMAGE_API_TOKEN'],
    cdnBase: cdnBase.replace(/\/+$/, ''),
    mounts: parseShareMounts(env['SMARTIMG_SHARES'] ?? DEFAULT_SHARE_MOUNTS),
    compress: {
      maxEdge: Number(env['SMARTIMG_MAX_EDGE'] ?? DEFAULT_COMPRESS.maxEdge),
      quality: Number(env['SMARTIMG_QUALITY'] ?? DEFAULT_COMPRESS.quality),
      toWebp: env['SMARTIMG_TO_WEBP'] === 'true',
    },
    recursive: flags.recursive,
    dryRun: flags.dryRun,
    versioned: flags.versioned,
  })

  if (flags.json) {
    process.stdout.write(JSON.stringify({ results: outcomes }, null, 2) + '\n')
  } else {
    for (const outcome of outcomes) {
      if (outcome.status === 'uploaded') {
        const url = flags.preset === undefined ? outcome.url : outcome.presets[flags.preset]
        const saved = formatBytes(outcome.sourceBytes) + ' → ' + formatBytes(outcome.storedBytes)
        process.stdout.write(url + '\n')
        process.stderr.write('  ' + outcome.sharePath + '  ' + saved + '\n')
      } else {
        process.stderr.write(outcome.status + ': ' + outcome.source + ' — ' + outcome.reason + '\n')
      }
    }
  }

  return outcomes.some((outcome) => outcome.status === 'failed') ? 1 : 0
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n')
      process.exitCode = 1
    },
  )
}
