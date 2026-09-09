export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif'

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false
  }
  return signature.every((byte, index) => bytes[index] === byte)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ?? 0)
  }
  return out
}

/** AVIF: ftyp box whose major or compatible brands contain avif/avis. */
function isAvif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 4) !== 'ftyp') {
    return false
  }
  const boxSize =
    ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
  const end = Math.min(boxSize, bytes.length)
  for (let i = 8; i + 4 <= end; i += 4) {
    const brand = ascii(bytes, i, 4)
    if (brand === 'avif' || brand === 'avis') {
      return true
    }
  }
  return false
}

export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  const isGif =
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  if (isGif) {
    return 'image/gif'
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp'
  }
  if (isAvif(bytes)) {
    return 'image/avif'
  }
  return null
}
