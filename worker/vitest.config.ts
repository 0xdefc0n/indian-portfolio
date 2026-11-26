import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd with the bindings from wrangler.jsonc (plan §16).
// Containers aren't started in tests: the engine container is exercised by `wrangler dev` (see README).
// Secrets below are test-only values; they override anything in .dev.vars.
export default defineConfig(async () => {
  const appMigrations = await readD1Migrations('./migrations/app')
  const marketMigrations = await readD1Migrations('./migrations/market')
  return {
    test: {
      // Node-side: loads private statements (git-ignored) and the engine's view of them for pdfcheck.private.test.ts.
      globalSetup: ['./test/global-setup.ts'],
      setupFiles: ['./test/apply-migrations.ts', './test/no-market-network.ts', './test/no-rebuild-queue.ts'],
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            ENGINE_SHARED_SECRET: 'test-only-engine-key',
            ENGINE_FAST_MAX: '3',
            ENGINE_BATCH_MAX: '2',
            APP_URL: 'http://localhost:8787',
            BETTER_AUTH_SECRET: 'test-only-better-auth-secret-0123456789abcdef',
            GOOGLE_CLIENT_ID: 'test-google-client-id',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
            TURNSTILE_SECRET: 'test-turnstile-secret',
            DATA_KEK_V1: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
            PAN_PEPPER: 'test-only-pan-pepper-0123456789abcdef',
            EMAIL_SINK_KEY: 'test-only-email-sink-key-0123456789abcdef',
            BHARATSTOCK_API_KEY: 'test-only-bharatstock-key', // never the real key from .dev.vars; fetches are mocked
            TEST_APP_MIGRATIONS: appMigrations,
            TEST_MARKET_MIGRATIONS: marketMigrations,
          },
        },
      }),
    ],
  }
})
