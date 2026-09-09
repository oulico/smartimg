export function basename(key: string): string {
  const parts = key.split('/')
  return parts[parts.length - 1] ?? key
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return String(bytes) + ' B'
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB'
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatDate(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso))
}
