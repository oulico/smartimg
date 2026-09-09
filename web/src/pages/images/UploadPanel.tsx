import { useQueryClient } from '@tanstack/react-query'
import AwsS3 from '@uppy/aws-s3'
import Uppy from '@uppy/core'
import Dashboard from '@uppy/dashboard'
import { useEffect, useRef } from 'react'
import { presignUpload } from '../../lib/api'

const MAX_UPLOAD_BYTES = 10_485_760
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']

function logicalFolder(folder: string | null): string | undefined {
  if (folder === null) {
    return undefined
  }
  const segments = folder.split('/')
  while (segments.length > 1) {
    const last = segments[segments.length - 1] ?? ''
    if (!/^\d{2}$/.test(last) && !/^\d{4}$/.test(last)) {
      break
    }
    segments.pop()
  }
  return segments.join('/')
}

export type UploadPanelProps = {
  readonly folder: string | null
}

export function UploadPanel({ folder }: UploadPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const folderRef = useRef(folder)
  const queryClient = useQueryClient()

  useEffect(() => {
    folderRef.current = folder
  }, [folder])

  useEffect(() => {
    const target = containerRef.current
    if (target === null) {
      return
    }
    const uppy = new Uppy({
      restrictions: {
        allowedFileTypes: ALLOWED_FILE_TYPES,
        maxFileSize: MAX_UPLOAD_BYTES,
      },
    })
    uppy.use(Dashboard, {
      target,
      inline: true,
      height: 300,
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: false,
      note: 'Images up to 10 MB',
    })
    uppy.use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: (file) =>
        presignUpload({
          filename: file.name ?? 'image',
          contentType: file.type ?? '',
          size: file.size ?? 0,
          folder: logicalFolder(folderRef.current),
        }).then((response) => ({
          method: 'PUT' as const,
          url: response.url,
          headers: response.headers,
        })),
    })
    uppy.on('complete', (result) => {
      if ((result.successful ?? []).length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['images'] })
      }
    })
    return () => {
      uppy.destroy()
    }
  }, [queryClient])

  return <div ref={containerRef} className="overflow-hidden rounded-lg border border-border" />
}
