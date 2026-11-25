// Runs before each test file: applies migrations/app to the test D1 (idempotent; tracked in d1_migrations).
import { applyD1Migrations, env } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_APP_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_APP_MIGRATIONS)
