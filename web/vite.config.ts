/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app (plan §13A.1). The service worker precaches the app shell only; /api/* is never cached, so no
    // portfolio data ever lands in Cache Storage (phones get shared and lost, and DPDP applies).
    VitePWA({
      registerType: 'prompt', // a waiting SW shows the "new version" toast (src/components/pwa.tsx)
      injectRegister: false, // registered from src/lib/install.ts
      manifest: false, // public/manifest.webmanifest is hand-written
      workbox: {
        globPatterns: ['**/*.{html,js,css,woff2,svg,png,ico}'],
        globIgnores: ['screens/**'], // install-dialog screenshots: fetched only by the browser's install UI
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
      },
    }),
  ],
  // @manual-assets: the FD/PPF/EPF calculator shared with the Worker (plan §21.12), so values are computed live here
  // with the same code the Worker uses. Only that module (and the rate table it imports) is reachable.
  resolve: {
    alias: {
      '@manual-assets': path.resolve(__dirname, '../worker/src/lib/manual-assets.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  // /api goes to the Worker (`cd worker && npm run dev`). Until M10 the old local app can still be used with
  // API_TARGET=http://localhost:8000 npm run dev.
  server: {
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' },
    fs: { allow: [__dirname, path.resolve(__dirname, '../worker/src/lib')] },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
