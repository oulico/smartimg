import { Image } from '../../components/Image'
import type { ImageObject } from '../../lib/api'
import { basename, formatBytes, formatDate } from '../../lib/format'

export type ImageGridProps = {
  readonly objects: readonly ImageObject[]
  readonly onSelect: (key: string) => void
}

export function ImageGrid({ objects, onSelect }: ImageGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {objects.map((object) => (
        <button
          key={object.key}
          type="button"
          onClick={() => onSelect(object.key)}
          className="overflow-hidden rounded-lg border border-border bg-background text-left transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Image src={object.key} preset="thumbnail" className="aspect-square w-full" />
          <div className="space-y-0.5 p-3">
            <p className="truncate text-sm">{basename(object.key)}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(object.size)} · {formatDate(object.lastModified)}
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}
