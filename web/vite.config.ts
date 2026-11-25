import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // /api goes to the Worker (`cd worker && npm run dev`). Until M10 the old local app can still be used with
  // API_TARGET=http://localhost:8000 npm run dev.
  server: { proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' } },
})
