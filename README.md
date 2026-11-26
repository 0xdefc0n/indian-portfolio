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
`curl 'localhost:8787/cdn-cgi/handler/scheduled?cron=30+17+*+*+*'`. Stocks inside funds need `BHARATSTOCK_API_KEY` in
`worker/.dev.vars`. Builds then ask for the BharatStock job, which spends at most 50 calls a day across all users.

Tests: `cd engine && uv run pytest -q`, `cd worker && npm test` (needs Docker), `cd web && npm run build && npm run lint`.
`BHARATSTOCK_LIVE=1 npx vitest run test/stocks.live.test.ts` (in `worker/`) checks stocks against the real BharatStock
API (it spends about 5 of the day's calls).

## Where things are
- `web/`: the dashboard SPA (`src/App.tsx`, `components/`, `pages/`)
- `worker/`: the Cloudflare Worker (Hono): sign-in, uploads, encryption, NAV store, snapshot builds, queues and crons.
  See [worker/README.md](worker/README.md).
- `engine/`: the Python engine (CAS parsers and portfolio builds) as a stateless container. See
  [engine/README.md](engine/README.md). `uv run python -m engine.cli FILE.pdf` parses statements from the command line
  (redacted output).

## Privacy
PocketFolio is a hosted, multi-user app now: data is stored on Cloudflare, not on your machine. What users are told is
in the app at `/privacy`, `/terms` and `/security` (`web/src/pages/legal.tsx`), and they accept a consent notice before
any data route works.

- **PDFs are never kept.** A statement is parsed in memory. Only when the engine is busy is it parked, encrypted, for
  at most 24 hours (usually minutes), then deleted.
- **Encrypted per household.** Parsed statements, snapshots, member names, PANs and SIP changes are sealed with
  AES-256-GCM under a per-household key, which is itself wrapped by a key-encryption key held as a Worker secret.
- **Users' rights.** Settings has *Download my data* (everything, decrypted, as JSON) and *Delete account*
  (crypto-shredding: the key goes first, then the R2 objects and every row; backups become unreadable at once and are
  purged within 30 days). Accounts unused for 3 years get an email, then are erased 48 hours later.
- **Logs** carry opaque ids, counts and timings only, never PANs, names, emails, folios, amounts or holdings. The
  security log (`audit_event`) is kept 400 days. The UI shows PANs masked (`AB••••••4F`).
- **Development data.** Real statements live only in git-ignored folders (`data/`, `engine/tests/private/`) and are
  never committed or printed.
- **Incidents:** [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md). Design: plan §0, §8 and §12.
