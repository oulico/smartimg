import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { hasErrnoCode } from '../src/errno'

const REPO_ROOT = resolve(process.cwd(), '..')
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const NOT_AN_IMAGE = new TextEncoder().encode('hello')
const TOKEN = 'e2e-token'

let server: ChildProcess | null = null
let agent: ChildProcess | null = null
let serverBase = ''
let agentRoot = ''

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port
      probe.close(() => {
        resolvePort(port)
      })
    })
  })
}

async function waitFor(predicate: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    if (await predicate()) {
      return
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for ' + what)
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  }
}

function startProcess(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  return child
}

async function dirEntries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }
}

beforeAll(async () => {
  const port = await freePort()
  serverBase = 'http://127.0.0.1:' + String(port)
  server = startProcess('bun', [join(REPO_ROOT, 'server/src/index.ts')], {
    PORT: String(port),
    MOCK_S3: 'true',
    IMAGE_API_TOKEN: TOKEN,
  })
  await waitFor(async () => {
    try {
      const response = await fetch(serverBase + '/api/images?folder=uploads', {
        headers: { Authorization: 'Bearer ' + TOKEN },
      })
      return response.ok
    } catch {
      return false
    }
  }, 'API server readiness')

  agentRoot = await mkdtemp(join(tmpdir(), 'smartimg-e2e-'))
  const inbox = join(agentRoot, 'Inbox')
  await mkdir(inbox, { recursive: true })
  await writeFile(join(inbox, 'red.png'), PNG_BYTES)
  await writeFile(join(inbox, 'blue.png'), PNG_BYTES)
  await writeFile(join(inbox, 'notes.txt'), NOT_AN_IMAGE)

  agent = startProcess('bun', [join(REPO_ROOT, 'agent/src/main.ts')], {
    IMAGE_API_URL: serverBase + '/api',
    IMAGE_API_TOKEN: TOKEN,
    IMAGE_CDN_BASE: serverBase + '/mock-cdn',
    AGENT_ROOT: agentRoot,
    AGENT_STABILITY_MS: '100',
  })
}, 30_000)

afterAll(async () => {
  for (const child of [agent, server]) {
    if (child !== null && child.exitCode === null) {
      child.kill('SIGTERM')
    }
  }
  await Promise.all(
    [agent, server].map((child) =>
      child === null
        ? Promise.resolve()
        : new Promise<void>((resolveExit) => {
            if (child.exitCode !== null) {
              resolveExit()
              return
            }
            child.once('exit', () => {
              resolveExit()
            })
          }),
    ),
  )
}, 15_000)

it('uploads dropped files end to end and the library lists them', async () => {
  const uploaded = join(agentRoot, 'Uploaded')
  const failed = join(agentRoot, 'Failed')
  const results = join(agentRoot, 'Results')

  await waitFor(async () => (await dirEntries(uploaded)).length === 2, 'two uploaded files')
  await waitFor(async () => (await dirEntries(failed)).length === 1, 'one failed file')
  await waitFor(
    async () => (await dirEntries(results)).filter((name) => name.endsWith('.json')).length === 1,
    'batch JSON result',
  )

  expect((await dirEntries(uploaded)).sort()).toEqual(['blue.png', 'red.png'])
  expect(await dirEntries(failed)).toEqual(['notes.txt'])
  const resultFiles = await dirEntries(results)
  expect(resultFiles.filter((name) => name.endsWith('.md'))).toHaveLength(1)

  const jsonName = resultFiles.find((name) => name.endsWith('.json')) ?? ''
  const batch = JSON.parse(await readFile(join(results, jsonName), 'utf8')) as {
    readonly results: readonly {
      readonly status: string
      readonly source: string
      readonly key?: string
      readonly url?: string
    }[]
  }
  const uploadedEntries = batch.results.filter((entry) => entry.status === 'uploaded')
  expect(uploadedEntries.map((entry) => entry.source).sort()).toEqual(['blue.png', 'red.png'])
  expect(
    uploadedEntries.every((entry) => entry.url === serverBase + '/mock-cdn/' + entry.key),
  ).toBe(true)

  const listResponse = await fetch(
    serverBase +
      '/api/images?folder=' +
      encodeURIComponent((uploadedEntries[0]?.key ?? '').split('/').slice(0, -1).join('/')),
    { headers: { Authorization: 'Bearer ' + TOKEN } },
  )
  const listed = (await listResponse.json()) as {
    readonly objects: readonly { readonly key: string }[]
  }
  for (const entry of uploadedEntries) {
    expect(listed.objects.some((object) => object.key === entry.key)).toBe(true)
  }
}, 45_000)
