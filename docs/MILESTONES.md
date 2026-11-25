# PocketFolio: build milestones

This is the **build order** for [MULTI_USER_LAUNCH_PLAN.md](MULTI_USER_LAUNCH_PLAN.md) (the "plan").
The plan says **what** to build and why. This file says **in which order**, in pieces small enough for one Claude
Code session each. If the two disagree, this file wins for order and scope, and the plan wins for design.

**To start a milestone, the owner says:** `Do the next milestone` (or `Do M7`).

---

## Status

Claude updates this table at the end of every milestone.

| # | Milestone | Plan phase | Status | Date | Commit | Notes |
|---|---|---|---|---|---|---|
| M0 | Repo setup | 0 | done | 2026-11-25 | `1059779` | Branched from `origin/main` (already has bento, PR #1) and cherry-picked the local rename `dd308df`. Local `main` is untouched and still lacks bento. Web build + lint pass; old app starts. CI YAML parses; not yet run on GitHub |
| M1 | Python engine extracted and containerised | 0 | done | 2026-11-25 | `dde3c9d` | 34 synthetic + 7 real-PDF tests pass, incl. parity with the old app on real statements (with and without NAVs). Container: read-only, non-root, /tmp empty, concurrent /parse → 503. `/parse` now takes a raw body (multipart would spool to disk). Large detailed CAMS statement still unmeasured |
| M2 | Worker scaffold and engine pool (local) | 0 | done | 2026-11-25 | `8cb6044` | 21 vitest pass, incl. a real container round trip. `wrangler dev`: `/api/health` → pool → `EngineFast-0` (cold ~1.8 s, warm ~20 ms), container stops after 60 s idle. Plan changes: raw `ctx.container` instead of `@cloudflare/containers`; `durable_object` policy rejects `image`/`instance_type` (now `images` + `start({instance})`); `@cloudflare/vitest-plugin` replaces vitest-pool-workers; Node ≥ 22.12. Later: `/api/health` is public and leases a parse slot, so cache or rate-limit it (M16); engine 1 s recycle gap, so retry on connect error (M7) |
| M3 | Spike: pdf.js pre-check inside a Worker | 0 | done | 2026-11-25 | `e7298d9` | pdf.js 6.5 runs in workerd as is (fake worker through `globalThis.pdfjsWorker`), so no fallback was needed. 15 synthetic + 8 private tests: 4/4 private PDFs agree with the engine on type, password index and PAN. Time in workerd 22–37 ms per check, plus 40–53 ms to load pdf.js once per isolate. A 12 MB / 300-page PDF takes 24 ms with peak RSS +68 MB. Bundle 3.4 MB (685 KB gzipped). Later: re-measure CPU and startup time on Cloudflare (M4); the check copies the bytes, so hold one upload per request and check the size before buffering (M7); `passwordIndex: null` means unencrypted (M7 maps it to `password_source`) |
| M4 | Cloudflare staging and CI | 0–1 | done | 2026-11-25 | `c870438`…PR #3 | `https://staging.pocketfolio.in/api/health` reaches `EngineFast-0` in Cloudflare (cold ~11 s, warm ~0.5 s, of which ~60 ms is the DO + container hop). CI deploy proven on the merge of PR #3: both D1s migrated, deployed, smoke test ok. Created: both staging D1s (`apac`), R2 + `tmp/` 1-day rule, 4 queues + DLQ, Turnstile widget. 5 staging secrets uploaded with the first deploy. `DATA_KEK_V1` and `PAN_PEPPER` are backed up by the owner. `env.staging` + `env.production` in `wrangler.jsonc`, plus a manual production workflow. Fixes: Cloudflare rejects `0` for Sunday in crons (`SUN`). The custom domain answers 403 to GitHub runners (probably Bot Fight Mode), so the CI smoke test uses staging's workers.dev URL (owner's choice). Container placement can't be read, so the §15.1 fallback was taken. Later: re-check bot protection on `/api/*` before launch (M16/M17); re-measure pdf.js CPU on Cloudflare via observability (M7) |
| M5 | Sign-in (Google, magic link, email code) | 1 | todo | | | |
| M6 | Tenant data, encryption, members | 2 | todo | | | |
| M7 | Upload, direct path | 2 | todo | | | |
| M8 | Upload, queued path | 2 | todo | | | |
| M9 | NAV store (market data) | 3 | todo | | | |
| M10 | Snapshots and the live dashboard | 3 | todo | | | |
| M11 | Stocks inside funds (BharatStock fallback job) | 3 | todo | | | |
| M12 | Daily returns | 3b | todo | | | |
| M13 | QR device login | 4 | todo | | | |
| M14 | Privacy and compliance | 5 | todo | | | |
| M15 | Installable app (PWA) | 5b | todo | | | |
| M16 | Hardening and load tests | 6 | todo | | | |
| M17 | Production launch | 6 | todo | | | |
| M18 | AMC disclosure scraper (after launch) | 7 | todo | | | |

Status values: `todo` · `in progress` · `blocked (needs owner: …)` · `done`.

---

## How Claude runs a milestone

1. **Read first:** `CLAUDE.md`, the plan's §0 rules, this section, then only the milestone's "Read" list. Don't read
   the whole plan every time.
2. **Pick the milestone:** the one the owner named, otherwise the first row in the Status table that isn't `done`.
   Never skip ahead. If the previous milestone isn't `done`, finish or unblock it first.
3. **Check "Needs from owner".** If anything is missing, stop before writing code. Set the row to
   `blocked (needs owner: …)` and tell the owner exactly what's needed and how to provide it. **Secrets go in a
   git-ignored file (`worker/.dev.vars`, `.env`), never in chat.** Claude reads them from there and never prints them.
4. **Branch:** all milestones are built on the single branch **`multi-user`**, one or more commits per milestone, with
   the commit subject starting `M<N>:`. The owner opens a PR to `main` after a set of milestones. Never commit
   milestone work to `main` directly.
5. **Build only what the milestone lists.** Anything useful but out of scope goes in the row's Notes, or in a "Later"
   bullet under the milestone, not in code.
6. **⚠️ VERIFY items in scope:** check each against current docs or by running it. Then edit the plan: replace
   ⚠️ VERIFY with ✅ and the finding, or with the fallback used and why (plan rule §0.6).
7. **Tests:** run every command under "Done when". All must pass. Paste the summary lines (counts, pass/fail) into
   the final report. **Never paste statement data, PANs, names, amounts or passwords** (plan §0.1). Real-PDF checks
   print counts and ok/fail only.
8. **Finish:**
   - commit on `multi-user`;
   - update the Status row (status, date, branch, short notes);
   - don't push or open a PR unless the owner asks. They open PRs after a set of milestones.
9. **Stop.** Report what was built, the test results, what was verified, and what the owner must do before the next
   milestone. **Don't start the next milestone in the same session.** The owner should start a fresh session
   (`/clear`) for each milestone.

**Standard commands** (they exist from the milestone that creates them):
- Engine: `cd engine && uv run pytest -q`
- Worker: `cd worker && npm test` (vitest with `@cloudflare/vitest-plugin`, the renamed `vitest-pool-workers`; needs Docker and Node ≥ 22.12), `npm run typecheck`, `npm run lint`
- Web: `cd web && npm run build && npm run lint`
- Local stack: `cd worker && npx wrangler dev`, with Docker running for the containers

---

## M0: Repo setup
**Goal:** a clean base to build on.
**Read:** plan §0, §5.
**Needs from owner:** confirmation of the branch base. Default: merge `ui-bento-redesign` into `main` (the plan is
written against the bento design, commit `089634a`).
**Build:**
- Merge `ui-bento-redesign` into `main` and resolve conflicts with the PocketFolio rename (`dd308df`). Check that
  `web` builds.
- Create the target folders (`/engine`, `/worker`) with placeholder READMEs.
- `.gitignore`: `engine/tests/private/`, `worker/.dev.vars`, `worker/.wrangler/`, `*.local.*`.
- `worker/.dev.vars.example` listing every secret name from plan §15.2, with no values.
- GitHub Actions `ci.yml`: on PR, run web build and lint. (Engine and Worker jobs are added in the milestones that
  create them.)
- Keep the current local app (`app/`, `uvicorn app.main:app`) working. It's the reference for the M10 parity check.

**Done when:** `cd web && npm run build` passes, CI runs on a test PR or locally with `act`, and the old local app
still starts.

## M1: Python engine extracted and containerised
**Goal:** the parsers and analysis run as a stateless HTTP engine in Docker.
**Read:** plan §3.2, §3.3, §10.1 C5, §10.2 (refactor part), §14.
**Needs from owner:** Docker Desktop running. Optional: a large multi-year detailed CAMS statement in
`engine/tests/private/` (plan §19).
**Build:**
- Copy `app/parsers`, `analysis.py`, `portfolio.py`, `market.py` and the matching parts of `stocks.py` into
  `engine/engine/`. **Leave `app/` in place** until M10.
- BytesIO support (`parse_cdsl_cas` `source=` fix). Remove all file writes.
- `/parse` takes one verified password and the detected `kind` (§14), and returns
  `{ok, kind, pan, statement}` or `{ok:false, code}`.
- Refactor `build_portfolio` into a pure function over `StatementInput[]` and `MarketData` (§10.2). Member IDs come
  from input, not `m0/m1`. NAVs come from the payload for now (R2 comes in M10).
- `server.py` (FastAPI): `/parse`, `/build`, `/health`, the `X-Engine-Key` check, the one-job semaphore with
  `asyncio.to_thread`, a fast 503 when busy, access logs off.
- Dockerfile: slim, non-root, read-only filesystem, process recycling (§14).
- `engine/cli.py`, replacing `parse.py`, as a dev tool.
- Tests: synthetic fixtures (`ABCDE1234F`, fake funds), a golden snapshot, FIFO/LTCG/merge tests, private-PDF tests
  (counts only, skipped when the folder is absent).
- **Measure** parse CPU and peak RSS for each private PDF, and build CPU for the largest household. Write the numbers
  into plan §3.3.

**Done when:**
- `uv run pytest -q` passes.
- `docker build` works, and `docker run` + `curl /health` works.
- A private PDF parses through `/parse` and `/tmp` in the container is empty afterwards.
- A second concurrent `/parse` gets 503.

## M2: Worker scaffold and engine pool (local)
**Goal:** the TypeScript Worker serves the SPA and reaches the engine through `EnginePool`, all locally.
**Read:** plan §4, §5, §14 (EnginePool, container classes), §15.1.
**Needs from owner:** Docker running. No Cloudflare account is needed yet; everything runs under `wrangler dev`.
**Build:**
- `/worker`: Hono app, `wrangler.jsonc` with every binding from §15.1 (both D1s, R2, 4 queues + DLQ, rate limits, 3 DOs,
  2 container classes), empty migration folders `migrations/app` and `migrations/market`. Static assets serve
  `web/dist` with SPA fallback.
- `EngineFast` / `EngineBatch` (Container DOs, 60 s inactivity) and `EnginePool` (leases, fill-first, expiry,
  moving averages, `acquire`/`release`).
- `GET /api/health` → pool → `EngineFast-0` → `/health`.
- Vitest with the Workers pool. Unit tests for `EnginePool`: fill-first, lease expiry, 1 job per slot, busy + ETA.
- Vite proxy from `web` to :8787.
- ⚠️ VERIFY now: the container `scheduling_policy` keys, `@cloudflare/containers` usage, inactivity timeout API, and
  local container support in `wrangler dev`.

**Done when:** `npm test` and `npm run typecheck` pass, `wrangler dev` serves the dashboard shell, and `/api/health`
returns the engine version through the pool.

## M3: Spike: pdf.js pre-check inside a Worker
**Goal:** settle the riskiest unknown before building on it.
**Read:** plan §10.1 A4–A5, §3.3 (pre-check table), D19.
**Needs from owner:** none. Private PDFs are already in `data/`. The KFintech password goes in `worker/.dev.vars` as
`TEST_PDF_PASSWORD`, never in code or chat output.
**Build:**
- `worker/src/lib/pdfcheck.ts`: open with candidates, detect the type from pages 1–2, find the holder's PAN
  (labelled, 4th letter `P`), page count, and an outcome code. Loaded by dynamic import.
- Tests on synthetic PDFs (generate a small encrypted test PDF in the test setup) plus private PDFs (booleans only).
- Measure CPU and memory inside workerd for the private PDFs and for a generated 10 MB / 300-page PDF.
- If pdf.js won't run in workerd, try fallback 1 (`unpdf`), then fallback 2 (an engine `/precheck` endpoint). Record
  the outcome in plan §10.1 A5.

**Done when:** the pre-check agrees with the Python parser on every private PDF (type, password index, PAN found), the
measurements are in plan §3.3, and the chosen approach is marked ✅ in the plan.

## M4: Cloudflare staging and CI
**Goal:** the same stack running on `staging.<APP_DOMAIN>`, deployed by CI.
**Read:** plan §15 (all), §3.4 (limits).
**Needs from owner:**
- Cloudflare account on **Workers Paid**.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, with the permissions listed in the setup answer: Workers, D1, R2,
  Queues, KV, Containers, Turnstile, Routes, DNS on the zone, and Account Settings read. Put them in `worker/.dev.vars`.
- `<APP_DOMAIN>` with DNS on Cloudflare.
- An OK to add the two Cloudflare values as GitHub Actions secrets with `gh`.

**Build:**
- Create staging resources:
  - D1 `pocketfolio-app-staging` and `pocketfolio-market-staging` with the `apac` hint;
  - R2 bucket with the `tmp/` 1-day lifecycle rule;
  - 4 queues + DLQ;
  - Turnstile widget (site key + secret).
- Generate `BETTER_AUTH_SECRET`, `DATA_KEK_V1`, `PAN_PEPPER` and `ENGINE_SHARED_SECRET` with `wrangler secret put`.
  **Tell the owner to store `DATA_KEK_V1` and `PAN_PEPPER` in their password manager.** Never print them.
- `wrangler.jsonc` environments: `staging` and `production` (production resources are created in M17).
- CI: on PR, engine pytest + worker test/typecheck/lint + web build. On merge to `main`, apply migrations to both D1s
  and deploy to staging. Production is a manual job.

**Done when:** `https://staging.<APP_DOMAIN>/api/health` reaches a container in Cloudflare, and the CI deploy works from
a merge.

## M5: Sign-in
**Goal:** users can sign in. Every request knows its household with no extra D1 reads.
**Read:** plan §7.1, §7.3, §13 item 1, §13A.5 (email code), D3–D5.
**Needs from owner:**
- Google OAuth Web client IDs and secrets for localhost:8787 and staging (consent screen in Testing mode, with your
  test emails added).
- `RESEND_API_KEY`, and the domain added in Resend (Claude adds the DNS records with the token).
- Two email addresses you can read.

**Build:**
- Better Auth on D1 `DB`: Google, magic link + email OTP in one email, cookie cache, `householdId` /
  `consentVersion` session fields, narrowed rate-limit rules, migrations `app/0001_auth.sql`.
- Household + empty snapshot row created on signup. DEK generated and wrapped (`crypto.ts` key parts only).
- `EmailSender` + Resend batch sending through `pf-email`. A staging-only email sink for automated tests.
- Turnstile check on the email form. Session middleware, `/api/me`, `/api/config`, sign-out, the global 401 handler.
- Frontend: `/login` (Google primary, email link/code, PocketFolio wordmark), the avatar menu, a tiny router.
- ⚠️ VERIFY: Better Auth option names (cookieCache, additionalFields, rateLimit customRules), the combined link + code
  email, and Resend batch + rate limits.

**Done when:**
- Sign-in with Google and with a magic link works on staging, and the 6-digit code works.
- The auth tests in plan §16 pass.
- A warm-cache request makes 0 D1 session queries (counted in a test).

## M6: Tenant data, encryption, members
**Goal:** the secure data layer every later feature uses.
**Read:** plan §6, §8, §9.1, §9.2 (members rows), D18.
**Needs from owner:** none.
**Build:**
- Migration `app/0002_app.sql`: household, member, statement, snapshot, parse_job, pending_statement_password, quota,
  audit_event, consent (gating comes in M14).
- `crypto.ts` (seal/open, AAD, KEK versions) and `blob.ts` (gzip, then encrypt, with a flags byte).
- `tenant.ts` guard. `/api/members` list, rename and delete (delete cascades blobs and enqueues a rebuild once that
  queue exists).
- `quota.ts` helpers (atomic increment-with-limit).
- Frontend: Members page shell (empty state), Settings shell.

**Done when:** the isolation and crypto tests in plan §16 pass, and two test accounts can't see each other's members
by ID guessing (404).

## M7: Upload, direct path
**Goal:** a user uploads a statement and it's verified, parsed and stored encrypted, with no PDF ever stored.
**Read:** plan §10.1 A–C, D19, §11 (upload limits), §13 item 5.
**Needs from owner:** none.
**Build:**
- `POST /api/statements` with the file and an optional password only: checks A1–A5 (the M3 pre-check), candidate
  passwords (typed, each member's PAN, pending KFintech passwords), D19 member resolution, pool lease, engine
  `/parse`, `storeStatement` (one `DB.batch()`).
- Market migration `market/0001_market.sql` (`tracked_scheme`, `fund_portfolio`, `scrape_run`). Multi-row
  `tracked_scheme` upsert.
- `DELETE /api/statements/:id`. Keep 24 statements per member.
- Frontend: the new add-statement dialog (file + collapsed password field, instant errors, "Added to <member>").
  The rebuild isn't wired yet; show "Statement added".

**Done when:**
- The Upload, Pre-check and No-PAN tests in plan §16 pass.
- A private PDF uploaded on staging gives one encrypted statement blob in R2 and nothing in `tmp/`.
- A raw read of the blob shows no plaintext.

## M8: Upload, queued path
**Goal:** bursts never time out. Parked PDFs are encrypted and always deleted.
**Read:** plan §10.1 D, §6 (parse_job), §9.2 (jobs), §10.3 (`tmp-sweep`), §11 (job caps).
**Needs from owner:** none.
**Build:**
- Pool `busy` → park in `tmp/` (encrypted, no gzip), `parse_job`, `pf-parse` consumer with slot waits that don't count
  as attempts, retries, and delete-on-every-outcome.
- `GET /api/jobs`, `GET /api/jobs/:id` (with `Retry-After`), `DELETE /api/jobs/:id`.
- `tmp-sweep` cron, lost-message re-enqueue, the parked-PDF global cap, ETA from the pool.
- Frontend: the queued state with ETA and the "you can close this window" note, the Processing list, failed-job toast.

**Done when:**
- The Queued-upload and EnginePool tests in plan §16 pass with the pool forced to 0 slots.
- After a run, `tmp/` is empty.
- A job older than 24 h is swept.

## M9: NAV store (market data)
**Goal:** our own daily NAV database, filled from AMFI.
**Read:** plan §10.4 (all), §10.3 (jobs table), D15, D17.
**Needs from owner:** none.
**Build:**
- Migration `market/0002_nav.sql` (INTEGER codes and dates).
- `amfi.ts` parser with unit tests on saved public AMFI files.
- `nav-ingest` ×4 crons (batched inserts, upsert that skips unchanged rows, `market_day`, finality).
- `nav-backfill` on `pf-market` (mfapi, then the AMFI history fallback), `nav-repair`, R2 series for tracked schemes,
  `/api/market/status`.
- Read replication on the market DB, and reads through `withSession`.

**Done when:**
- The NAV-ingest tests in plan §16 pass.
- After one night on staging, every tracked scheme has the latest business-day NAV.
- Re-runs insert 0 rows.

## M10: Snapshots and the live dashboard
**Goal:** the dashboard shows the user's real portfolio, matching today's local app.
**Read:** plan §10.2, §10.3 (prebuild), §13 items 4 and 8, §14 (EngineBatch).
**Needs from owner:**
- An R2 read-only S3 token for `market/*` (`R2_MARKET_READONLY_ACCESS_KEY_ID` / `_SECRET`), unless the Cloudflare
  token can create it.

**Build:**
- Engine `/build` reads NAV series from R2 (LRU cache).
- `pf-rebuild` consumer: debounce, single-flight claim, versioned snapshot keys, compare-and-set pointer, cleanup.
- Streamed `GET /api/portfolio` and `/api/portfolio/status`. Stale reads trigger a lazy rebuild. `snapshot-prebuild`
  after a final market day.
- Frontend: onboarding empty state, dashboard wired to real data, stale/building banner, sandbox notice removed,
  progress after upload.
- **Parity check:** for the same private statements, the snapshot equals the old local app's `/api/portfolio`, member
  IDs aside. Then delete `app/`, `parse.py` and `static/`, and rewrite the README "Run" section.

**Done when:** the Jobs tests in plan §16 pass (including "4 uploads → 1 build" and the older-build race), and the
parity diff is empty.

## M11: Stocks inside funds (BharatStock fallback job)
**Goal:** the stocks view works for everyone, without threads.
**Read:** plan §10.3.1 (fallback part only), D10.
**Needs from owner:** `BHARATSTOCK_API_KEY` in `.dev.vars`, and confirmation that it may be used from the cloud
(50 calls a day).
**Build:** the BharatStock job on `pf-market` with the global daily budget in `quota`, `fund_portfolio` rows and R2
blobs, and the snapshot `stocks` section built from them.
**Done when:** equity funds in a test household get holdings, and the budget stops at the limit.

## M12: Daily returns
**Goal:** "Today: +₹… (+…%)" and daily history.
**Read:** plan §10.5 (all).
**Needs from owner:** none (needs M9 data).
**Build:** the engine adds `amfi_code`, `units_timeline` and `units_exact` to snapshots. Then the `dailySeries()` pure
function, the endpoint with its cache, the Today tile, the 1D column, and the Daily returns panel.
**Done when:** the daily-returns golden tests pass, the day change matches a hand calculation for a test household,
and a cached call takes < 50 ms.

## M13: QR device login
**Read:** plan §7.4, D2, §13 items 1, 2 and 7.
**Needs from owner:** none.
**Build:** the device-authorization plugin, the `/login` QR tab, the `/link` approval page, the scanner, the cookie
bridge if needed, the Devices list, and the "new device" email.
**Done when:** the QR auth tests in plan §16 pass, and phone-to-desktop linking works on staging.

## M14: Privacy and compliance
**Read:** plan §12, §8 (deletion), §9.2 (export, delete), §13 items 3 and 7.
**Needs from owner:** legal entity name, grievance officer name and email, and jurisdiction. If they're missing, build
with clearly marked placeholders and set the row to `done (placeholders)`.
**Build:**
- Consent screen and gating (403 `consent_required`).
- `/privacy`, `/terms`, `/security`, including the PDF-handling text and "Not investment advice".
- Export, delete account (crypto-shred, `h/` and `tmp/` prefixes), inactivity job, `audit_event` writes.
- `docs/INCIDENT_RESPONSE.md` and the README privacy rewrite.

**Done when:** a deleted account leaves no rows, no R2 objects and no DEK, and the export contains all of the user's
data and nothing else.

## M15: Installable app (PWA)
**Read:** plan §13A (all), D14.
**Needs from owner:** none (demo-data screenshots are generated, never real portfolios).
**Build:** everything in §13A.1–§13A.6.
**Done when:** everything in §13A.7 is true.

## M16: Hardening and load tests
**Read:** plan §11, §16 (Load row), §3.5, §17 Phase 6.
**Needs from owner:** an OK to run load tests on staging (synthetic users and fixture PDFs only).
**Build:**
- All fair-use limits and 429 copy, the "Coming soon" states (D8, D9), security headers / CSP, dependency audit.
- Alerts: DLQ, engine 5xx, D1 overloaded, stuck queued jobs, usage.
- **Load tests:** a 2,000-upload burst, a 5,000-household nightly prebuild, polling. Set pool caps and
  `max_concurrency` from the results. Write the measured drain time and cost into plan §3.5 and §18.

**Done when:** the whole §16 table is green on staging, and the load-test numbers are recorded.

## M17: Production launch
**Read:** plan §7.2, §17 Phase 6 launch checklist, §19.
**Needs from owner** (the most owner work of any milestone):
- Google consent screen brand verification and "In production", plus a production client ID.
- Resend on Pro.
- Legal review done.
- Production approval in the GitHub environment.

**Build:**
- Create production resources (like M4), set the secrets, run the production migrations.
- Deploy through the manual production job.
- Smoke test: sign-in, upload, dashboard, export, delete with a test account.
- Usage alerts on.

**Done when:** the launch checklist in plan §17 Phase 6 is ticked, and the owner confirms go-live.

## M18: AMC disclosure scraper (after launch)
**Read:** plan §10.3.1 (all), D10.
**Needs from owner:** none.
**Build:** the adapter framework, the top 10 AMC adapters (each with its own ⚠️ VERIFY notes at the top of the file),
`scrape_run` monitoring, and BharatStock limited to the gaps.
**Done when:** ≥ 80% of tracked equity schemes have `source='amc'` holdings by day 15 of the month.

---

## Order notes
- **Why this order:**
  - Risky unknowns first: the engine in a container (M1), the pool (M2), pdf.js in a Worker (M3).
  - Then the secure foundations (M5–M6), before any user data flows (M7+).
  - Market data (M9) comes before snapshots (M10), because builds need NAVs.
  - Everything users see before launch exists by M15. M16 proves it holds under load.
- **What can move:** M9 can start any time after M7, M13 any time after M5, and M15 any time after M10. Keep the table
  order unless the owner asks otherwise.
- **Owner inputs, by first milestone that needs them:** M0 branch OK · M4 Cloudflare Paid + token + domain · M5 Google
  clients + Resend + test emails · M10 R2 read-only token · M11 BharatStock OK · M14 legal details · M16 load-test OK ·
  M17 Google production, Resend Pro, legal review, go-live approval.
