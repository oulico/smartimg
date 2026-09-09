import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Image } from '../../components/Image'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { deleteImage, type ImageObject } from '../../lib/api'
import { basename, formatBytes, formatDate } from '../../lib/format'
import { image } from '../../lib/images'
import { cn } from '../../lib/utils'

const PRESET_CHOICES = [
  { id: 'original', label: 'Original' },
  { id: 'thumbnail', label: 'Thumbnail' },
  { id: 'productCard', label: 'Card' },
  { id: 'productDetail', label: 'Detail' },
  { id: 'hero', label: 'Hero' },
] as const

type PresetChoice = (typeof PRESET_CHOICES)[number]['id']

function buildUrl(key: string, choice: PresetChoice): string {
  if (choice === 'original') {
    return image(key)
  }
  return image(key, { preset: choice })
}

export type ImageDetailsDialogProps = {
  readonly image: ImageObject
  readonly open: boolean
  readonly onClose: () => void
}

export function ImageDetailsDialog({ image: selected, open, onClose }: ImageDetailsDialogProps) {
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<PresetChoice>('thumbnail')
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const url = buildUrl(selected.key, choice)

  const deleteMutation = useMutation({
    mutationFn: () => deleteImage(selected.key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['images'] })
      onClose()
    },
  })

  function copyUrl(): void {
    void navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <Dialog open={open} title={basename(selected.key)} onClose={onClose} className="max-w-xl">
      <div className="space-y-4">
        <div className="flex justify-center rounded-lg border border-border bg-muted p-4">
          <Image
            src={selected.key}
            preset={choice === 'original' ? undefined : choice}
            className="max-h-72 w-auto rounded-md object-contain"
          />
        </div>
        <fieldset className="flex flex-wrap gap-1 rounded-md bg-muted p-1" aria-label="Preset">
          {PRESET_CHOICES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={choice === preset.id}
              onClick={() => setChoice(preset.id)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                choice === preset.id
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {preset.label}
            </button>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-muted px-3 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button variant="outline" size="sm" onClick={copyUrl} className="h-9">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">File</dt>
          <dd className="min-w-0 truncate">{basename(selected.key)}</dd>
          <dt className="text-muted-foreground">Key</dt>
          <dd className="min-w-0 break-all font-mono text-xs">{selected.key}</dd>
          <dt className="text-muted-foreground">Size</dt>
          <dd>{formatBytes(selected.size)}</dd>
          <dt className="text-muted-foreground">Uploaded</dt>
          <dd>{formatDate(selected.lastModified)}</dd>
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {deleteMutation.isError ? (
            <p className="text-sm text-destructive">Delete failed. Try again.</p>
          ) : confirming ? (
            <p className="text-sm text-destructive">Delete this image permanently?</p>
          ) : (
            <span className="text-xs text-muted-foreground">
              Objects are immutable; deleting removes this image permanently.
            </span>
          )}
          {confirming ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete permanently'}
              </Button>
            </div>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
