import {
  CACHE_CONTROL,
  type ImageStore,
  type ListResult,
  type PresignedUpload,
  type PresignPutRequest,
  type StoredImage,
} from './store'

type MockObject = {
  readonly body: Uint8Array<ArrayBuffer>
  readonly contentType: string
  readonly cacheControl: string
  readonly lastModified: Date
}

/** What a presigned URL committed an upload to; see signedTerms. */
export type SignedTerms = {
  readonly contentType: string
  readonly contentLength: number
  readonly cacheControl: string
}

export class MockStore implements ImageStore {
  private readonly objects = new Map<string, MockObject>()
  private readonly signed = new Map<string, SignedTerms>()

  constructor(private readonly baseUrl: string) {}

  presignPut(request: PresignPutRequest): Promise<PresignedUpload> {
    this.signed.set(request.key, {
      contentType: request.contentType,
      contentLength: request.contentLength,
      cacheControl: request.cacheControl,
    })
    const encoded = request.key.split('/').map(encodeURIComponent).join('/')
    return Promise.resolve({
      url: this.baseUrl + '/mock-put/' + encoded,
      headers: {
        'Content-Type': request.contentType,
        'Cache-Control': request.cacheControl,
      },
    })
  }

  /**
   * The terms a signature would hold the upload to. S3 enforces these through
   * SignedHeaders; the mock has no signature, so it checks them directly —
   * otherwise the mock would accept uploads that the real bucket refuses, and
   * every test would pass over the gap.
   */
  signedTerms(key: string): SignedTerms | undefined {
    return this.signed.get(key)
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
