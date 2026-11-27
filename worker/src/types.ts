// Shared Hono types. (EMAIL_SINK_KEY is optional in the generated Env: production doesn't declare it.)
export type AppEnv = Env

// An optional secret: without it the stocks view is off (M11). Not in `secrets.required`, so a deploy never fails on it.
declare global {
  interface Env {
    BHARATSTOCK_API_KEY?: string
    RAPIDAPI_KEY?: string // mfforecast on RapidAPI, the last stocks fallback (optional)
  }
  namespace Cloudflare {
    interface Env {
      BHARATSTOCK_API_KEY?: string
      RAPIDAPI_KEY?: string // mfforecast on RapidAPI, the last stocks fallback (optional)
    }
  }
}

export type SessionUser = { id: string; name: string; email: string; image?: string | null }

export type AppBindings = {
  Bindings: AppEnv
  Variables: {
    user: SessionUser
    householdId: string
    sessionId: string
    /** ms; the account-deletion route needs a session younger than 10 minutes (plan §9.2). */
    sessionCreatedAt: number
    /** The session carries consent to the current notice (always true past a consent-gated requireSession). */
    consentOk: boolean
    /** Set by a route that deleted the session (DELETE /api/account): the middleware then adds no cookies. */
    sessionEnded?: boolean
  }
}
