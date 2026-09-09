import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const EnvSchema = z.object({
  IMAGE_API_URL: z.url(),
  IMAGE_API_TOKEN: z.string().trim().min(1).optional(),
  IMAGE_CDN_BASE: z.url(),
  AGENT_ROOT: z.string().trim().min(1).default('~/ImageDrop'),
  IMAGE_FOLDER: z.string().trim().min(1).default('uploads'),
  AGENT_STABILITY_MS: z.coerce.number().int().nonnegative().default(1000),
})

export type AgentDirs = {
  readonly inbox: string
  readonly uploaded: string
  readonly failed: string
  readonly results: string
}

export type AgentConfig = {
  readonly apiBaseUrl: string
  readonly apiToken: string | undefined
  readonly cdnBase: string
  readonly folder: string
  readonly stabilityMs: number
  readonly dirs: AgentDirs
}

export function loadAgentConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgentConfig {
  const parsed = EnvSchema.parse(env)
  const root = parsed.AGENT_ROOT.startsWith('~')
    ? join(homedir(), parsed.AGENT_ROOT.slice(1))
    : parsed.AGENT_ROOT
  return {
    apiBaseUrl: parsed.IMAGE_API_URL.replace(/\/+$/, ''),
    apiToken: parsed.IMAGE_API_TOKEN,
    cdnBase: parsed.IMAGE_CDN_BASE.replace(/\/+$/, ''),
    folder: parsed.IMAGE_FOLDER,
    stabilityMs: parsed.AGENT_STABILITY_MS,
    dirs: {
      inbox: join(root, 'Inbox'),
      uploaded: join(root, 'Uploaded'),
      failed: join(root, 'Failed'),
      results: join(root, 'Results'),
    },
  }
}
