import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, Image as ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { type ImageObject, listImages } from '../../lib/api'
import { ImageDetailsDialog } from './ImageDetailsDialog'
import { ImageGrid } from './ImageGrid'
import { UploadPanel } from './UploadPanel'

function chipLabel(path: string, folder: string | null): string {
  return folder === null ? path : path.slice(folder.length + 1)
}

function Breadcrumb({ folder }: { readonly folder: string | null }) {
  const [, setSearchParams] = useSearchParams()
  if (folder === null) {
    return <span className="text-sm text-muted-foreground">All images</span>
  }
  const segments = folder.split('/')
  return (
    <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        className="rounded px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => {
          setSearchParams({})
        }}
      >
        All images
      </button>
      {segments.map((segment, index) => {
        const partial = segments.slice(0, index + 1).join('/')
        const isLast = index === segments.length - 1
        return (
          <span key={partial} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            {isLast ? (
              <span className="px-1">{segment}</span>
            ) : (
              <button
                type="button"
                className="rounded px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setSearchParams({ folder: partial })
                }}
              >
                {segment}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {SKELETON_IDS.map((id) => (
        <div key={id} className="overflow-hidden rounded-lg border border-border">
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

const SKELETON_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-10 text-center">
      <ImageIcon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No images in this folder yet</p>
    </div>
  )
}

export function ImagesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const folder = searchParams.get('folder')
  const imagesQuery = useQuery({
    queryKey: ['images', folder],
    queryFn: () => listImages(folder),
    refetchInterval: 15_000,
  })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const objects = imagesQuery.data?.objects ?? []
  const folders = imagesQuery.data?.folders ?? []
  const selected: ImageObject | null = objects.find((object) => object.key === selectedKey) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Images</h1>
        <Breadcrumb folder={folder} />
      </div>
      <UploadPanel folder={folder} />
      {folders.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {folders.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                setSearchParams({ folder: path })
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Folder className="h-3.5 w-3.5" />
              {chipLabel(path, folder)}
            </button>
          ))}
        </div>
      ) : null}
      {imagesQuery.isPending ? (
        <SkeletonGrid />
      ) : imagesQuery.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10 text-center">
          <p className="text-sm text-destructive">Failed to load images</p>
          <Button variant="outline" size="sm" onClick={() => void imagesQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : objects.length === 0 ? (
        <EmptyState />
      ) : (
        <ImageGrid objects={objects} onSelect={setSelectedKey} />
      )}
      {selected !== null ? (
        <ImageDetailsDialog
          key={selected.key}
          image={selected}
          open
          onClose={() => setSelectedKey(null)}
        />
      ) : null}
    </div>
  )
}
