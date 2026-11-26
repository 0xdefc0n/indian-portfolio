// A safe, expected API error: app.onError turns it into JSON { ok: false, code } with its status. Codes are stable
// and never carry request data (plan §0.1, §9.2).
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class ApiError extends Error {
  override name = 'ApiError'
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code)
  }
}

/** 404, not 403, for anything outside the session's household: don't reveal that it exists (§9.1). */
export const notFound = () => new ApiError(404, 'not_found')
