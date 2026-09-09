/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMAGE_CDN_URL?: string
  readonly VITE_IMAGE_API_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
