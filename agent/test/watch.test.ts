import { chmod, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { GALLERY_FILENAME } from '../src/gallery'
import { parseShareMounts, type ShareMount } from '../src/nas'
import type { UploadRequest } from '../src/uploader'
import { loadState, runPass, type WatchConfig, writeGallery } from '../src/watch'

async function png(): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

/**
 * Writes an image and backdates it, so the pass sees a file that has finished
 * being copied rather than one still settling.
 */
async function writeImage(path: string): Promise<void> {
  await writeFile(path, await png())
  const settled = new Date(Date.now() - 60_000)
  await utimes(path, settled, settled)
}

/** Records what it was asked to upload, so a pass can be told from a no-op. */
function stubUpload(): ((request: UploadRequest) => Promise<{ key: string; url: string }>) & {
  readonly paths: string[]
} {
  const paths: string[] = []
  const upload = async (request: UploadRequest) => {
    const key = request.path ?? request.filename
    paths.push(key)
    return { key, url: 'https://cdn.example.com/' + key }
  }
  return Object.assign(upload, { paths })
}

let root: string
let statePath: string
let mounts: readonly ShareMount[]

function configFor(watchRoot: string): WatchConfig {
  return {
    root: watchRoot,
    share: 'smartimg',
    apiBaseUrl: 'http://127.0.0.1:1/api',
    apiToken: undefined,
    cdnBase: 'https://cdn.example.com',
    compress: { maxEdge: 2400, quality: 82, toWebp: false },
    pollMs: 10_000,
    settleMs: 4_000,
    statePath,
  }
}

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'smartimg-watch-'))
  root = join(base, 'share')
  await mkdir(join(root, '상품'), { recursive: true })
  statePath = join(base, 'state.json')
  mounts = parseShareMounts(root + '=smartimg')
})

describe('runPass', () => {
  it('uploads a new file once and leaves it alone afterwards', async () => {
    await writeImage(join(root, '상품', 'monkey.png'))
    const upload = stubUpload()

    const first = await runPass(configFor(root), mounts, upload)
    expect(first.uploaded).toBe(1)
    expect(Object.keys(await loadState(statePath))).toEqual(['smartimg/상품/monkey.png'])

    const second = await runPass(configFor(root), mounts, upload)
    expect(second.uploaded).toBe(0)
    expect(upload.paths).toHaveLength(1)
  })

  it('ignores a file sitting at the share root, outside any folder', async () => {
    await writeImage(join(root, '20260907_112746.jpg'))
    await writeImage(join(root, '상품', 'monkey.png'))
    const upload = stubUpload()
    const result = await runPass(configFor(root), mounts, upload)
    expect(result.uploaded).toBe(1)
    expect(upload.paths).toEqual(['smartimg/상품/monkey.png'])
  })

  it('forgets a file that was really deleted from the share', async () => {
    const file = join(root, '상품', 'monkey.png')
    await writeImage(file)
    await runPass(configFor(root), mounts, stubUpload())

    await rm(file)
    const result = await runPass(configFor(root), mounts, stubUpload())
    expect(result.unreadable).toEqual([])
    expect(await loadState(statePath)).toEqual({})
  })

  // The failure this guards against: the mount drops, every file looks deleted,
  // the state is wiped, and the next healthy pass re-uploads the whole share.
  it('keeps every upload when the watch root cannot be read at all', async () => {
    await writeImage(join(root, '상품', 'monkey.png'))
    await runPass(configFor(root), mounts, stubUpload())
    const before = await loadState(statePath)
    expect(Object.keys(before)).toHaveLength(1)

    const gone = join(root, '..', 'not-mounted')
    const result = await runPass(
      configFor(gone),
      parseShareMounts(gone + '=smartimg'),
      stubUpload(),
    )

    expect(result.unreadable).toHaveLength(1)
    expect(await loadState(statePath)).toEqual(before)
  })

  // chmod cannot make a directory unreadable to root, so this one only means
  // something as an ordinary user.
  it.skipIf(process.getuid?.() === 0)(
    'keeps only what sits under an unreadable directory, and prunes the rest',
    async () => {
      await mkdir(join(root, '기타'))
      await writeImage(join(root, '기타', 'top.png'))
      await writeImage(join(root, '상품', 'monkey.png'))
      await runPass(configFor(root), mounts, stubUpload())
      expect(Object.keys(await loadState(statePath))).toHaveLength(2)

      // Both disappear from view, but only one of them is actually known to be gone.
      await rm(join(root, '기타', 'top.png'))
      await chmod(join(root, '상품'), 0o000)
      try {
        const result = await runPass(configFor(root), mounts, stubUpload())
        expect(result.unreadable).toHaveLength(1)
        expect(Object.keys(await loadState(statePath))).toEqual(['smartimg/상품/monkey.png'])
      } finally {
        await chmod(join(root, '상품'), 0o755)
      }
    },
  )
})

/**
 * The state file is the only record of what has been uploaded. Reading it
 * wrongly as "nothing yet" prunes every record and re-uploads the share, so an
 * error that is not "the file is not there" has to reach the caller.
 */
describe('loadState', () => {
  it('starts empty when no state file has been written yet', async () => {
    expect(await loadState(join(root, 'never-written.json'))).toEqual({})
  })

  it('raises rather than reporting an empty state when the path cannot be read', async () => {
    const asDirectory = join(root, 'state-dir.json')
    await mkdir(asDirectory)
    await expect(loadState(asDirectory)).rejects.toThrow('업로드 기록을 읽을 수 없습니다')
  })

  it('raises when the state file is damaged', async () => {
    await writeFile(statePath, '{"smartimg/a.png": {', 'utf8')
    await expect(loadState(statePath)).rejects.toThrow('업로드 기록이 손상되었습니다')
  })
})

describe('the link list', () => {
  it('reports the state as changed only when something was uploaded, re-stamped or forgotten', async () => {
    await writeImage(join(root, '상품', 'monkey.png'))
    expect((await runPass(configFor(root), mounts, stubUpload())).changed).toBe(true)
    expect((await runPass(configFor(root), mounts, stubUpload())).changed).toBe(false)
    await rm(join(root, '상품', 'monkey.png'))
    expect((await runPass(configFor(root), mounts, stubUpload())).changed).toBe(true)
  })

  // The state file has already been saved by then, so a later pass sees no
  // change; the loop keeps the list marked stale until a write succeeds.
  it('says so when it could not be written, and writes on a later try', async () => {
    await writeImage(join(root, '상품', 'monkey.png'))
    const result = await runPass(configFor(root), mounts, stubUpload())
    // A directory where the list belongs: the rename onto it fails.
    await mkdir(join(root, GALLERY_FILENAME))
    expect(await writeGallery(configFor(root), result.state)).toBe(false)

    await rm(join(root, GALLERY_FILENAME), { recursive: true })
    expect(await writeGallery(configFor(root), result.state)).toBe(true)
    expect((await stat(join(root, GALLERY_FILENAME))).isFile()).toBe(true)
  })
})
