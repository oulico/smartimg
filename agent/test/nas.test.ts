import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compressImage } from '../src/compress'
import {
  DEFAULT_SHARE_MOUNTS,
  NasPathError,
  parseArgs,
  parseShareMounts,
  predictKey,
  toLocalPath,
  toSharePath,
  uploadNasPaths,
} from '../src/nas'

const MOUNTS = parseShareMounts(DEFAULT_SHARE_MOUNTS)

describe('toSharePath', () => {
  it('maps a mounted path to its share', () => {
    expect(toSharePath('/mnt/smartimg/1.업무보고서/박홍제/monkey.jpg', MOUNTS)).toBe(
      'smartimg/1.업무보고서/박홍제/monkey.jpg',
    )
  })

  it('maps the UNC path people paste from Windows to the same share path', () => {
    const unc = '\\\\192.168.0.200\\smartimg\\1.업무보고서\\박홍제\\monkey.jpg'
    expect(toSharePath(unc, MOUNTS)).toBe(
      toSharePath('/mnt/smartimg/1.업무보고서/박홍제/monkey.jpg', MOUNTS),
    )
  })

  it('refuses a path outside every known share', () => {
    expect(() => toSharePath('/home/hj/secret.png', MOUNTS)).toThrow(NasPathError)
  })

  it('refuses the other NAS shares, which are not for publishing', () => {
    expect(() => toSharePath('/mnt/Public/1.업무보고서/박홍제/monkey.jpg', MOUNTS)).toThrow(
      NasPathError,
    )
    expect(() => toSharePath('/mnt/fga/03_법인/a.png', MOUNTS)).toThrow(NasPathError)
  })

  it('refuses traversal that escapes the mount', () => {
    expect(() => toSharePath('/mnt/smartimg/../../etc/passwd', MOUNTS)).toThrow(NasPathError)
  })

  it('honours an explicit share name override', () => {
    const mounts = parseShareMounts('/mnt/smartimg=archive')
    expect(toSharePath('/mnt/smartimg/03_법인/a.png', mounts)).toBe('archive/03_법인/a.png')
  })
})

describe('toLocalPath', () => {
  it('translates a UNC path to the mount this host can actually read', () => {
    expect(
      toLocalPath('\\\\192.168.0.200\\smartimg\\1.업무보고서\\박홍제\\monkey.jpg', MOUNTS),
    ).toBe('/mnt/smartimg/1.업무보고서/박홍제/monkey.jpg')
  })

  it('leaves an ordinary local path alone', () => {
    expect(toLocalPath('/mnt/smartimg/a.jpg', MOUNTS)).toBe('/mnt/smartimg/a.jpg')
  })

  it('refuses a share that is not mounted here', () => {
    expect(() => toLocalPath('\\\\192.168.0.200\\Nope\\a.jpg', MOUNTS)).toThrow(NasPathError)
  })
})

describe('predictKey', () => {
  it('agrees with the server rule so --dry-run shows the real URL', () => {
    expect(predictKey('smartimg/1.업무보고서/박홍제/monkey.jpg', undefined)).toBe(
      'smartimg/1.업무보고서/박홍제/monkey.jpg',
    )
  })

  it('puts a versioned object under the same prefix the server uses', () => {
    expect(predictKey('smartimg/1.업무보고서/박홍제/monkey.jpg', '9f3a2c1dead')).toBe(
      '_v/9f3a2c1/smartimg/1.업무보고서/박홍제/monkey.jpg',
    )
  })

  it('keeps sources that differ only by extension apart', () => {
    expect(predictKey('smartimg/김치.jpg', undefined)).not.toBe(
      predictKey('smartimg/김치.png', undefined),
    )
  })
})

/**
 * A versioned key is served with a year of immutable caching, so it has to name
 * the bytes stored under it. The digest therefore covers the compressed output,
 * not the source file: hashing the source would keep one URL across a change of
 * quality setting and quietly park two different images on it.
 */
describe('a versioned key names the bytes it holds', () => {
  async function noisyJpeg(): Promise<Uint8Array> {
    const sharp = (await import('sharp')).default
    const pixels = Buffer.alloc(64 * 64 * 3)
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i % 11) * 91) % 256
    const buffer = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer()
    return new Uint8Array(buffer)
  }

  async function keyFor(source: Uint8Array, quality: number): Promise<string> {
    const compressed = await compressImage(source, 'image/jpeg', {
      maxEdge: 2400,
      quality,
      toWebp: false,
    })
    const digest = createHash('sha256').update(compressed.bytes).digest('hex')
    return predictKey('smartimg/사진/monkey.jpg', digest)
  }

  it('moves to a new URL when the compression setting changes the stored bytes', async () => {
    const source = await noisyJpeg()
    expect(await keyFor(source, 40)).not.toBe(await keyFor(source, 90))
  })

  it('stays on one URL while the source and the settings are unchanged', async () => {
    const source = await noisyJpeg()
    expect(await keyFor(source, 82)).toBe(await keyFor(source, 82))
  })

  // Through the real code path, so it holds uploadNasPaths to the same rule and
  // not just the hashing helper above.
  it('is what --dry-run predicts for the same file at two qualities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smartimg-version-'))
    await writeFile(join(root, 'monkey.jpg'), await noisyJpeg())
    const mounts = parseShareMounts(root + '=smartimg')

    async function run(quality: number): Promise<string> {
      const [outcome] = await uploadNasPaths([join(root, 'monkey.jpg')], {
        apiBaseUrl: 'http://127.0.0.1:1/api',
        apiToken: undefined,
        cdnBase: 'https://cdn.example.com',
        mounts,
        compress: { maxEdge: 2400, quality, toWebp: false },
        recursive: false,
        dryRun: true,
        versioned: true,
      })
      expect(outcome?.status).toBe('uploaded')
      return outcome?.status === 'uploaded' ? outcome.key : ''
    }

    const lean = await run(40)
    const rich = await run(90)
    expect(lean).toMatch(/^_v\/[0-9a-f]{7}\/smartimg\/monkey\.jpg$/)
    expect(rich).not.toBe(lean)
  })
})

describe('parseArgs', () => {
  it('collects targets and flags', () => {
    const flags = parseArgs(['/mnt/smartimg/a.jpg', '--preset', 'thumbnail', '-r', '--json'])
    expect(flags.targets).toEqual(['/mnt/smartimg/a.jpg'])
    expect(flags.preset).toBe('thumbnail')
    expect(flags.recursive).toBe(true)
    expect(flags.json).toBe(true)
    expect(flags.versioned).toBe(false)
  })

  it('opts into versioned keys', () => {
    expect(parseArgs(['a.jpg', '--versioned']).versioned).toBe(true)
  })

  it('refuses an unknown preset', () => {
    expect(() => parseArgs(['a.jpg', '--preset', 'nope'])).toThrow(/unknown preset/)
  })
})

async function png(width: number, height: number): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

describe('compressImage', () => {
  it('scales the longest edge down to the cap', async () => {
    const source = await png(3000, 1500)
    const out = await compressImage(source, 'image/png', {
      maxEdge: 800,
      quality: 82,
      toWebp: true,
    })
    expect(out.width).toBe(800)
    expect(out.height).toBe(400)
    expect(out.contentType).toBe('image/webp')
  })

  it('leaves an already small image at its own size', async () => {
    const source = await png(300, 200)
    const out = await compressImage(source, 'image/png', {
      maxEdge: 800,
      quality: 82,
      toWebp: true,
    })
    expect(out.width).toBe(300)
    expect(out.height).toBe(200)
  })

  it('keeps the source format when asked', async () => {
    const source = await png(400, 400)
    const out = await compressImage(source, 'image/png', {
      maxEdge: 2400,
      quality: 82,
      toWebp: false,
    })
    expect(out.contentType).toBe('image/png')
  })

  it('rejects bytes that are not a decodable image', async () => {
    await expect(
      compressImage(new Uint8Array([1, 2, 3, 4]), 'image/png', {
        maxEdge: 2400,
        quality: 82,
        toWebp: true,
      }),
    ).rejects.toThrow()
  })
})
