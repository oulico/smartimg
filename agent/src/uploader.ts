import { buildImageUrl } from '@smartimg/shared'
import ky, { HTTPError } from 'ky'
import { z } from 'zod'

const PresignResponseSchema = z.object({
  key: z.string().min(1),
  method: z.literal('PUT'),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
})

const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

export type UploadRequest = {
  readonly filename: string
  readonly contentType: string
  readonly bytes: Uint8Array
  /** NAS share path; when set the key mirrors it instead of getting a UUID. */
  readonly path?: string | undefined
  /** Hex digest of the bytes in `bytes` — what is stored, not what it came
   *  from. Only meaningful alongside `path`. */
  readonly contentHash?: string | undefined
}

export type UploadedImage = {
  readonly key: string
  readonly url: string
}

export type UploaderConfig = {
  readonly apiBaseUrl: string
  readonly apiToken: string | undefined
  readonly folder: string
  readonly cdnBase: string
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

async function describeHttpError(error: HTTPError): Promise<string> {
  const body = await error.response.text()
  const parsed = ApiErrorBodySchema.safeParse(parseJson(body))
  if (parsed.success) {
    return parsed.data.error.message
  }
  return 'HTTP ' + String(error.response.status) + ' ' + error.response.statusText
}

export function createUploader(
  config: UploaderConfig,
): (request: UploadRequest) => Promise<UploadedImage> {
  const client = ky.create({
    prefixUrl: config.apiBaseUrl,
    headers: config.apiToken === undefined ? {} : { Authorization: 'Bearer ' + config.apiToken },
  })
  return async (request) => {
    let presigned: z.infer<typeof PresignResponseSchema>
    try {
      presigned = PresignResponseSchema.parse(
        await client
          .post('images/presign', {
            json:
              request.path === undefined
                ? {
                    filename: request.filename,
                    contentType: request.contentType,
                    size: request.bytes.byteLength,
                    folder: config.folder,
                  }
                : {
                    path: request.path,
                    contentType: request.contentType,
                    size: request.bytes.byteLength,
                    // Omitted unless versioning: its absence is what makes the
                    // key mirror the path and stay overwritable.
                    ...(request.contentHash === undefined
                      ? {}
                      : { contentHash: request.contentHash }),
                  },
          })
          .json(),
      )
    } catch (error) {
      if (error instanceof HTTPError) {
        throw new UploadError(await describeHttpError(error))
      }
      if (error instanceof z.ZodError) {
        throw new UploadError('unexpected presign response: ' + z.prettifyError(error))
      }
      throw error
    }
    try {
      await ky.put(presigned.url, {
        body: request.bytes,
        headers: presigned.headers,
        timeout: 120_000,
      })
    } catch (error) {
      if (error instanceof HTTPError) {
        throw new UploadError(await describeHttpError(error))
      }
      throw error
    }
    return { key: presigned.key, url: buildImageUrl(config.cdnBase, presigned.key) }
  }
}
