import type { ComponentProps } from 'react'
import { type ImagePreset, image } from '../lib/images'
import { cn } from '../lib/utils'

type ImageProps = Omit<ComponentProps<'img'>, 'src'> & {
  src: string
  preset?: ImagePreset | undefined
}

export function Image({ src, preset, alt, className, ...rest }: ImageProps) {
  const resolved = /^(https?:|data:|blob:)/.test(src) ? src : image(src, { preset })
  return (
    <img
      src={resolved}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      className={cn('object-cover', className)}
      {...rest}
    />
  )
}
