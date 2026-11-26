# PocketFolio: build milestones

This is the **build order** for [MULTI_USER_LAUNCH_PLAN.md](MULTI_USER_LAUNCH_PLAN.md) (the "plan").
The plan says **what** to build and why. This file says **in which order**, in pieces small enough for one Claude
Code session each. If the two disagree, this file wins for order and scope, and the plan wins for design.

**To start a milestone, the owner says:** `Do the next milestone` (or `Do M7`).

---

## Status

Claude updates this table at the end of every milestone. **The rows are in build order; the numbers are IDs, not
order** (owner, 2026-11-26: M13 moved after M15, and M16 and M17 moved to the end, after M21. Owner, 2026-11-27:
M22–M33 added from the owner's todo; Claude chose their order by ease and dependencies, see "Order notes").

| # | Milestone | Plan phase | Status | Date | Commit | Notes |
|---|---|---|---|---|---|---|
| M0 | Repo setup | 0 | done | 2026-11-25 | `1059779` | Branched from `origin/main` (already has bento, PR #1) and cherry-picked the local rename `dd308df`. Local `main` is untouched and still lacks bento. Web build + lint pass; old app starts. CI YAML parses; not yet run on GitHub |
| M1 | Python engine extracted and containerised | 0 | done | 2026-11-25 | `dde3c9d` | 34 synthetic + 7 real-PDF tests pass, incl. parity with the old app on real statements (with and without NAVs). Container: read-only, non-root, /tmp empty, concurrent /parse → 503. `/parse` now takes a raw body (multipart would spool to disk). Large detailed CAMS statement still unmeasured |
| M2 | Worker scaffold and engine pool (local) | 0 | done | 2026-11-25 | `8cb6044` | 21 vitest pass, incl. a real container round trip. `wrangler dev`: `/api/health` → pool → `EngineFast-0` (cold ~1.8 s, warm ~20 ms), container stops after 60 s idle. Plan changes: raw `ctx.container` instead of `@cloudflare/containers`; `durable_object` policy rejects `image`/`instance_type` (now `images` + `start({instance})`); `@cloudflare/vitest-plugin` replaces vitest-pool-workers; Node ≥ 22.12. Later: `/api/health` is public and leases a parse slot, so cache or rate-limit it (M16); engine 1 s recycle gap, so retry on connect error (M7) |
| M3 | Spike: pdf.js pre-check inside a Worker | 0 | done | 2026-11-25 | `e7298d9` | pdf.js 6.5 runs in workerd as is (fake worker through `globalThis.pdfjsWorker`), so no fallback was needed. 15 synthetic + 8 private tests: 4/4 private PDFs agree with the engine on type, password index and PAN. Time in workerd 22–37 ms per check, plus 40–53 ms to load pdf.js once per isolate. A 12 MB / 300-page PDF takes 24 ms with peak RSS +68 MB. Bundle 3.4 MB (685 KB gzipped). Later: re-measure CPU and startup time on Cloudflare (M4); the check copies the bytes, so hold one upload per request and check the size before buffering (M7); `passwordIndex: null` means unencrypted (M7 maps it to `password_source`) |
| M4 | Cloudflare staging and CI | 0–1 | done | 2026-11-25 | `c870438`…PR #3 | `https://staging.pocketfolio.in/api/health` reaches `EngineFast-0` in Cloudflare (cold ~11 s, warm ~0.5 s, of which ~60 ms is the DO + container hop). CI deploy proven on the merge of PR #3: both D1s migrated, deployed, smoke test ok. Created: both staging D1s (`apac`), R2 + `tmp/` 1-day rule, 4 queues + DLQ, Turnstile widget. 5 staging secrets uploaded with the first deploy. `DATA_KEK_V1` and `PAN_PEPPER` are backed up by the owner. `env.staging` + `env.production` in `wrangler.jsonc`, plus a manual production workflow. Fixes: Cloudflare rejects `0` for Sunday in crons (`SUN`). The custom domain answers 403 to GitHub runners (probably Bot Fight Mode), so the CI smoke test uses staging's workers.dev URL (owner's choice). Container placement can't be read, so the §15.1 fallback was taken. Later: re-check bot protection on `/api/*` before launch (M16/M17); re-measure pdf.js CPU on Cloudflare via observability (M7) |
| M5 | Sign-in (Google, magic link, email code) | 1 | done | 2026-11-25 | `8f6a07f` | Owner confirmed on staging: Google sign-in, and the magic link + 6-digit code from a real inbox. Better Auth 1.7.28 on D1. 29 new tests (73 total) pass, incl. link single use + expiry, Google linking to an email user, session revoke, and **0 D1 session queries with a warm cookie cache**. On staging, `scripts/auth-smoke.ts` passes end to end through the real `pf-email-staging` queue and the test sink: code, magic link, same household, single use, sign-out. Google's auth URL accepts the staging client + redirect URI. Changes: household + snapshot moved into `0002_household.sql` (M6 now writes `0003_app.sql`); one email from `POST /api/login/email` (the plugins' send endpoints aren't routed); a one-UPSERT `customStorage` rate limiter; the link opens `/login/verify#token=…`; tokens and codes hashed; Google tokens not stored; `validateSchema: false` (else +1 D1 query per request); `EMAIL_SINK_KEY` required in local + staging only. `/api/portfolio` returns an empty portfolio until M10. Later: delete expired `rate_limit` rows in the cleanup cron (M14); Settings in the avatar menu (M6); privacy/terms links on /login, the session table's IP/UA in the privacy notice, and real `consent_ok` (M14); review the 60/h per-IP email limit and alert on `email_daily_limit` / `email_config_error` logs (M16); CSP for Turnstile (M16); web bundle 918 KB, so code-split (M15) |
| M6 | Tenant data, encryption, members | 2 | done | 2026-11-26 | `7e43206` | 25 new tests (98 total) pass: crypto round trips (JSON gzip flag set, PDF no gzip, no plaintext in raw bytes), AAD tamper/move fails even under the same DEK, KEK V1→V2 rotation with old blobs still opening, crypto-shred empties `h/` + `tmp/` and the rows; isolation: a second account gets 404 on rename/delete of the first's members, the guard rejects foreign member/statement ids, R2 keys carry the session household, same PAN in two households stays separate; quota: 30 parallel takes at limit 20 → exactly 20, all-or-nothing across counters. `GET /api/members` is one D1 batch with a warm cookie cache. Members + Settings pages checked headless at 360 px and desktop, dark and light, 0 page errors. Changes: AAD also covers the 3 header bytes; `Vault.seal/open` instead of `seal(householdId, …)`; errors stay `{ ok: false, code }`; `GET /api/members` returns `{ members }`; `PAN_PEPPER` now a required secret (already on staging). Migration `0003_app.sql` reaches staging D1 with the next merge to `main`. Later: enqueue the rebuild on member delete (M10); `DELETE /api/account` calls `shredHousehold()` and removes user/session rows (M14); delete old `quota` rows in the cleanup cron (M14); fair-use usage, Devices, export and delete-account sections in Settings (M7/M13/M14); `memberInsert()` is ready for `storeStatement` (M7) |
| M7 | Upload, direct path | 2 | done (staging check passed after the M6–M8 merge, PR #5, 2026-11-26) | 2026-11-26 | `afc4fc0` | 35 new tests (133 total) pass: 31 on synthetic PDFs with a fake engine cover the §16 Upload, Pre-check and No-PAN rows (wrong password then a candidate, PAN mismatch, 409 also while queued, non-PDF, > 10 MB, every quota → 429, no empty member after a failed parse, only the verified password reaches the engine, 300 pages, member cap before the engine). 4 private statements go through the real engine container (0.7–3.0 s per upload): one sealed blob, nothing in `tmp/`, no plaintext in a raw read, 409 on re-upload, re-filed by the member's PAN with no password. Dialog and Members checked headless at 360 px and desktop, dark and light, 0 page errors. Staging items wait for the merge: `node scripts/upload-smoke.ts https://staging.pocketfolio.in` uploads a private PDF, checks R2 through the Cloudflare API (one blob, empty `tmp/`, no plaintext), then deletes it (dry run on today's staging: sign-in and R2 API ok). Changes: engine `/parse` returns `version`; `201` also returns `member`; a busy pool answers `503 busy` until M8; new codes `not_pdf`, `file_too_large`, `pan_mismatch`, `jobs_limit`, `too_many_failures`; the first password prompt doesn't count as a failure; Members shows "holdings" (CDSL statements include stocks); CDSL OTP tab is "Coming soon". Later: park on busy, and `parse_job.password_source` has no value for an unencrypted PDF (M8); enqueue the rebuild on upload and statement delete (M10); re-measure pdf.js CPU on Cloudflare from the staging run's observability; the Request tab still posts to the removed `/api/kfintech/request`, and no milestone builds `POST /api/kfintech/guide` (D9), which is what writes pending passwords |
| M8 | Upload, queued path | 2 | done | 2026-11-26 | `1b43607`…PR #5 | Staging (PR #5 merged by Claude on the owner's instruction, CI deploy green): D1 `app/0003`, `app/0004`, `market/0001` applied; `pf-parse-staging` consumer and the `15 * * * *` tmp-sweep cron registered; `/api/health` ok; `scripts/upload-smoke.ts` on staging.pocketfolio.in passes 14/14 (one sealed blob, nothing in `tmp/`, no plaintext in a raw read, duplicate 409, deleted after). The queued path isn't forced on staging (60 slots); it's covered by the local tests and the M16 load test. 25 new tests (158 total) pass. `test/jobs.test.ts` (16) runs the §16 Queued-upload rows with the real EnginePool forced to 0 free slots: 202 with position + ETA, the `tmp/` object sealed (no `%PDF` in a raw read), gone after processing with `blob_key` NULL, cancel deletes it, a job older than 24 h is swept, lost messages re-sent once, account deletion empties `tmp/`, parked-PDF cap → 503 with nothing stored, open-jobs cap held inside the park batch, engine crash retried to 3 attempts, and one upload through the real pf-parse queue. 6 new EnginePool tests. 4 private statements go through the queued path on the real engine (consumer 0.35–1.7 s each, `tmp/` empty after). Dialog queued state, Processing list and the failed-upload toast checked headless at 360 px and desktop, dark and light, 0 page errors. Changes: migration `0004_parse_job.sql` rebuilds `parse_job` (`password_source` gains `none`; adds `user_id`, `pending_pan_hmac`, `pdf_bytes`, `updated_at`); slot waits re-send a fresh delayed message instead of `msg.retry()` (retries are capped and the docs don't say retry() is exempt), delay ≈ ETA/2, 5–60 s; the pool keeps a queued job's ticket across waits; the upload quota is taken at park time; `503 queue_full` over the parked-PDF cap; `DELETE /api/jobs/:id` also dismisses finished jobs, `409 job_running` while parsing; engine client split into `acquire` / `parse(lease)` / `release`. Later: enqueue the rebuild when a queued job is stored (M10); delete finished `parse_job` rows after 7 days in `cleanup` (M14); in the load test, check ETA ±50%, the pool's request rate under a burst (slot waits + polling) and fairness, since a freed slot goes to whoever asks first, not the lowest ticket (M16); nothing consumes `pf-dlq` (tmp-sweep re-sends within the hour); a member delete leaves the parked counter high until the hourly recount; the failed-upload toast reads `/api/jobs` on each signed-in page load |
| M9 | NAV store (market data) | 3 | done (staging night check waits for the merge) | 2026-11-26 | `95e7b1f` | 36 new tests (194 total) pass. `test/amfi.test.ts` (14) parses excerpts of the real public files fetched today (NAVAll, a 1-day and a 3-month history report, mfapi; committed byte for byte with CRLF): section headers, `-` and empty ISINs, stale dates, N.A./0/negative/bad/future values, HTML instead of a report. `test/nav.test.ts` (22) covers the §16 NAV-ingest row: a re-run of the real file inserts 0 rows and rewrites 0 schemes; partial nights move `market_day` (30 → 49 → 50 of 50, final once at 98%); the 10:00 IST run makes the night final; backfill falls back to AMFI history in ≤ 90-day chunks for the AMC (`mf=28`) when mfapi fails or returns no data; failed on the 5th attempt; nav-repair picks full days with gaps and missed weekdays, not holidays or weekends; anomalies; R2 series; `/api/market/status` (public, 5 min cache); both crons. `wrangler dev` on the live files: 14,240 NAV rows and 14,481 schemes in 1.8 s, re-run 0 rows in 0.8 s; the benchmark backfilled 3,419 rows from mfapi and its R2 series was written. Real staging D1 takes a 52 KB + 98 KB `json_each` parameter in one statement (0.7 ms). Read replication turned on for `pocketfolio-market-staging` (API). ✅ VERIFY: history report range limit 107–153 days (refused = HTML with 200), 83 AMC ids (`src/market/amc-ids.ts`), `withSession` constraint names. Findings: NAVAll moved to portal.amfiindia.com (302); 24-Nov was a market holiday, which explains the plan's "714 rows at 23:24" (holiday and weekend dates carry only daily-NAV funds, ~5%); 241 NAVs of `0` are dropped; mfapi answers an unknown code with 200 and no data. Changes: rows go in as one JSON array per statement (`json_each`, 2,000 NAV rows) instead of 30 bound rows, so a night is one batch and the queue split isn't needed; new tables `nav_anomaly`, `nav_run`; R2 series use ISO dates; logs never carry scheme codes (they could tie an upload to a fund); `test/no-market-network.ts` blocks mfapi/AMFI in tests; uploads now resolve CDSL ISINs to codes and send one backfill per new code with its first transaction date. Fixed (from M8): `export const TMP_SWEEP_CRON` in `src/index.ts` stopped `wrangler dev` from starting (workerd refuses non-handler exports); moved to `src/lib/jobs.ts`. Staging: after the owner merges and CI deploys (applies `market/0002`), and one night of runs, `node scripts/nav-check.ts` must pass (carried into M10's Done when). Later: `marketHooks.onFinal` → snapshot-prebuild, skipping low-coverage weekend/holiday dates, which the 10:00 run also makes final (M10); the engine reads `market/nav/{code}.json` (M10); the "NAVs updating" hint from `/api/market/status` (M10); daily returns must expect liquid-fund NAVs on holidays and read `nav_anomaly` (M12); delete `nav_run` rows older than 90 days in cleanup (M14); alert on `nav_fetch_alert` and measure the `nav` table size after a month (M16); read replication on the production market DB (M17); a later statement with an earlier first transaction doesn't extend a finished `amfi_history` backfill |
| M10 | Snapshots and the live dashboard | 3 | done (staging checks passed 2026-11-26; the status fix below ships with the next merge) | 2026-11-26 | `72ef4be`, `a3c2323` | Local Done-when items pass. **Parity:** the private statements uploaded through the Worker (real `/parse`), built by the pf-rebuild consumer on a real EngineBatch container and served by `GET /api/portfolio` equal the old app's `/api/portfolio` with 0 differing paths (3 members, 14 holdings, 20 NAV series, build 2.0 s). The engine build gives the same 0 differing paths. Then `app/`, `parse.py`, `static/` and `requirements.txt` were deleted and the README Run section rewritten. 26 new Worker tests (220 total) and 9 new engine tests (43 in CI; 50/50 with private PDFs before the deletion) pass. `test/snapshot.test.ts` (24) covers the §16 Jobs rows: **4 uploads in 5 s → 1 build** (four 10 s debounced messages: built, current, current, current); **the older-build race** (the newer pointer stays, the older blob is deleted); concurrent same-input claim; idempotent re-delivery; failure keeps the previous snapshot and retries 3×; slot wait with a ticket; delete last statement → empty; rename/delete triggers; queued job → rebuild; backfill-pending codes sent as `refresh` with 2-min follow-ups; **stale snapshot served (`X-Snapshot-Stale`) then rebuilt**; lazy rebuild once per stale period, held back 10 min after a failure; tenant isolation; status `pending`/`building`/`ready` with `Retry-After`; prebuild once per date for households active in 7 days, skipping weekend/holiday finals; a rebuild right after finality reads the fresh day state. `GET /api/portfolio` is 1 D1 query with a warm cookie cache. ✅ VERIFY gzip passthrough: with `encodeBody: "manual"` the bytes on the wire match the Worker's (same SHA-256, `wrangler dev` + curl). Without it, workerd gzips again. Web: onboarding bento, a building state, the "Updating to today's NAV…" banner and a "NAVs still coming in" hint (M9 Later), and upload progress (uploading → reading statement → updating dashboard, status polling with Retry-After). Checked headless at 360 px and desktop, dark and light: 20 runs, 0 page errors, new touch targets 44 px. No sandbox notice was left in `web/` (it was in the deleted `static/`). **Changes:** the engine reads NAVs through `ctx.container.interceptOutboundHttp("market.internal", MarketGateway)` (R2 `market/nav/*`, read-only), not the S3 API. The container stays offline and gets no R2 keys, and the `R2_MARKET_READONLY_*` secrets are unused (the owner may revoke that token). Interception verified with a real container in vitest. The engine cache key is `(code, nav_key)`, not `(code, market_date)`; nav_key is date, final and coverage. The lease is taken before the claim. Snapshot keys are `{inputs_hash}-{8 hex}.bin`. `/build` answers `format: "gzip"` with the snapshot bytes. The consumer reads market status fresh, not from the edge cache. Migration `app/0005_snapshot.sql` (`requested_at`, `checked_at`, `failed_at`, `prebuild_run`). A member name equal to the statement holder name is sent as null, so the engine title-cases it as the old app did. Test guard `test/no-rebuild-queue.ts`. **Staging, after the merge** (CI applies `app/0005`): (1) ✅ carried from M9, 2026-11-26: `node scripts/nav-check.ts` passes, all 7 checks. Instead of waiting for the night, the 10:00 IST nav-ingest (`30 4 * * *`) was run twice with the deployed commit's code under `wrangler dev`, with remote bindings to staging: 14,240 NAVs and 14,481 schemes, then 0 rows on the re-run; 25-Nov is final (8,698 schemes). The run's queue sends didn't arrive, because remote queue producer bindings under `wrangler dev` deliver nothing (the queue analytics show 0 operations). So the 3 backfills were re-sent through the Queues REST API; the deployed consumer finished them (3/3) and wrote their R2 series. (2) + (3) ✅ `node scripts/upload-smoke.ts https://staging.pocketfolio.in` (now with snapshot checks) uploads one private statement, and the snapshot is `ready` about 28 s later (10 s debounce plus a cold EngineBatch start on Cloudflare). The checks: one sealed snapshot blob, no plaintext in it; the raw `GET /api/portfolio` has `Content-Encoding: gzip`, starts `1f 8b`, and one gunzip gives the JSON; the benchmark and fund returns are present for both holdings, so the Cloudflare container read the R2 series through `market.internal`; without gzip it's plain JSON. After the delete, staging R2 `h/` is empty. **Fixed after the staging run:** right after the last statement is deleted, status said `empty` and `GET /api/portfolio` could serve the old snapshot until the rebuild emptied it (10–30 s). A due rebuild now counts as `pending` whenever a blob exists, and with no statements the empty portfolio is served (test added). Later: delete the old blob's `daily/` cache entries on pointer switch (M12); the prebuild household scan and the nightly drain rate (M16 load test, 5,000 households); a lease leaks until expiry (120 s) if the claim query throws; root `.env.example` still lists the old app's keys (owner's call; `BHARATSTOCK_API_KEY` moves to `.dev.vars` in M11); `test/tenant.test.ts` member order is flaky when two members get the same `created_at` ms (pre-existing) |
| M11 | Stocks inside funds (BharatStock fallback job) | 3 | done (on staging 2026-11-26, PR #8) | 2026-11-26 | `1e2509a`…PR #8 | Owner confirmed cloud use (50 calls/day); the key was copied from the root `.env` into `worker/.dev.vars` without being printed. 21 new Worker tests (242 total, 241 pass + the opt-in live one) and 5 new engine tests (46 pass) pass. `test/stocks.test.ts` runs a synthetic BharatStock in the real response shape. **Equity funds in a test household get holdings:** build → the engine names its equity funds → `stock_match` → `stocks` job → `fund_portfolio` + R2 `market/holdings/{isin}/{month}.json` → the follow-up build has them, and no more follow-ups. **The budget stops at the limit** (limit 3 → exactly 3 calls; 3 parallel passes at limit 5 → 5), continues the next UTC day, and a 429 spends the rest of the day. Also covered: direct and regular plans share one fetch, paging at 100, refetch only on a newer coverage month (an empty newest month falls back to the one before), fund-of-funds look-through, unmatched retried after 30 days, 4xx skips the fund for a day, 5xx retries the message, single flight with one more pass on a request mid-run, lost-message resend, no key = off, and the stocks version in the inputs hash. **Live check** (`BHARATSTOCK_LIVE=1`; synthetic household, one real public fund, real EngineBatch container, real API): 5 paid calls, 2 job rounds, 145 holdings (100% of the fund), look-through 1, month 2026-10, nothing pending. M10 parity still 0 differing paths. ✅ VERIFY: the BharatStock API fields match the old app; `page_size` max 100 (422 above); coverage is free and keyless. **Changes:** the Worker doesn't classify funds: `/build` returns `X-Engine-Stocks-Want` ([isin, display name], equity plus one level of fund-of-funds), and matching uses that name, as the old app did. The budget counts UTC days (the provider's) via the new `QuotaSpec.utc`. The cron is daily `0 4 * * *` (09:30 IST) instead of `0 5 10-20 * *`, until M18 brings the monthly scrape back. New tables: `stock_match`, `stock_coverage`, `job_lock`, `stock_state`. SNAPSHOT_VERSION 2 (every snapshot rebuilds once after deploy). `BHARATSTOCK_API_KEY` is an optional secret (not in `secrets.required`). The parity expectation now has stocks enabled (tests have a test key). **Staging** (on the owner's instruction: Claude put the secret on staging from `.dev.vars` over stdin, then merged PR #8; CI deploy green): `market/0003` applied (job_lock row, `stock_state` 0), the `0 4 * * *` cron registered, `/api/health` ok. One `stocks` message sent through the Queues API ran on the deployed consumer: it claimed and released the lock and stored BharatStock's free coverage list (82 fund houses), with no wanted funds yet, so 0 paid calls. The first real upload on staging will exercise the paid path. Later: the Worker reads ~1 R2 blob per held equity fund per build, so an engine-side cache through `market.internal` if the nightly prebuild makes that costly (M16); delete `stock_match` rows unwanted for 90 days and their blobs and `fund_portfolio` rows in cleanup (M14); alert when the budget runs out on consecutive days (M16); M18 restores the monthly scrape cron and fetches from BharatStock only when no `amc` row exists after day 15; root `.env.example` still lists the old app's keys (owner's call) |
| M12 | Daily returns | 3b | done (staging verified 2026-11-26, PRs #9 and #10) | 2026-11-26 | `529f5d5`, `db7f4fb`, PR #9 `02c10f9`, PR #10 `7955137` | Done-when items pass. **Golden tests:** `test/daily.test.ts` (19) works `dailySeries()` out by hand. Day change for a two-fund household: Tue +₹15 / +1.2%, Wed −₹2.50 / −0.1976%. A purchase or a redemption mid-window is not a gain or loss, and estimated SIP units count from the day after allotment. Weekends and holidays give no point, and a liquid fund's holiday NAV rolls into the next market day. Partial coverage shows "1 of 2". An IDCW payout is added back; an unexplained `nav_anomaly` move is left out and flagged. Also covered: the CDSL-only `units_exact=false` note, ETFs/shares excluded, the member filter. Endpoint: the hand calculation through the real pf-rebuild consumer, cache hit, a new NAV day uses a new key, the rebuild deletes the old inputs' entries, partial coverage fresh for 30 min only, member 404 across households, bad `days` → 400, sealed blob. **Measured** (vitest/workerd): cached p95 3 ms (50-fund household, ~19k NAV rows; uncached 57 ms). A cached call does no MARKET read. Totals after the follow-up: Worker 268 pass + 1 opt-in skipped (269); engine 68 pass (+4/4 private parse with the test password). The M10 parity on the private statements still has 0 differing paths (3 members, 14 holdings). Private engine build, counts only: 22 holdings, 22 coded, 14 exact timelines, 6 active SIPs, all with a next run date on or after today. **Owner additions (2026-11-26, in scope by request):** (1) returns from the last statement: holdings are valued at the latest NAV, and active SIPs are estimated after the statement date (mandate day, units at the run day's NAV after stamp duty) into units, invested, XIRR flows, activity and the month-end chart. A newer statement replaces them. The UI never asks for a new upload. (2) Broker-style run days and statuses. ✅ AMFI Annexure A2 (NACH: debit T, allot T) and KFintech's SIP TAT (NACH T+1/T+2): a due date on a weekend or holiday runs the next business day. An instalment is "In progress" from T until T+2 business days, then "Done". Shown as "Moved from 24 Nov (market holiday)" and "In progress · debited 25 Nov · units by 27 Nov" on the overview, SIP page, fund dialog and transactions. Engine `projection.py` and `holidays.py`. Snapshot fields: `statement`, `estimated`, `amfi_code`, `units_timeline`, `units_exact`, `payouts` per holding; `statement_total`, `value_date`, `estimated` per member; `sip_day`, `next_due`, `next_moved`, `latest` per SIP. SNAPSHOT_VERSION 3. ✗ Correction: a version bump alone did **not** rebuild existing snapshots. A snapshot rebuilt only on a new market day or a statement change, so the owner kept seeing the pre-M12 dashboard (no estimated 24 Nov SIP; next SIP "25 Dec" from the old last + 30 days). Fixed in PR #12: `snapshot.version` (`app/0007`) makes an older-version snapshot stale, so the first read after a deploy rebuilds it, and the consumer never calls it current. Web: the Today tile (4 bento tiles now), a sortable 1D column (under the value on mobile), the Daily returns panel (1M/3M/1Y, bars, calendar heatmap, best/worst/% up, honesty note), and the value date in the hero. Checked headless at 360 px and 1280 px, dark and light, on two synthetic households: 8 runs, 0 page errors. **Changes from the plan:** market days come from the household's funds (>½ of the funds alive have a NAV), since `market_day` only keeps recent dates; one `json_each` NAV query instead of ≤ 90-code chunks; the cache write is awaited, not `waitUntil`; `by_fund` covers only funds updated on the latest day; a cached hit skips the member check (its key can only exist after one). **Follow-up, same day (owner decisions):** (a) no time cap on estimates; instead, as at brokers, **skip the next instalment** (one per SIP, undoable) or **cancel a SIP** for good after a confirmation. Both are recorded for PocketFolio only, and the dialog says it doesn't cancel with the broker. Stored sealed in `sip_override` (`app/0006`), sent to `/build` as `overrides`, part of the inputs hash; a newer statement showing instalments after a cancel wins. (b) **Holiday job:** ✅ Upstox's public market-holidays API lists the 2026 NSE closures (16), matching the NAV store, except 31 Mar (year end: NAVs published, exchange closed). `refreshHolidays` rides the daily `0 4 * * *` cron and fetches weekly into `market_holiday` (`market/0004`); builds send the dates, and the engine falls back to its own 2026 list. Tests: `test/sips.test.ts` (8): the real 2026 answer parsed, weekly fetch, failure keeps dates and retries, a dropped holiday goes, skip/undo/one-per-SIP, cancel needs confirm, is final and blocks skips, 404 across households, bad dates/ISINs 400, sealed storage, build gets overrides and holidays, a change rebuilds, member delete cascades. Engine +7 (skip, past skip, cancel, statement beats cancel, Worker holidays, bad overrides, `/build` overrides). UI checked headless at 360 px and 1280 px: menu (44 px target), skip, cancel dialog, skipped and cancelled states, 0 page errors. Fixed in the check: a malformed `/daily` answer could crash the dashboard (now treated as unavailable). **Staging (PRs #9 and #10 merged by Claude on the owner's instruction; CI deploy green, `app/0006` and `market/0004` applied):** `node scripts/upload-smoke.ts https://staging.pocketfolio.in` with a private statement that has active SIPs passes 43/43. Results: 8 funds revalued to the latest NAV; 6 active SIPs with next runs from today, 3 of them moved for a weekend or holiday; 3 estimated instalments, all in progress (the 24 Nov holiday instalment); `/daily` miss then hit, 21 points, coverage 8/8; skip → rebuild → undo → rebuild → cancel (400 without confirm) → rebuild → cancelled; cleanup removes the statement, snapshot, daily cache and member. The holiday job ran against staging (deployed code, scratch Worker): Upstox answered, 16 rows stored, 25 Dec 2026 the one ahead. **Found on staging and fixed (PR #10):** a cached `/daily` call paid ~250 ms for the R2 read, so the sealed blob is now also in the edge cache. The endpoint's own work is now 4 ms p50, and `Server-Timing` reports the phases. The remaining ~220 ms is the D1 snapshot-row read every signed-in endpoint makes; this machine reaches Cloudflare through Marseille (MRS) while the staging D1 is in APAC. Also: a network timeout ended one smoke run before its cleanup, which stranded a statement on staging. It was deleted through the API, along with members left by earlier runs, and the script now retries network errors and cleans up if it crashes. **Owner check after PR #12:** three SIPs showed the next run on 21 Dec (moved from the 20th) instead of 24 Dec. Their mandate moved from the 20th to the 24th in June, and the "most common day over 12 instalments" rule still picked the 20th, so their 24 Nov instalments weren't estimated. Fixed in PR #13: the mandate day is the one the latest run of instalments agrees on (each instalment allows its own date or a weekend/holiday before it). SNAPSHOT_VERSION 4. Checked on the owner's statement (counts only): 6/6 SIPs on the 24th, next run 24 Dec, 6 November instalments estimated. Later: measure signed-in latency from India and consider app-DB read replicas or Smart Placement for the per-request D1 read (M16); `GET /api/portfolio` reads the snapshot from R2 on every call, so edge-cache it too (M16); delete `sip_override` skips older than the newest statement in cleanup (M14); alert when the holiday fetch fails for a week (M16); re-measure `/daily` on Cloudflare in the M16 load test; the tax figures (`tax`, harvest) stay as of the statement; "Invested via these SIPs" on the SIP page counts statement instalments only; a dashboard left open past `units_by` only flips "In progress" → "Done" on the next load |
| M14 | Privacy and compliance | 5 | done (lawyer review deferred ~6 months, owner 2026-11-26) | 2026-11-26 | `2d00821`, `9638cfc` + docs | Done-when items pass. **A deleted account leaves no rows, no R2 objects and no DEK:** `test/privacy.test.ts` deletes a household with members, statements, a parked PDF (`tmp/`), a snapshot blob, a SIP change, a pending password, an export quota row, an unused sign-in code and link, the per-address rate-limit row and a second signed-in device, then scans **every table and column** of the app D1 for the user id, household id and email: only `audit_event` remains (ids, event, country, UA hash; kept 400 days for DPDP Rule 6/8(3), plus an `account_deleted` row). `h/` and `tmp/` are empty, the household row (DEK) is gone, the other household is untouched, cookies are cleared, the second device gets 401, the confirmation email is sent. The inactivity erasure passes the same scan. **Export contains all the user's data and nothing else:** members with decrypted names and PANs, every statement's parsed JSON, SIP changes, sessions (IP, UA), consents, sign-in methods, the security log; no other household's values, no `dek_wrapped`/`pan_hmac`/`blob_key`/`content_hash`/`sip_key`/token, 3 a day (429 `export_limit`). 12 new tests; Worker 283 total (282 pass + the opt-in live one skipped); engine 70 pass (6 private skipped, no engine change). Typecheck and lint clean. **Consent gating:** `requireSession()` gates by default (403 `consent_required`); `/me`, `/consent`, export and delete opt out. A consented request makes **0** consent queries (cookie cache, tested); consent from another device counts at once (one D1 check). The test sign-in helper accepts the notice. Web: consent screen (18+ box), `/privacy`, `/terms` ("Not investment advice"), `/security`, Settings → Download my data / Delete account (typed `DELETE`; past 10 min the dialog signs out and back in, then reopens), legal footer on every page incl. /login, "deleted" notice on /login, tax disclaimer in the fund dialog. Headless at 360 px and 1280 px, dark and light: 124 checks, 0 page errors (no overflow, 44 px targets, footer above the bottom nav). `docs/INCIDENT_RESPONSE.md` written; README Privacy rewritten. ✅ VERIFY (plan §12): the fixed 3-year inactivity period of Rule 8 + Third Schedule binds only large e-commerce, social media and gaming platforms; others erase when the purpose is no longer served, so any period ≥ the law's is a policy choice. **Owner, mid-milestone: inactivity is 3 years** (not 12 months); notice email, erasure ≥ 48 h later unless the user signs in or uses the app (the daily session refresh stamps `last_active_at`, tested). Source: DSCI FAQ and the MeitY/PIB summary; the gazette text wasn't readable, so the lawyer confirms. **Cleanup cron** (`0 21 * * *`) also does the earlier Later items: `rate_limit` (M5), `quota` (M6), finished `parse_job` after 7 days (M8), `nav_run` after 90 days (M9), `stock_match` unwanted 90 days with their holdings (M11), SIP skips older than the newest statement (M12), plus expired sessions/verifications, `tracked_scheme` unseen 90 days, `audit_event` > 400 days. Migration `app/0008_privacy.sql` (`household.inactivity_notice_at`, two indexes) reaches staging with the next merge. `scripts/auth-smoke.ts` and `upload-smoke.ts` now accept the notice (auth-smoke also checks the 403 before it). **Placeholders (owner):** legal entity name, grievance officer name and email, jurisdiction in `web/src/lib/legal.ts` (`placeholders: false` removes the draft banner), and the contacts in `docs/INCIDENT_RESPONSE.md`. Later: lawyer review of the pages, the notice and the incident plan (M17), incl. CERT-In's 180-day log retention; staging after the merge: `auth-smoke.ts` and `upload-smoke.ts`, and one export + delete by hand; a deleted account's other devices keep a valid cookie cache ≤ 5 min (data routes find nothing; `/me` answers 401); re-sign-in through the emailed link lands on `/`, not back in Settings (Google and the code keep `next`); `PAN_PEPPER` rotation needs a re-hash migration (INCIDENT_RESPONSE §4); `/api/me` `limits`/`usage` and Settings fair-use usage still unbuilt; the tax-harvest and health-check panels need the inline disclaimer when they're built |
| M15 | Installable app (PWA) | 5b | done (device checks wait for the owner after the next staging deploy) | 2026-11-27 | `fce43c9` + docs | Local Done-when items pass. **Installable:** CDP `Page.getInstallabilityErrors` empty in a normal profile, and Chrome for Testing fired a real `beforeinstallprompt` on the built app. Manifest parses with 0 errors. `wrangler dev` serves the manifest as `application/manifest+json` and `sw.js` with `no-cache` (`web/public/_headers`). **No API data cached:** after visiting every tab, Settings and Members, Cache Storage holds the 33-entry app shell, no `/api/` entry and no IndexedDB. **Prompt rules:** `web/src/lib/install.test.ts` has 26 unit tests. A headless run of the built app with its SW and a mock API passes 33/33 checks: not before sign-in, not on first arrival, not when launched from the app, not within 14 days of a dismissal, not after 3; shows on a later day; Install calls the browser prompt; appinstalled → toast; the iPhone sheet in both themes, the Android sheet and the desktop card; webview → no auto prompt; Settings → Install; offline → shell + offline panel, then reload when back; theme-color follows the toggle; launch and install counters reach `/api/metrics`. Worker 286 pass + 1 skipped (4 new metrics tests). Web build, lint (no new warnings) and typecheck pass. ✅ VERIFY: Chrome criteria, iOS 26 Share wording (⋯ → Share), iOS cookie split; see plan §13A. Changes: real theme colours `#0A0C14` / `#F2F3F7` (plan had others); status-bar style `default`; CSP lines wait for M16 (there is no CSP yet); pages code-split (login now loads 346 KB, not 918 KB; the dashboard chunk is 505 KB, mostly recharts). **Owner, after the next deploy to staging:** install on Android Chrome (+ both shortcuts), desktop Chrome and Edge, iPhone Safari (email-code sign-in inside the app; check safe areas and status bar in both themes) and macOS Safari; check DevTools → Application → Cache Storage. Later: split recharts out of the dashboard chunk (M16) |
| M22 | Reject disposable email addresses | 1b | done (ships to staging with the next merge) | 2026-11-27 | see `M22:` commit | 9 new tests (295 pass + 1 opt-in skipped). `test/disposable.test.ts` covers a listed domain, a listed subdomain, mixed case (all `400 disposable_email`, Turnstile not called, nothing queued, log has the code only), no rate-limit rows used on refusal, an existing user on a listed domain (still emailed), an unlisted domain, and the test sink. The list is `disposable-email-domains-js` 2.4.0 (CC0, 10,455 domains). `/login` copy checked headless at 360 px and 1280 px against local `wrangler dev`: the message shows, no overflow, 0 page errors. One run of the full suite had a timing flake in `tenant.test.ts` ("newest first"); it passed alone and on the next full run |
| M23 | Competitor and market research | 9 | todo | | | |
| M24 | Premium design refresh, logo and dashboard redesign | 9 | todo | | | |
| M13 | QR device login | 4 | todo | | | |
| M25 | Landing page and SEO foundation | 9 | todo | | | |
| M26 | Blog | 9 | todo | | | |
| M27 | FIRE calculator | 9 | todo | | | |
| M30 | Social marketing playbook (Reddit, LinkedIn, X) | 9 | todo | | | |
| M18 | AMC disclosure scraper | 7 | todo | | | |
| M19 | Manual assets: FD, PPF, EPF | 8 | todo | | | |
| M29 | Gold and silver (physical, SGB) | 8 | todo | | | |
| M20 | Stock and ETF prices | 8 | todo | | | |
| M28 | Benchmark score for funds and stocks | 8 | todo | | | |
| M21 | Stock gains: buy prices and corporate actions | 8 | todo | | | |
| M16 | Hardening and load tests | 6 | todo | | | |
| M31 | Cost per user and pricing study | 6 | todo | | | |
| M17 | Production launch | 6 | todo | | | |
| M32 | AI portfolio analysis | 10 | todo | | | |
| M33 | Admin panel | 10 | todo | | | |

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
- `pocketfolio.in` onboarded in Cloudflare Email Sending (✅ owner, 2026-11-25). No API key is needed, because the
  Worker uses the `send_email` binding. If a deploy with the binding is refused, the Cloudflare token also needs
  Email Sending: Edit.
- Two email addresses you can read.

**Build:**
- Better Auth on D1 `DB`: Google, magic link + email OTP in one email, cookie cache, `householdId` /
  `consentVersion` session fields, narrowed rate-limit rules, migrations `app/0001_auth.sql` (+ `0002_household.sql`).
- Household + empty snapshot row created on signup. DEK generated and wrapped (`crypto.ts` key parts only).
- `EmailSender` + Cloudflare Email Service (`send_email` binding `EMAIL`), sending through `pf-email`, one call per
  message with per-message retry (plan §7.3). A staging-only email sink for automated tests.
- Turnstile check on the email form. Session middleware, `/api/me`, `/api/config`, sign-out, the global 401 handler.
- Frontend: `/login` (Google primary, email link/code, PocketFolio wordmark), the avatar menu, a tiny router.
- ⚠️ VERIFY: Better Auth option names (cookieCache, additionalFields, rateLimit customRules), the combined link + code
  email, the `send_email` binding config (sender restriction, local dev with `remote`), the Email Service error codes,
  and Email Routing (`support@`) coexisting with Email Sending on the zone.

**Done when:**
- Sign-in with Google and with a magic link works on staging, and the 6-digit code works.
- The auth tests in plan §16 pass.
- A warm-cache request makes 0 D1 session queries (counted in a test).

## M6: Tenant data, encryption, members
**Goal:** the secure data layer every later feature uses.
**Read:** plan §6, §8, §9.1, §9.2 (members rows), D18.
**Needs from owner:** none.
**Build:**
- Migration `app/0003_app.sql` (household and snapshot already exist from M5's `0002_household.sql`): member, statement, parse_job, pending_statement_password, quota,
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
- Carried over from M7 (owner, 2026-11-26): after the owner merges M6–M8 and CI deploys staging,
  `node scripts/upload-smoke.ts https://staging.pocketfolio.in` passes (one sealed blob, nothing in `tmp/`, no
  plaintext in a raw read).
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

**Done when:**
- Carried over from M9 (2026-11-26): after the owner merges and CI deploys staging (which applies `market/0002_nav.sql`),
  and one night of nav-ingest runs, `node scripts/nav-check.ts` passes (every tracked scheme has the latest
  business-day NAV, later runs insert only new rows, every tracked scheme is backfilled).
- The Jobs tests in plan §16 pass (including "4 uploads → 1 build" and the older-build race), and the parity diff is
  empty.

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
**Owner additions (2026-11-26):** the dashboard shows returns from the last statement up to today. Active SIPs are
estimated after the statement date and valued at the latest NAV, and a newer upload replaces the estimates. SIP run
days and statuses follow brokers and RTAs: a weekend or holiday runs the next business day, and an instalment is "In
progress" until units show (T+2), then "Done". See plan §10.5.1.

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

## M22: Reject disposable email addresses
**Goal:** new accounts can't be made with throwaway inboxes (mailinator etc.).
**Read:** plan §21.7, §7.1, §7.3.
**Needs from owner:** none.
**Build:**
- Bundle the open-source `disposable-email-domains` list at build time (✅ M22: npm `disposable-email-domains-js`, CC0,
  ~200 KB, released several times a month; see plan §21.7). Subdomains of a listed domain count as listed. It's refreshed when dependencies are updated.
- `POST /api/login/email` checks the domain before Turnstile's token is spent and before any email is queued:
  `400 disposable_email`, with friendly copy on `/login`. **Only new accounts are blocked:** an address that already
  has a user still signs in. Google sign-in isn't checked.
- Log only the outcome code, never the address or the domain.

**Done when:** tests cover a listed domain, a listed subdomain, mixed case, an existing user on a listed domain (still
signs in), an unlisted domain, and no email queued on refusal. `/login` is checked headless at 360 px and desktop.

## M23: Competitor and market research
**Goal:** know who else serves Indian families, what they offer, and what PocketFolio does better, before the redesign
and the public pages.
**Read:** plan §21.1–§21.3, §21.10, `README.md`, the live staging app.
**Needs from owner:** none. No code, no user data. Only public pages are read.
**Build:** `docs/research/COMPETITORS.md`, with sources and the date read:
- Competitors: at least INDmoney, Kuvera, ET Money, Groww, Zerodha Console/Coin, Value Research, MProfit, Wealthy,
  Tickertape, Portfolio360, Velthian, and any family-portfolio tracker the search finds. For each: features (family
  view, CAS import, stocks, gold, FD/PPF/EPF, FIRE, tax, AI), pricing, data/privacy stance, sign-in, landing page
  structure and design, and what users complain about (Reddit, app-store reviews).
- **Where PocketFolio adds value:** a feature matrix and a one-line positioning.
- **Landing page:** recommended sections, headline options, proof points, FAQ, calls to action.
- **Dashboard:** what the best dashboards show first, as input to M24.
- **FIRE calculators:** compare velthian.com/fire.php, portfolio360.co.in/fire and the best others, and recommend the
  inputs and outputs for M27.
- **Keywords:** search terms and questions families ask (for M25/M26), plus the subreddits and communities for M30.

**Done when:** the document exists, every claim has a source, and the owner has read the recommendations.

## M24: Premium design refresh, logo and dashboard redesign
**Goal:** PocketFolio looks premium, not "vibe coded": a gold-accented design system, a new logo, and a redesigned
dashboard, applied to every existing screen.
**Read:** plan §13, §21.1, `docs/research/COMPETITORS.md` (M23).
**Needs from owner:** OK on the design direction (a written spec with 2–3 rendered options of the dashboard and the logo,
in the first session), then OK on the final look.
**Build:**
- **Logo:** a two-part wordmark in SVG: "Pocket" in plain text, "folio" on a gold, glass-like rounded block. Light and
  dark versions, a square mark, the favicon, the PWA icons and maskable icons (replacing the M15 ones), and the Google
  consent-screen logo.
- **Design system v2:** gold accent palette with contrast checked (WCAG AA) in dark and light, type scale, surfaces
  (glass/elevation), components and motion, written into plan §13 as the new reference. Update the `CLAUDE.md` hard
  rule to point at it.
- **Dashboard redesign** from M23's findings, in the new system, with the same data and no feature changes.
- Restyle every existing screen: login, consent, members, settings, legal pages, dialogs, toasts, install sheets.
- Regenerate the M15 store screenshots from demo data.

**Done when:** every screen is checked headless at 360 px and 1280 px, dark and light, with 0 page errors, no overflow
and 44 px touch targets. Contrast passes AA. `web` build and lint pass. The owner OKs the result on staging.

## M13: QR device login
**Read:** plan §7.4, D2, §13 items 1, 2 and 7.
**Needs from owner:** none.
**Order:** after M15 (owner, 2026-11-26), so the QR flow is built and tested in the installed app too (plan §13A.5).
**Owner decisions (2026-11-26):**
- **One account, many devices, like WhatsApp Web.** The linked device signs in to the approving device's own account:
  same user, same household, same data. It doesn't create a user, ask for an email, or sign up. It's just one more
  session for that user.
- **No "new device" email.** Instead, an in-app notice: the account's other devices show a one-time "New device
  linked: Chrome · macOS · Mumbai" toast, and Settings → Devices marks the device "New". The `audit_event` is still
  written.

**Build:** the device-authorization plugin, the `/login` QR tab, the `/link` approval page, the scanner, the cookie
bridge if needed, the Devices list, and the in-app "New device linked" notice.
**Done when:** the QR auth tests in plan §16 pass (including: the new session belongs to the approver's user and
household, no user row is created, and no email is queued), and phone-to-desktop linking works on staging.

## M25: Landing page and SEO foundation
**Goal:** a public landing page that converts, and pages that Google and AI search engines can read.
**Read:** plan §21.2, §13 (v2 from M24), `docs/research/COMPETITORS.md`.
**Needs from owner:** OK on the landing copy (drafted from M23). OK to install the SEO skill after Claude's review (below).
A Google Search Console property for `pocketfolio.in` (owner verifies it by DNS), done any time before M17.
**Build:**
- **SEO tooling:** read the third-party code of github.com/AgricIDaniel/claude-seo (and what claudeseoskill.com
  describes) in full. Check that it sends nothing anywhere and runs nothing unexpected. Write the review into
  `docs/research/SEO.md`. Install it as a project skill only with the owner's OK. Then use it for an audit.
- **Public pages are prerendered** at build time (real HTML, not only the SPA shell): `/` for signed-out visitors,
  `/privacy`, `/terms`, `/security`, and the routes M26/M27 add. A signed-in visitor on `/` goes straight to the
  dashboard (decide in the plan section how: cookie check in the Worker or a client redirect).
- The landing page in design system v2: the sections recommended in M23, product visuals from demo data only, and calls
  to action to `/login`.
- Per page: title, description, canonical, Open Graph and Twitter cards (generated images), structured data
  (`Organization`, `WebSite`, `SoftwareApplication`, `FAQPage`), `sitemap.xml`, `robots.txt`, `llms.txt`.
  `noindex` on app routes.
- Core Web Vitals budget for the landing page (LCP, CLS, JS size), measured headless.

**Done when:** the prerendered HTML contains the content and metadata (tested), structured data validates, Lighthouse
SEO and accessibility scores are recorded in the plan, and the landing page is checked at 360 px and desktop, dark and
light.

## M26: Blog
**Goal:** helpful articles that bring families to PocketFolio from Google and AI search.
**Read:** plan §21.2, `docs/research/COMPETITORS.md` (keywords), `docs/research/SEO.md`.
**Needs from owner:** a review of each draft. **A post goes live only after the owner's OK.**
**Build:**
- `/blog` and `/blog/<slug>`, prerendered from Markdown in the repo, with a `draft` flag that keeps a post out of the
  build, the sitemap and the feed. RSS feed, `Article` structured data, author and dates, related posts, a call to
  action.
- 6–8 researched drafts, for example: how to track a family's mutual funds in one place; what a CAS statement is and
  how to download it (CAMS, KFintech, CDSL); one dashboard for every family member's PAN; LTCG harvesting; how SIP
  dates move on holidays; FIRE in India. Final topics come from M23's keyword list. Each cites its sources and carries
  "not investment advice". Screenshots use demo data only.

**Done when:** a draft never reaches the built output (tested); published posts validate as `Article`; the owner has
OK'd each post that goes live.

## M27: FIRE calculator
**Goal:** a FIRE (financial independence, retire early) calculator anyone can use without signing in, with a detailed
plan from the user's real portfolio after sign-in.
**Read:** plan §21.3, `docs/research/COMPETITORS.md` (FIRE section).
**Needs from owner:** OK on the plan section (inputs, formulas, outputs) written in the first session.
**Build:**
- **Public `/fire`** (prerendered, SEO page): age, retirement age, monthly expenses, current savings, monthly SIP,
  expected returns, inflation, withdrawal rate. Out: FIRE number, years to FI, the SIP needed, a corpus chart, and Lean,
  Regular and Fat variants. Computed in the browser; nothing is sent or stored.
- **Signed-in analysis:** the current corpus, SIPs and allocation are read from the snapshot (plus manual assets when
  M19/M29 exist). Shows the gap to the FIRE number, the required SIP, the projected FI date at today's pace, and
  scenarios (returns, inflation, step-up SIP). Saved goal inputs are sealed with the household DEK.
- A pure, unit-tested calculator module shared by both pages. "Approximate, not investment advice".

**Done when:** golden tests for the formulas (inflation, step-up, withdrawal rate) pass; `/fire` sends no request with
the inputs (tested headless); the signed-in view matches a hand calculation for a test household; the screens are
checked at 360 px and desktop, dark and light.

## M30: Social marketing playbook (Reddit, LinkedIn, X)
**Goal:** a plan for reaching families on Reddit, LinkedIn and X, with the first posts ready.
**Read:** plan §21.11, `docs/research/COMPETITORS.md` (communities), the published blog posts.
**Needs from owner:** the owner creates the accounts and posts. **Claude never posts, comments or creates accounts.**
**Build:** `docs/marketing/SOCIAL_PLAYBOOK.md`:
- **Reddit:** which subreddits, each one's self-promotion rules (read and cited), a comment-first approach, cadence,
  and what gets accounts banned.
- **LinkedIn and X:** profile setup, content pillars and a posting cadence.
- **Drafts:** the first 10 Reddit posts and comments, 5 LinkedIn articles, and 10 X posts.
- Images come from demo data only. Never use a real portfolio.

**Done when:** the playbook and drafts exist, and every subreddit rule cited has its link and the date it was read.

## M18: AMC disclosure scraper
**Read:** plan §10.3.1 (all), D10.
**Needs from owner:** none.
**Build:** the adapter framework, the top 10 AMC adapters (each with its own ⚠️ VERIFY notes at the top of the file),
`scrape_run` monitoring, and BharatStock limited to the gaps.
**Done when:** ≥ 80% of tracked equity schemes have `source='amc'` holdings by day 15 of the month.

## Phase 8: beyond mutual funds (before launch; owner request, 2026-11-26)
These extend tracking to stocks/ETFs and to manually entered instruments. The plan has no design for them yet: the
first session of each milestone writes the plan section (data model, API, UI, privacy), gets the owner's OK on it, and
only then builds. Keep the design system (plan §13), tenant guard (§9.1) and encryption (§8) as for everything else.

## M19: Manual assets: FD, PPF, EPF
**Goal:** a family adds fixed deposits, PPF and EPF by hand and sees an approximate current value and return next to
their funds.
**Read:** plan §6 (member), §8, §9.1, §10.2, §13.
**Needs from owner:** OK on the plan section written in the first session (which instruments, which inputs).
**Build:**
- **Members without a statement.** Today a member exists only from a statement, and `member.pan_hmac` is NOT NULL (D19).
  Decide (in the plan section) between members added by hand (name, optional PAN) or assets owned by the household with
  an optional member, and migrate accordingly.
- `manual_asset` table (D1): household-scoped, inputs sealed with the household DEK (amounts are personal financial
  data). Per type: FD (principal, rate, compounding, start, maturity, payout or cumulative), PPF (yearly deposits, start
  year), EPF (balance on a date, monthly contribution). CRUD API behind the tenant guard.
- A pure, unit-tested calculator in the Worker (`lib/manual-assets.ts`): FD compound interest, PPF yearly at the
  government rate, EPF monthly at the EPFO rate. A small rate table (PPF quarterly, EPF yearly) with a user override.
  Values are labelled "approximate".
- `GET /api/portfolio` adds them at read time (no engine rebuild). Totals and asset allocation include them (Debt /
  Fixed income). Export (M14) and account deletion include them.
- Frontend: add/edit/delete forms in the existing dialog style, a section on the dashboard and in Members.

**Done when:** golden tests for each calculator (including a premature FD, a PPF with irregular deposits, and an EPF
rate change mid-year); isolation tests (another household gets 404); no plaintext amounts in D1; the screens are checked
at 360 px and desktop, dark and light.

## M29: Gold and silver (physical, SGB)
**Goal:** families add physical gold and silver and Sovereign Gold Bonds, valued daily next to their funds.
**Read:** plan §21.5, the M19 plan section, §10.4 (the ingest pattern).
**Needs from owner:** OK on the plan section (rate source, inputs) written in the first session.
**Build:**
- New `manual_asset` types (M19's table, sealed inputs, the same member model):
  - **Physical gold/silver:** grams, purity (24K/22K/18K for gold; 999 for silver), optional buy price and date.
  - **SGB:** series, units (grams), issue price, issue date. Interest 2.5% a year, paid every six months, shown as
    income. Maturity 8 years.
- A daily public gold and silver rate per gram in `pocketfolio-market` (⚠️ VERIFY the source and its terms, e.g.
  IBJA). Fallback: the per-gram price implied by gold/silver ETF NAVs already in the NAV store.
- Value = grams × rate × purity. SGB is valued at the gold rate (the redemption basis). Allocation gets a "Gold &
  silver" class. Export and deletion include them.

**Done when:** golden tests (purity, an SGB interest schedule, a missing rate day falling back), the rate ingest parses
saved public fixtures, re-runs insert 0 rows, isolation tests pass, and the screens are checked at 360 px and desktop,
dark and light.

## M20: Stock and ETF prices
**Goal:** stocks and ETFs already in CDSL statements are valued at the latest exchange price and are included in daily
returns.
**Read:** plan §10.4 (the NAV store pattern), §10.5, §20 ("Exchange prices for ETFs and stocks").
**Needs from owner:** none expected (public NSE/BSE end-of-day files); confirm the source in the plan section.
**Build:**
- An end-of-day price table in `pocketfolio-market` and an ingest job modelled on `nav-ingest` (NSE/BSE bhavcopy by
  ISIN), with ⚠️ VERIFY notes for the source format and terms.
- Track the equity ISINs seen in statements (like `tracked_scheme`).
- The snapshot values "Stocks & bonds" holdings at the latest price instead of the statement's; daily returns
  (§10.5) include them.
- Frontend: show stocks and ETFs in holdings and allocation, with the price date.

**Done when:** the ingest parses saved public files (committed fixtures), idempotent re-runs insert 0 rows, a CDSL
statement's stocks are revalued in a snapshot test, and daily returns include them.

## M28: Benchmark score for funds and stocks
**Goal:** every fund and stock shows a 0–100 score for how it did against the right index.
**Read:** plan §21.4, §10.4, the engine's `market.py`.
**Needs from owner:** OK on the scoring method in the plan section written in the first session.
**Build:**
- **A category → index map** (large cap → Nifty 100, mid cap → Nifty Midcap 150, small cap → Nifty Smallcap 250,
  flexi/multi cap → Nifty 500, ELSS → Nifty 500, sectoral → its sector index, debt categories → a CRISIL-style index or
  left unscored). The fund category comes from the AMFI section headers (⚠️ VERIFY that the M9 parse keeps them).
- **Index history:** TRI series from niftyindices.com (⚠️ VERIFY access and terms). Fallback: the NAVs of a direct-plan
  index fund for each index from the NAV store, like the existing Nifty 50 benchmark (`market.py`).
- **Score:** rolling 1/3/5-year excess returns, the share of rolling periods beaten, and downside capture, combined
  into 0–100, plus a plain line like "Beat Nifty Midcap 150 in 7 of 10 rolling years". A fund with less than 1 year of
  history isn't scored. Stocks are scored against Nifty 50 and their sector index, using M20 prices (history backfill
  ⚠️ VERIFY).
- Scores are market data (the same for everyone), computed nightly in the market DB, not per household. Shown in the
  holdings list and the fund dialog, with "not investment advice".

**Done when:** golden tests for the score on synthetic series, the category map covers every equity category in the
current AMFI file, and the screens are checked at 360 px and desktop, dark and light.

## M21: Stock gains: buy prices and corporate actions
**Goal:** gains, XIRR and capital-gains tax for stocks and ETFs, as for funds.
**Read:** plan §10.2, the engine's `analysis.py` (FIFO, LTCG), and the M20 section.
**Needs from owner:** which brokers to support first (tradebook formats), and OK on the plan section.
**Build:**
- CDSL statements carry holdings but usually no buy prices. Add one or both: a broker tradebook / P&L import (one
  parser per broker, in the engine, same privacy rules as statements) and a manual average buy price per holding.
- Corporate actions, **hybrid** (owner, 2026-11-27, plan §21.6): splits and bonuses after the statement date are
  applied automatically from NSE's public corporate-action file (⚠️ VERIFY the source), adjusting units and cost.
  Dividends are shown as income. Mergers, demergers and MF scheme mergers aren't computed: they show a banner, "X merged
  into Y. Upload a newer statement to update it.
- Reuse the FIFO and LTCG/STCG logic for listed equity.

**Done when:** golden tests for FIFO with a split and a bonus, a split after the statement date applied, a merger showing
the banner (no change to units), a parser test per supported broker on synthetic files, and private tradebooks checked
with counts only.

## M16: Hardening and load tests
**Read:** plan §11, §16 (Load row), §3.5, §17 Phase 6.
**Needs from owner:** an OK to run load tests on staging (synthetic users and fixture PDFs only).
**Build:**
- All fair-use limits and 429 copy, the "Coming soon" states (D8, D9), security headers / CSP, dependency audit.
- Alerts: DLQ, engine 5xx, D1 overloaded, stuck queued jobs, usage.
- **Load tests:** a 2,000-upload burst, a 5,000-household nightly prebuild, polling. Set pool caps and
  `max_concurrency` from the results. Write the measured drain time and cost into plan §3.5 and §18.

**Order:** after M21, just before launch (owner, 2026-11-26), so the load tests and hardening cover everything that
ships, including the AMC scraper (M18), manual assets (M19), stock prices (M20) and stock gains (M21), and the M22–M30
additions: the public pages (landing, blog, `/fire`) get CSP and caching checks, and the load test includes them.

**Done when:** the whole §16 table is green on staging, and the load-test numbers are recorded.

## M31: Cost per user and pricing study
**Goal:** know what one user costs per year, to set future prices, and decide the AI analysis model.
**Read:** plan §3.6, §18, §21.8, §21.9, the M16 load-test numbers.
**Needs from owner:** read-only access to the Cloudflare usage dashboard numbers (Claude reads them through the API with
the existing token). OK on the recommendation.
**Order:** after M16 (owner, 2026-11-27), so it uses measured numbers, not estimates.
**Build:** `docs/research/COST_AND_PRICING.md`:
- Cost per user per year at 1k, 10k and 100k users, by line item (containers, D1, R2, queues, email, BharatStock,
  domains), from the load tests and staging usage. Update plan §18.
- **AI analysis cost:** Workers AI vs the Claude API vs none, measured on synthetic portfolios (tokens in/out, cost per
  analysis, quality notes), with a recommendation. Plan §21.8 records the decision.
- Pricing options (free tier limits, paid tiers, a family plan) compared with M23's competitor prices. D7 (free at
  launch) stays unless the owner changes it.

**Done when:** the document exists with sources for every price, §18 is updated, and the owner has decided on AI.

## M17: Production launch
**Order:** last, after M21 (owner, 2026-11-26), so everything is built before go-live.
**Read:** plan §7.2, §17 Phase 6 launch checklist, §19.
**Needs from owner** (the most owner work of any milestone):
- Google consent screen brand verification and "In production", plus a production client ID.
- Cloudflare Email Service daily-quota increase approved (Limit Increase Request form).
- Legal review done.
- Production approval in the GitHub environment.

**Build:**
- Create production resources (like M4), set the secrets, run the production migrations.
- Deploy through the manual production job.
- Smoke test: sign-in, QR device link, upload, dashboard, export, delete with a test account.
- Usage alerts on.
- Public pages (M25–M27): the production sitemap is submitted in Search Console, and `robots.txt` allows indexing in
  production only (staging stays `noindex`).

**Done when:** the launch checklist in plan §17 Phase 6 is ticked, and the owner confirms go-live.

## Phase 10: after launch
These ship after go-live (owner, 2026-11-27). The admin panel is last.

## M32: AI portfolio analysis
**Goal:** a plain-language review of the family's portfolio (allocation, overlap, costs, risks, goals).
**Read:** plan §21.8, `docs/research/COST_AND_PRICING.md` (M31).
**Needs from owner:** the model decision from M31. If the owner wants it before launch, it moves before M17 and gets
its own hardening checks (rate limits, CSP, load).
**Build:**
- Data minimisation: the model gets holdings, weights, returns, categories and costs only. Never names, PANs, folios,
  emails or statement text. Prompt and answer aren't logged.
- If the provider is a new processor (anything outside Cloudflare), update the privacy notice and bump
  `consentVersion` (M14), and add the processor to the export/privacy pages.
- ⚠️ VERIFY with the lawyer: SEBI investment-adviser rules for automated suggestions. Wording stays educational, "not
  investment advice", with no buy/sell calls.
- A per-user quota in `quota` (§11) and a cached result per snapshot.

**Done when:** a test proves that no identity field reaches the model request, the quota holds, and the result is
cached per snapshot.

## M33: Admin panel
**Goal:** the owner runs and supports the service without ever seeing anyone's financial data.
**Read:** plan §21.9, §11, §12.
**Needs from owner:** the admin email(s) in the `ADMIN_EMAILS` secret. The list of extra features, decided before the
milestone starts.
**Order:** last, after launch (owner, 2026-11-27).
**Build:**
- `/admin`, only for signed-in users whose email is in `ADMIN_EMAILS` (allowlist only, owner's choice). Everyone else
  gets 404.
- **System health:** queues and DLQ, stuck jobs, engine errors, NAV ingest, the AMC scraper, BharatStock budget, email
  sends.
- **Usage counts:** signups, active users, uploads per day, parse failure rate, retention. Aggregates only.
- **Support actions:** look up a user by email and see counts only (members, statements, last active, quota use), then
  suspend, reset quotas or delete the account (M14's flow).
- **Limits and feature flags:** fair-use limits and feature switches, stored in D1 and read through a cached config.
- Every admin action writes an `audit_event`.

**Done when:** a test proves that no admin endpoint returns a name, PAN, amount, holding or folio; non-admins get 404;
every action is audited.

---

## Order notes
- **Why this order:**
  - Risky unknowns first: the engine in a container (M1), the pool (M2), pdf.js in a Worker (M3).
  - Then the secure foundations (M5–M6), before any user data flows (M7+).
  - Market data (M9) comes before snapshots (M10), because builds need NAVs.
  - M13 (QR device login) comes after the installable app (M15), so it's built against the installed app too.
  - M18–M21 add the AMC scraper and the beyond-mutual-fund features.
  - Then M16 proves everything holds under load, and production launch (M17) is last (owner, 2026-11-26).
  - **M22–M33 (owner's todo, 2026-11-27; order chosen by Claude for ease and dependencies):**
    - M22 (disposable emails) is the smallest, so it goes right after M15.
    - M23 (research) comes before M24 (redesign), because the redesign and the landing copy use its findings.
    - M24 comes right after M15 (owner: M15 first, so its icons and screenshots are redone in M24). It comes before
      M13 and every later milestone, so new screens are built once, in the new design.
    - M25 (landing + SEO) builds the prerendered public pages that M26 (blog) and M27 (`/fire`) reuse. M30 (social)
      follows them, so the posts can link to real pages. All of these come before launch (owner).
    - M29 (gold/silver) reuses M19's manual-asset model. M28 (score) needs M20's stock prices, so it comes after M20.
    - M31 (cost and pricing) needs M16's measured numbers (owner), and decides M32's AI model.
    - M32 (AI) and M33 (admin) come after launch (owner: admin last).
  - Dropped from the todo: a captcha on email sign-in. Turnstile is already there since M5 (invisible unless Cloudflare
    suspects a bot), and the owner is fine with it (2026-11-27).
- **What can move:** M9 can start any time after M7, M13 any time after M5, and M15 any time after M10. M22 and M23
  can start any time. M30 any time after M26. M32 before M17 if the owner decides so in M31. Keep the table order
  unless the owner asks otherwise.
- **Owner inputs, by first milestone that needs them:** M0 branch OK · M4 Cloudflare Paid + token + domain · M5 Google
  clients + Email Sending domain (✅) + test emails · M10 R2 read-only token · M11 BharatStock OK · M14 legal details ·
  M19/M21 OK on their plan sections (M21 also the brokers) · M24 OK on the design direction and the final look · M25 OK
  on the landing copy and the SEO skill install, Search Console verified before M17 · M26 OK per blog post · M27/M28/M29
  OK on their plan sections · M30 the owner creates the accounts and posts · M16 load-test OK · M31 AI decision · M17
  Google production, email quota increase, go-live approval (legal review deferred ~6 months after launch, owner
  2026-11-26) · M33 `ADMIN_EMAILS` and the extra admin features.
