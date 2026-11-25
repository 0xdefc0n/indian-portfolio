// Only for `npx auth generate` (writes migrations/app/0001_auth.sql). Same options as the Worker, with a stub env:
// the CLI diffs against an empty in-memory SQLite, so the output is the full schema.
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { authOptions, type AuthEnv } from '../src/auth'

const { database: _db, rateLimit: _rl, ...options } = authOptions({
  DB: undefined as never,
  APP_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'schema-only-secret-schema-only-secret',
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_CLIENT_SECRET: 'x',
  DATA_KEK_V1: '',
} satisfies AuthEnv)

export const auth = betterAuth({ ...options, database: new DatabaseSync(':memory:') })
