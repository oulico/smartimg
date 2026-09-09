import sharp, { type Metadata, type OutputInfo, type Sharp } from 'sharp'
import type { ImageMime } from './sniff'

export type CompressOptions = {
  /** Longest edge, in pixels. Larger images are scaled down; smaller ones are left alone. */
  readonly maxEdge: number
  readonly quality: number
  /** Re-encode to WebP instead of keeping the source format. */
  readonly toWebp: boolean
}

export const DEFAULT_COMPRESS: CompressOptions = {
  maxEdge: 2400,
  quality: 82,
  toWebp: true,
}

export type CompressedImage = {
  readonly bytes: Uint8Array
  readonly contentType: ImageMime
  readonly width: number
  readonly height: number
}

export class CompressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompressError'
  }
}

/**
 * GIFs are left untouched: re-encoding one through a still pipeline silently
 * drops every frame but the first, and animation is the reason a GIF is a GIF.
 */
function passthrough(bytes: Uint8Array, contentType: ImageMime): boolean {
  return contentType === 'image/gif'
}

export async function compressImage(
  bytes: Uint8Array,
  contentType: ImageMime,
  options: CompressOptions = DEFAULT_COMPRESS,
): Promise<CompressedImage> {
  if (passthrough(bytes, contentType)) {
    const meta = await sharp(bytes).metadata()
    return { bytes, contentType, width: meta.width ?? 0, height: meta.height ?? 0 }
  }

  let image: Sharp
  let metadata: Metadata
  try {
    image = sharp(bytes, { failOn: 'error' }).rotate()
    metadata = await image.metadata()
  } catch (error) {
    throw new CompressError(error instanceof Error ? error.message : 'unreadable image')
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width === 0 || height === 0) {
    throw new CompressError('image has no readable dimensions')
  }

  if (Math.max(width, height) > options.maxEdge) {
    image = image.resize({
      width: width >= height ? options.maxEdge : undefined,
      height: height > width ? options.maxEdge : undefined,
      withoutEnlargement: true,
    })
  }

  const encoded = options.toWebp
    ? await image.webp({ quality: options.quality }).toBuffer({ resolveWithObject: true })
    : await encodeAsSource(image, contentType, options.quality)

  return {
    bytes: new Uint8Array(encoded.data),
    contentType: options.toWebp ? 'image/webp' : contentType,
    width: encoded.info.width,
    height: encoded.info.height,
  }
}

function encodeAsSource(
  image: Sharp,
  contentType: ImageMime,
  quality: number,
): Promise<{ data: Buffer; info: OutputInfo }> {
  switch (contentType) {
    case 'image/png':
      // PNG is lossless, so quality buys nothing; effort and palette do.
      return image
        .png({ compressionLevel: 9, effort: 8, palette: true })
        .toBuffer({ resolveWithObject: true })
    case 'image/webp':
      return image.webp({ quality }).toBuffer({ resolveWithObject: true })
    case 'image/avif':
      return image.avif({ quality }).toBuffer({ resolveWithObject: true })
    default:
      return image.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  }
}
