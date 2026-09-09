export const IMAGE_PRESETS = {
  thumbnail: { mode: 'crop', width: 200, height: 200, quality: 75 },
  productCard: { mode: 'crop', width: 480, height: 480, quality: 80 },
  productDetail: { mode: 'fit', width: 1200, quality: 80 },
  hero: { mode: 'fit', width: 1920, quality: 80 },
} as const

export type ImagePreset = keyof typeof IMAGE_PRESETS

export type ImageOptions = { readonly preset?: ImagePreset | undefined }

type PresetSpec = (typeof IMAGE_PRESETS)[ImagePreset]

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

function transformPath(spec: PresetSpec): string {
  const dims = spec.mode === 'crop' ? spec.width + 'x' + spec.height : 'fit-in/' + spec.width + 'x0'
  return dims + '/filters:format(auto):quality(' + String(spec.quality) + ')'
}

export function buildImageUrl(base: string, key: string, options?: ImageOptions): string {
  const trimmedBase = base.replace(/\/+$/, '')
  const path = encodeKey(key)
  const preset = options?.preset
  if (preset === undefined) {
    return trimmedBase + '/' + path
  }
  return trimmedBase + '/' + transformPath(IMAGE_PRESETS[preset]) + '/' + path
}
