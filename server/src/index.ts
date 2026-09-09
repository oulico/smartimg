import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()
if (config.apiToken === undefined) {
  console.warn(
    '[smartimg] IMAGE_API_TOKEN is not set: authentication is disabled. ' +
      'This is only acceptable in local development.',
  )
}

const { app } = createApp(config)
const server = Bun.serve({
  port: config.port,
  fetch: (request) => app.fetch(request),
  maxRequestBodySize: config.maxUploadBytes,
})
console.log(
  '[smartimg] API listening on http://127.0.0.1:' +
    String(server.port) +
    ' (mock S3: ' +
    String(config.mock) +
    ')',
)
