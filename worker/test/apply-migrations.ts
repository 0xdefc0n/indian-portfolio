// Runs before each test file: applies migrations/app and migrations/market to the test D1s (idempotent; tracked in
// d1_migrations).
import { applyD1Migrations, env } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_APP_MIGRATIONS: import('cloudflare:test').D1Migration[]
      TEST_MARKET_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_APP_MIGRATIONS)
await applyD1Migrations(env.MARKET, env.TEST_MARKET_MIGRATIONS)
