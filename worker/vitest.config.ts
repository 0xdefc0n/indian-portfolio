import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd with the bindings from wrangler.jsonc (plan §16).
// Containers aren't started in tests: the engine container is exercised by `wrangler dev` (see README).
export default defineConfig({
  test: {
    // Node-side: loads private statements (git-ignored) and the engine's view of them for pdfcheck.private.test.ts.
    globalSetup: ['./test/global-setup.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { ENGINE_SHARED_SECRET: 'test-only-engine-key', ENGINE_FAST_MAX: '3', ENGINE_BATCH_MAX: '2' },
      },
    }),
  ],
})
