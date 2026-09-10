import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()
if (config.apiToken === undefined) {
  // loadConfig only allows this in mock mode, so this is local development.
  console.warn('[smartimg] IMAGE_API_TOKEN is not set: authentication is disabled (mock S3).')
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
