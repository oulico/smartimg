import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'

export type DialogProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  className?: string | undefined
}

export function Dialog({ open, title, onClose, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: closes the dialog when the overlay itself is clicked
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'w-full max-w-2xl rounded-lg border border-border bg-background p-6 shadow-xl focus:outline-none',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
