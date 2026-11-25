# worker

TypeScript Cloudflare Worker (Hono). It serves the SPA from `web/dist`, the `/api/*` routes, Better Auth, crypto, cron
jobs and queue consumers, and the `EnginePool` / `EngineFast` / `EngineBatch` Durable Objects.

Scaffolded in milestone **M2** ([docs/MILESTONES.md](../docs/MILESTONES.md)). Design: plan §4, §5 and §15.

Secrets: copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill it in. Never commit values or paste them into chat.
