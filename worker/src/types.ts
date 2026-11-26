// Shared Hono types. (EMAIL_SINK_KEY is optional in the generated Env: production doesn't declare it.)
export type AppEnv = Env

// An optional secret: without it the stocks view is off (M11). Not in `secrets.required`, so a deploy never fails on it.
declare global {
  interface Env {
    BHARATSTOCK_API_KEY?: string
  }
  namespace Cloudflare {
    interface Env {
      BHARATSTOCK_API_KEY?: string
    }
  }
}

export type SessionUser = { id: string; name: string; email: string; image?: string | null }

export type AppBindings = {
  Bindings: AppEnv
  Variables: { user: SessionUser; householdId: string; sessionId: string }
}
