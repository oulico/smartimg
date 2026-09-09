import type { ImageOptions } from '@smartimg/shared'
import { buildImageUrl } from '@smartimg/shared'

export type { ImageOptions, ImagePreset } from '@smartimg/shared'
export { IMAGE_PRESETS } from '@smartimg/shared'

function cdnBase(): string {
  const url = import.meta.env.VITE_IMAGE_CDN_URL
  if (url === undefined || url === '') {
    throw new Error('VITE_IMAGE_CDN_URL is not configured')
  }
  return url.replace(/\/+$/, '')
}

export function image(key: string, options?: ImageOptions): string {
  return buildImageUrl(cdnBase(), key, options)
}
