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
    expect(predictKey('smartimg/1.업무보고서/박홍제/monkey.jpg', undefined, 'image/webp')).toBe(
      'smartimg/1.업무보고서/박홍제/monkey.webp',
    )
  })

  it('adds the digest when versioning', () => {
    expect(predictKey('smartimg/1.업무보고서/박홍제/monkey.jpg', '9f3a2c1dead', 'image/webp')).toBe(
      'smartimg/1.업무보고서/박홍제/monkey.9f3a2c1.webp',
    )
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
