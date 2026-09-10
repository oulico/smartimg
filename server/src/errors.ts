export type ApiErrorCode = 'invalid_upload' | 'unsafe_key' | 'unauthorized'
/** 403 is what S3 answers when an upload does not match what was signed. */
export type ApiStatus = 400 | 401 | 403

export class ApiError extends Error {
  readonly status: ApiStatus
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, status: ApiStatus, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}
