# worker

TypeScript Cloudflare Worker (Hono). It serves the SPA from `web/dist`, the `/api/*` routes, and later Better Auth,
crypto, cron jobs and queue consumers. It also holds the `EnginePool` / `EngineFast` / `EngineBatch` Durable Objects.
Design: plan §4, §5, §14 and §15 ([docs/MULTI_USER_LAUNCH_PLAN.md](../docs/MULTI_USER_LAUNCH_PLAN.md)).

## Layout
| Path | What |
|---|---|
| `wrangler.jsonc` | Every binding from plan §15.1. Resource IDs are local placeholders until M4. |
| `src/index.ts` | Hono app at `/api` (`/health`, `/config`, `/me`, `/members`, `/statements`, `/jobs`, `/market/status`, `/portfolio`), `scheduled()` (tmp-sweep, nav-ingest ×4, nav-repair, the snapshot-prebuild fallback), and `queue()` (pf-email, pf-parse, pf-market, pf-rebuild). Export only handlers and classes from it: workerd refuses any other export |
| `src/auth.ts` | Better Auth options, created per request (plan §7.1): Google, magic link + email code, cookie cache with `householdId` in the session, hashed tokens, D1 rate limits |
| `src/routes/auth.ts` | `/api/auth/*` allow-list, `POST /api/login/email` (Turnstile, limits, one email with link + code), the staging-only email sink reader |
| `src/middleware/session.ts` | `requireSession()`: sets `c.var.user` / `c.var.householdId`, 401 otherwise; 0 D1 queries with a warm cookie cache |
| `src/lib/email.ts` | `EmailSender`, Cloudflare Email Service sender, the `pf-email` consumer (per-message ack/retry by error code), sign-in template, test sink |
| `src/lib/crypto.ts` | KEK/DEK wrapping, KEK rotation (`rewrapDeks`), and `Vault`: one household's DEK per request, `seal`/`open` with the AAD bound to household + key |
| `src/lib/blob.ts` | R2 key layout, compress-then-encrypt JSON (`sealJson`/`openJson`), parked PDFs (no gzip), household-checked R2 put/get/delete |
| `src/lib/household.ts` | Household + empty snapshot created at signup; `shredHousehold()` crypto-shred (used by account deletion, M14) |
| `src/lib/tenant.ts` | The tenant guard: `tenant(c)` with `assertMember` / `assertStatement` (404 for other households), `keys.*`, `vault()` |
| `src/lib/members.ts`, `src/routes/members.ts` | `GET/PATCH/DELETE /api/members`: list (one D1 batch), rename (sealed name), delete (rows, then h/ and tmp/ blobs); `memberInsert` for M7 |
| `src/lib/statements.ts`, `src/routes/statements.ts` | `POST /api/statements` (plan §10.1 A–C: checks, candidate passwords, pdf.js pre-check, D19 member from the statement, engine `/parse`, `storeStatement` in one batch, `tracked_scheme` upsert) and `DELETE /api/statements/:id`. With no free slot the verified PDF is parked (`202`) |
| `src/lib/jobs.ts`, `src/routes/jobs.ts` | Queued path (plan §10.1 D, M8): `parkUpload` (sealed PDF in `tmp/`, `parse_job`, upload quota), the pf-parse consumer (slot waits re-send the message and aren't attempts; ≤ 3 engine attempts; the PDF is deleted on every outcome), `GET /api/jobs`, `GET/DELETE /api/jobs/:id`, and the hourly `tmp-sweep` |
| `src/lib/snapshot.ts`, `src/routes/portfolio.ts` | Snapshots (plan §10.2, M10): `requestRebuild()` (every trigger: stamps `requested_at`, sends a 10 s delayed pf-rebuild message), the pf-rebuild consumer (inputs hash, EngineBatch lease, single-flight claim, gzip build sealed under a new key, compare-and-set pointer, backfill follow-ups), snapshot-prebuild, and `GET /api/portfolio` (the sealed gzip sent as is, `X-Snapshot-*` headers, lazy rebuild on a stale read) + `GET /api/portfolio/status` |
| `src/market-gateway.ts` | `MarketGateway`: the engine container's only outbound route (`http://market.internal/nav/{code}.json` → R2 `market/nav/*`, read-only), registered by `EngineBatch` on every container start |
| `src/market/amfi.ts` | Pure parsers (plan §10.4.4): AMFI's daily file and history report (by header name), mfapi, YYYYMMDD dates, the ±20% anomaly rule |
| `src/market/store.ts` | NAV store writes: rows as one JSON array per statement (`json_each`), the scheme upsert that skips unchanged rows, `market_day` and finality, tracked ISIN → code, R2 series `market/nav/{code}.json` |
| `src/market/jobs.ts`, `src/routes/market.ts` | nav-ingest, nav-backfill (mfapi, then AMFI history in 90-day chunks), nav-repair, the pf-market consumer, `GET /api/market/status` (public, edge-cached 5 min). `src/market/amc-ids.ts`: AMFI's `mf=` ids |
| `src/lib/quota.ts`, `src/lib/limits.ts` | Fair-use counters: all-or-nothing increment-with-limit in one batch, IST windows; the §11 limit values |
| `src/lib/audit.ts`, `src/lib/errors.ts` | `audit_event` rows (no PII) joined to the caller's batch; `ApiError` → `{ ok: false, code }` |
| `src/lib/rate-limit.ts`, `src/lib/turnstile.ts` | One-UPSERT fixed-window limits (HMACed keys); Turnstile siteverify |
| `src/engine.ts` | `EngineFast` (standard-2) / `EngineBatch` (basic): each Durable Object owns one engine container through `ctx.container`, with a 60 s inactivity timeout, and adds `X-Engine-Key` |
| `src/engine-pool.ts`, `src/pool-core.ts` | `EnginePool`: slot leases, fill-first routing (warm first), lease expiry, moving-average job time, queue tickets (kept by queued jobs across waits), positions and ETA, and the global parked-PDF counter (§11) |
| `src/lib/engine-client.ts` | `withEngine()`: acquire, call the slot, always release. The only way to reach the engine. `engineApi.parse()` calls `/parse` (retries a refused connection, 60 s timeout), `engineApi.build()` calls `/build` (gzip answer, 100 s timeout); tests swap them for fakes |
| `src/lib/pdfcheck.ts` | Upload pre-check with pdf.js (plan §10.1 A5): candidate passwords, statement type, holder PAN, page count. pdf.js loads by dynamic import on first use |
| `test/pdfcheck*.test.ts` | Pre-check on synthetic PDFs (`test/helpers/pdf-fixture.ts` writes them, encrypted or not) and on private statements |
| `test/statements*.test.ts` | Upload on synthetic PDFs with a fake engine (`test/helpers/upload.ts`), and on private statements through the real engine container (direct and queued) |
| `test/amfi.test.ts`, `test/nav.test.ts` | Parsers on excerpts of the real public files (`test/fixtures/amfi/`, kept byte for byte), and the NAV jobs with AMFI and mfapi mocked. `test/no-market-network.ts` stops any test from reaching those hosts |
| `scripts/nav-check.ts` | Staging NAV store check after a night of runs (read-only D1 API queries; counts only): `node scripts/nav-check.ts` |
| `test/snapshot.test.ts` | The §16 Jobs rows for snapshots with a fake `/build` (`test/helpers/snapshot.ts`): 4 uploads → 1 build, the older-build race, claims, failures, slot waits, stale read then rebuild, gzip passthrough, status, prebuild. `test/no-rebuild-queue.ts` records pf-rebuild sends so no test starts a real build in the background |
| `test/market-gateway.container.test.ts`, `test/snapshot.private.test.ts` | A real EngineBatch container reading a NAV series through `market.internal`; parity of the Worker snapshot with the engine's build (and, until M10 removed it, the old app) on private statements (`test/helpers/portfolio_expect.py`) |
| `test/jobs.test.ts` | Queued path with the real `EnginePool` forced to 0 free slots: park, consumer, cancel, failures, retries, caps, tmp-sweep, and one run through the real pf-parse queue |
| `scripts/measure-pdfcheck.ts` | Measures the pre-check's time and memory inside workerd (`wrangler dev` with `scripts/wrangler.measure.jsonc`, never deployed) |
| `migrations/app`, `migrations/market` | D1 migrations. `app/0001_auth.sql` is generated: `npx auth generate --config scripts/auth-schema.config.ts --output <file>` |
| `scripts/auth-smoke.ts` | Sign-in smoke test (code, magic link, sign-out) through the test email sink: `node scripts/auth-smoke.ts <base-url>` |
| `scripts/upload-smoke.ts` | Staging upload check with one private PDF: sign-in through the sink, upload, R2 via the Cloudflare API (one blob, empty `tmp/`, no plaintext), then delete: `node scripts/upload-smoke.ts https://staging.pocketfolio.in` |
| `worker-configuration.d.ts` | Generated by `npm run types`. Commit it after any `wrangler.jsonc` change. |

## Develop
Needs **Node ≥ 22.12** (`nvm use`, see `.nvmrc`) and **Docker** running.

```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars    # then set ENGINE_SHARED_SECRET to a random local value (openssl rand -hex 32)
npm run dev                       # wrangler dev on :8787, builds and runs the engine container
npx wrangler d1 migrations apply DB --local       # once, and after adding a migration
npx wrangler d1 migrations apply MARKET --local   # same, for the market DB
curl localhost:8787/api/health    # {"ok":true,"engine":{"version":…,"slot":"EngineFast-0"}}
node scripts/auth-smoke.ts http://localhost:8787   # sign-in end to end (needs EMAIL_SINK_KEY in .dev.vars)
npm test                          # vitest in workerd (@cloudflare/vitest-plugin); builds the engine image once
npm run typecheck                 # wrangler types --check + tsc
npm run lint
node scripts/measure-pdfcheck.ts  # pre-check time + memory in workerd (prints pdf<N>, counts and numbers only)
npx wrangler dev --test-scheduled # then: curl 'localhost:8787/cdn-cgi/handler/scheduled?cron=30+17+*+*+*' runs nav-ingest on the real AMFI file
```
Private statements: `npm test` also runs `test/pdfcheck.private.test.ts` and `test/statements.private.test.ts` when PDFs exist in `../data/` or
`../engine/tests/private/` (or `$PRIVATE_DATA_DIR`). `test/global-setup.ts` asks the Python engine (`uv`) what it parses
from each one and the test checks that the pre-check agrees. Passwords: the PAN in the file name, then
`TEST_PDF_PASSWORD` from `.dev.vars`. Results are booleans per `pdf<N>`; in CI they skip.
For the dashboard with hot reload, run `npm run dev` in `web/`: Vite proxies `/api` to :8787.
`wrangler dev` serves `../web/dist`, so run `npm run build` in `web/` first if you want the built SPA there.

Install note: npm 10 fails to resolve vitest's optional peers when adding packages (`Cannot read properties of null
(reading 'edgesOut')`). Use `npx npm@11 install -D <pkg>` to add dependencies. `npm ci` works with either.

Sign-in locally: Google needs the localhost OAuth client in `GOOGLE_CLIENT_ID/SECRET`. Email sign-in works with
Cloudflare's always-pass Turnstile test keys. `wrangler dev` doesn't send email: it logs the message and saves it under
a temp folder, so use a `…@sink.pocketfolio.test` address and `auth-smoke.ts`, or add `"remote": true` to the
`send_email` binding to send for real. Note that `secrets.required` also decides which `.dev.vars` entries
`wrangler dev` loads: a secret that isn't listed there never reaches the Worker.

Secrets: copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill it in. Never commit values or paste them into
chat. `secrets.required` in `wrangler.jsonc` lists the secrets the code uses so far.
