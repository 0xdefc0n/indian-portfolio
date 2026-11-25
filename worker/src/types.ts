// Shared Hono types. (EMAIL_SINK_KEY is optional in the generated Env: production doesn't declare it.)
export type AppEnv = Env

export type SessionUser = { id: string; name: string; email: string; image?: string | null }

export type AppBindings = {
  Bindings: AppEnv
  Variables: { user: SessionUser; householdId: string; sessionId: string }
}
