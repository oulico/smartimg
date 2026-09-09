import {
  CACHE_CONTROL,
  type ImageStore,
  type ListResult,
  type PresignedUpload,
  type StoredImage,
} from './store'

type MockObject = {
  readonly body: Uint8Array<ArrayBuffer>
  readonly contentType: string
  readonly cacheControl: string
  readonly lastModified: Date
}

export class MockStore implements ImageStore {
  private readonly objects = new Map<string, MockObject>()

  constructor(private readonly baseUrl: string) {}

  presignPut(
    key: string,
    contentType: string,
    cacheControl: string = CACHE_CONTROL,
  ): Promise<PresignedUpload> {
    const encoded = key.split('/').map(encodeURIComponent).join('/')
    return Promise.resolve({
      url: this.baseUrl + '/mock-put/' + encoded,
      headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl },
    })
  }

  put(
    key: string,
    body: Uint8Array<ArrayBuffer>,
    contentType: string,
    cacheControl: string = CACHE_CONTROL,
  ): void {
    this.objects.set(key, { body, contentType, cacheControl, lastModified: new Date() })
  }

  read(key: string): MockObject | undefined {
    return this.objects.get(key)
  }

  resolveKeyFromPath(segments: readonly string[]): string | null {
    for (let i = 0; i < segments.length; i++) {
      const candidate = segments
        .slice(i)
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      if (this.objects.has(candidate)) return candidate
    }
    return null
  }

  async list(folder: string | null): Promise<ListResult> {
    const prefix = folder === null ? '' : folder + '/'
    const folders = new Set<string>()
    const objects: StoredImage[] = []
    for (const [key, object] of this.objects) {
      if (key.startsWith(prefix) === false) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        objects.push({
          key,
          size: object.body.byteLength,
          lastModified: object.lastModified,
        })
      } else if (slash > 0) {
        folders.add(prefix + rest.slice(0, slash))
      }
    }
    objects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
    return { objects, folders: [...folders].sort(), nextToken: null }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
}
