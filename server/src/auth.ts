import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors'

/** Placeholder for the admin app's real session auth; swap this middleware in. */
export function requireAuth(token: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (token !== undefined) {
      const header = c.req.header('Authorization')
      if (header !== 'Bearer ' + token) {
        throw new ApiError('unauthorized', 401, 'missing or invalid bearer token')
      }
    }
    await next()
  }
}
