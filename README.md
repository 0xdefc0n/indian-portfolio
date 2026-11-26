# PocketFolio

Your family's mutual funds, in one place. Each family member's CDSL eCAS and CAMS / KFintech consolidated statement
goes into one dashboard. A fund that appears in both is counted once: units and NAV come from the newer statement,
pledges from CDSL, the invested amount from CAMS/KFintech.

It's moving from a single-user laptop app to a multi-user app on Cloudflare. The design is
[docs/MULTI_USER_LAUNCH_PLAN.md](docs/MULTI_USER_LAUNCH_PLAN.md) and the build order is
[docs/MILESTONES.md](docs/MILESTONES.md).

## Run
Needs **Node ≥ 22.12** (`worker/.nvmrc`), **Docker** running (the engine runs as a container) and **uv** (engine tests).
```bash
# frontend (React + shadcn/ui), served by the Worker from web/dist
cd web && npm ci && npm run build && cd ..

# Worker + engine containers on http://localhost:8787
cd worker && npm ci
cp .dev.vars.example .dev.vars                     # fill in local values (see worker/README.md)
npx wrangler d1 migrations apply DB --local        # once, and after adding a migration
npx wrangler d1 migrations apply MARKET --local
npm run dev                                        # wrangler dev; builds and starts the engine image
```
Open http://localhost:8787 and sign in (locally, emails are logged by `wrangler dev` instead of sent).
For the dashboard with hot reload, also run `npm run dev` in `web/` and open http://localhost:5173 (Vite proxies
`/api` to :8787). To load NAVs locally, run nav-ingest once: `npx wrangler dev --test-scheduled`, then
`curl 'localhost:8787/cdn-cgi/handler/scheduled?cron=30+17+*+*+*'`.

Tests: `cd engine && uv run pytest -q`, `cd worker && npm test` (needs Docker), `cd web && npm run build && npm run lint`.

## Where things are
- `web/`: the dashboard SPA (`src/App.tsx`, `components/`, `pages/`)
- `worker/`: the Cloudflare Worker (Hono): sign-in, uploads, encryption, NAV store, snapshot builds, queues and crons.
  See [worker/README.md](worker/README.md).
- `engine/`: the Python engine (CAS parsers and portfolio builds) as a stateless container. See
  [engine/README.md](engine/README.md). `uv run python -m engine.cli FILE.pdf` parses statements from the command line
  (redacted output).

## Privacy
Statements are parsed in memory and never kept as PDFs. Parsed data is compressed, then encrypted with a per-household
key before it's stored. Logs carry opaque ids, counts and timings only, never PANs, names, amounts or holdings. The
dashboard shows PANs masked. Real statements for development live only in git-ignored folders (`data/`,
`engine/tests/private/`). Details: plan §0, §8 and §12.
