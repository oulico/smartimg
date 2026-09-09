import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  IMAGE_BUCKET: z.string().trim().min(1).optional(),
  IMAGE_BUCKET_REGION: z.string().trim().min(1).optional(),
  IMAGE_API_TOKEN: z.string().trim().min(1).optional(),
  MOCK_S3: z.enum(['true', 'false']).default('false'),
  MOCK_CORS_ORIGIN: z.string().trim().default('http://localhost:5173'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  MUTABLE_MAX_AGE_SECONDS: z.coerce.number().int().nonnegative().default(60),
})

export type Config = {
  readonly port: number
  readonly bucket: string
  readonly bucketRegion: string | undefined
  readonly apiToken: string | undefined
  readonly mock: boolean
  readonly mockCorsOrigin: string
  readonly maxUploadBytes: number
  readonly presignTtlSeconds: number
  /** Cache lifetime for path-mirrored keys, which get overwritten in place. */
  readonly mutableMaxAgeSeconds: number
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const parsed = EnvSchema.parse(env)
  const mock = parsed.MOCK_S3 === 'true'
  if (!mock && parsed.IMAGE_BUCKET === undefined) {
    throw new Error('IMAGE_BUCKET is required unless MOCK_S3=true')
  }
  return {
    port: parsed.PORT,
    bucket: parsed.IMAGE_BUCKET ?? '',
    bucketRegion: parsed.IMAGE_BUCKET_REGION,
    apiToken: parsed.IMAGE_API_TOKEN,
    mock,
    mockCorsOrigin: parsed.MOCK_CORS_ORIGIN,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    presignTtlSeconds: parsed.PRESIGN_TTL_SECONDS,
    mutableMaxAgeSeconds: parsed.MUTABLE_MAX_AGE_SECONDS,
  }
}
