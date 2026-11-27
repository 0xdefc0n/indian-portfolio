# PocketFolio: multi-user launch plan (Cloudflare)

Status: ready to implement · Written 2026-11-24 · Revised 2026-11-25 after the capacity and cost review (§3.3–§3.6) ·
Branch base: `ui-bento-redesign`

This document turns the current single-household, runs-on-my-laptop app into a public multi-user app on Cloudflare.
The product is named **PocketFolio** (UI and text: "PocketFolio", one word with a capital F; domains, code and resource names: `pocketfolio`).
It is written so Claude Code (or any engineer) can implement it phase by phase. Every decision below is either
**decided by the owner** (marked 🔒) or **decided from tests/research** (marked 🧪 with the evidence). Items that must
be verified during implementation are marked ⚠️ VERIFY, with what to check and the fallback.

---

## 0. Rules for whoever implements this

1. **Privacy first, always.** Never print, log, or commit statement contents, PANs, names, emails, folio numbers,
   amounts or holdings. Logs carry only opaque IDs (`user_id`, `household_id`, `statement_id`), counts, durations and
   error class names. This already applies in the current code (see `README.md` → Privacy) and continues.
   When testing with real PDFs, print counts and ok/fail only.
2. **Keep the UI consistent with the current design.** The bento overview, dark-first theme, and mobile layout from
   commit `089634a` are the design system **until M24**, which replaces it with the premium design system v2 (D21,
   §21.1). From then on, v2 is the system everything reuses. Every new screen (login, onboarding, members, settings, link device,
   legal pages, "coming soon" states) must reuse it. See §13.
3. **Work phase by phase (§17).** Finish each phase's acceptance criteria before starting the next. Commit per phase.
4. **Tenant isolation is non-negotiable.** Every read and write of user data goes through one helper that takes the
   authenticated `household_id`. No query may take a household or member ID from the client without checking that it
   belongs to the session's household (§9.1).
5. **PDFs are never kept.** 🔒 (revised, D6) A PDF is parsed in memory straight away when an engine slot is free.
   Only when the engine is busy is it parked **encrypted** in R2 under `tmp/` until its turn comes. **It is parked only
   after the Worker has verified everything the user could fix** (password, statement type, PAN, duplicate, quotas;
   §10.1 A). Nothing about a parked job ever needs the user again. It is deleted as soon as
   it has been parsed, and **never kept longer than 24 h** (an R2 lifecycle rule backs this up). PDFs never go into D1:
   D1 Time Travel would keep "deleted" rows for 30 days.
6. When a ⚠️ VERIFY item fails, use the stated fallback and leave a note in the PR. Don't silently pick something else.
7. **Design for the burst, not the average.** Every pipeline that calls the engine, D1 or email must stay correct when
   10,000 users act at once (§3.5): admission control instead of timeouts, queues with concurrency caps, and no per-request
   fan-out to D1.

---

## 1. Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | Account model 🔒 | **One login owns one household with many members (PANs).** No sharing between logins at launch. | Matches today's family view. |
| D2 | Extra devices 🔒 | **WhatsApp-Web-style QR login.** The new device shows a QR code; a logged-in device scans and approves it. The new device then shares that account (same user, same household): no new account, no email to type. Linking shows an in-app notice, not an email (owner, 2026-11-26). | Owner request. Built on Better Auth's Device Authorization plugin (RFC 8628), §7.4. |
| D3 | Sign-in methods 🔒 | **Google + email magic link.** Phone OTP and Apple are later. | Owner request. |
| D4 | Auth provider 🧪 | **Better Auth** (open source, runs inside our Worker, users stored in our D1). | No MAU fees at any scale. First-class D1 support since v1.5, an official Cloudflare guide, a real magic-link plugin, and a Device Authorization plugin for D2. Hosted options at 100k MAU cost ≈$275 (Firebase), ≈$1,025 (Clerk) or $3,500+ (Auth0) a month. WorkOS (free to 1M MAU) sends 6-digit codes, not magic links. Firebase's free plan sends only 5 email-link emails a day. |
| D5 | Magic-link email 🔒 | **Cloudflare Email Service** (Email Sending, beta) through the Worker's `send_email` binding, behind an `EmailSender` interface. Workers Paid includes 3,000 emails a month, then $0.35 per 1,000, to any recipient. Sends go through the `email` queue (§7.3). **Before public launch, request a higher daily quota.** Resend stays the fallback implementation if the beta or its quotas get in the way. | Owner decision (2026-11-25), replacing Resend. It is cheaper than Resend Pro ($20/month), adds no extra vendor or API key, and SPF/DKIM/DMARC are managed in the same Cloudflare zone. The risk is the beta: new accounts get an unpublished daily quota and no batch endpoint. Google is the primary sign-in and sends no email, and the interface makes switching back a one-file change. |
| D6 | Keep PDFs? 🔒 (revised 2026-11-25) | **Delete after parsing.** Only the parsed data is kept, encrypted. A PDF is parsed straight away from memory when an engine slot is free (the normal case). During a burst it is stored **encrypted in R2 `tmp/`** and queued (§10.1), then deleted right after parsing. **Before storing, the Worker verifies the password, statement type and PAN** with pdf.js, so a queued job needs nothing more from the user (owner decision 2026-11-25: they may have closed the tab). It is never kept longer than 24 h. | Least risk under DPDP, while uploads survive bursts, a closed tab and engine crashes instead of timing out. If the parser improves, users re-upload. |
| D7 | Pricing 🔒 | **Free with fair-use limits** (§11). No billing at launch. | |
| D8 | CDSL OTP fetch (CASParser API) 🔒 | **"Coming soon".** UI shown disabled with a badge; backend route not deployed. | Owner: upload plus our own parser only, for now. |
| D9 | KFintech statement request 🔒 | **Guided manual only.** Keep the helper that generates a compliant PDF password and links to KFintech's own form. Automatic sending via RapidAPI is **"Coming soon"**. | The RapidAPI free plan (25/month) is shared by all users. |
| D10 | Stocks inside funds 🔒 | **Our own scraper of AMC monthly portfolio disclosures is primary; BharatStock is the fallback** when a scrape fails or an AMC isn't covered yet. | Owner request. §10.3. |
| D11 | Backend shape 🧪 | **TypeScript Worker (Hono)** for HTTP, auth, DB, crypto, cron and queues, plus **one Python container image ("engine")** for PDF parsing and portfolio analysis. It's deployed as two container classes, `EngineFast` and `EngineBatch` (D16). No Python Worker. | See §3: the parsers won't fit a Python Worker's 128 MB memory or bundle limits. |
| D12 | Frontend hosting 🧪 | **Workers Static Assets** (the same Worker serves `web/dist`), not Pages. | Cloudflare now recommends Workers for new projects. One origin, so first-party cookies and no CORS. |
| D13 | Data location 🧪 | Cloudflare has **no India jurisdiction** for D1, R2 or Containers. Use the `apac` location hint for D1 and R2. For containers, `constraints.regions: ["APAC"]` exists only on the **deprecated** `default` scheduling policy. The new `durable_object` policy places each instance by its Durable Object's location (§15.1, ⚠️ VERIFY). DPDP allows cross-border transfer unless the government blacklists a country (none notified), so this is acceptable. | §12. |
| D14 | Installable web app 🔒🧪 | **PWA** (manifest + service worker) with **our own install prompt**, shown only after the user has seen value (§13A). Chromium uses `beforeinstallprompt`; iOS/macOS Safari get step-by-step "Add to Home Screen / Dock" instructions. | Owner request. The standard practice is to ask after engagement and never on arrival. iOS has no install API. |
| D15 | NAV data and daily returns 🔒🧪 | **Our own NAV store in D1**, filled from **AMFI's official daily file** several times a night, backfilled per scheme from mfapi with AMFI's history report as fallback. Daily returns are computed in the Worker from NAVs and the units timeline in the snapshot (§10.4, §10.5). | Owner request. AMFI is the official source and is free; one fetch covers every scheme. Tested 2026-11-24. |
| D16 | Engine capacity 🧪 | **An `EnginePool` Durable Object leases parse/build slots** (1 slot = 1 Python process = 1 job at a time). It **fills the first instance before starting the next** and grows up to configured caps in a burst (start with 60 + 60). Uploads and rebuilds use separate container classes, so nightly rebuilds never delay an upload. Uploads use a **two-path** design: straight to the engine when a slot is free, otherwise encrypted into R2 `tmp/` plus the `parse` queue, with a live time estimate (§10.1). There are **two container classes**: `EngineFast` (`standard-2`) for uploads and `EngineBatch` (`basic`) for rebuilds. | The original 3 × `basic` pool would take ~8 h to clear a 10k-user burst, and ~97% of uploads would time out (§3.5). Instances that are asleep cost nothing, so a large pool is free until it's used. |
| D17 | Two D1 databases 🧪 | **`pocketfolio-app`** (auth, households, statements metadata, quotas, jobs) and **`pocketfolio-market`** (scheme, nav, market_day, backfill, fund portfolios). | Each D1 database runs one query at a time (§3.4). The nightly NAV writes and the heavy daily-returns reads must not slow sign-in and uploads. It also gives each its own 10 GB cap and its own Time Travel restore, and lets the market DB use read replicas. |
| D18 | Compress, then encrypt 🧪 | Every user blob in R2 (statements, snapshots, cached daily series) is **gzip-compressed before encryption**. Parked PDFs are already compressed, so they are only encrypted. | Measured 12× smaller for statements and 6× for snapshots (§3.3). Compressing after encryption does nothing. |
| D19 | No PAN input on upload 🔒🧪 (owner, 2026-11-25) | **Uploading asks only for the PDF and its password, if it has one.** No PAN field and no member picker. The Worker tries the household's known passwords first (each member's PAN, pending KFintech passwords), so most uploads need no typing at all. It reads the holder's PAN from the statement and files it under the matching member, or creates a new one. A PAN is typed only where it's really needed: the KFintech request helper for someone not yet in the household (D9), because KFintech's form asks for it. | Less to type and fewer mistakes (no "wrong member" uploads), and we collect only what's needed (DPDP data minimisation). Tested: the labelled PAN on pages 1–3 was the holder's in 4 of 4 statements, and the parsed PAN confirms it (§10.1 A5). |
| D20 | Disposable emails 🔒 (owner, 2026-11-27) | **New accounts can't use a disposable address.** A bundled open-source domain list is checked at email sign-in; existing users still sign in; Google isn't checked (§21.7, M22). | Less abuse of the free tier and the email quota. Turnstile is already on the form (M5) and stays as it is. |
| D21 | Premium design refresh 🔒 (owner, 2026-11-27) | **Design system v2**, with a gold accent and a glass-like premium feel, replaces the `089634a` system everywhere, including a redesigned dashboard and a new two-part wordmark ("Pocket" plain, "folio" on a gold glass block) (§21.1, M24). | Owner: the current look reads as "vibe coded". One system for the app and the public pages. |
| D22 | Public growth pages before launch 🔒 (owner, 2026-11-27) | **Competitor research, a landing page, SEO, a blog, a public FIRE calculator and a social playbook all ship before launch** (M23–M27, M30). Public pages are prerendered HTML (§21.2). | Search and AI-search indexing takes weeks, so the pages should be live on day one, and M16 hardens them too. |
| D23 | Benchmark score 🔒 (owner, 2026-11-27) | **0–100 score per fund and stock against its category's index**, from rolling 1/3/5-year returns and consistency, with a plain-language line (§21.4, M28). | Owner request. A single number is easy to scan; the line explains it. |
| D24 | Gold and silver 🔒 (owner, 2026-11-27) | **Physical gold/silver (grams, purity) and Sovereign Gold Bonds**, entered by hand and valued at a daily per-gram rate. Not digital gold. Gold ETFs and funds already come in through statements (§21.5, M29). | Owner choice. |
| D25 | Corporate actions 🔒 (owner, 2026-11-27) | **Hybrid:** splits and bonuses after the statement date are applied automatically; mergers, demergers and MF scheme mergers ask for a newer statement (§21.6, M21). | Splits and bonuses are mechanical and common. Mergers have many edge cases, and a new statement has the right answer. |
| D26 | AI portfolio analysis 🔒 (owner, 2026-11-27) | **The model is decided after the cost study (M31).** It ships after launch (M32), with identities never sent to the model (§21.8). | Owner: decide from the cost per user. |
| D27 | Admin panel 🔒 (owner, 2026-11-27) | **Email allowlist only** (`ADMIN_EMAILS`). Health, aggregate usage, support actions with counts only, limits and feature flags. **No financial data, ever.** Built last, after launch (§21.9, M33). | Owner choice. |
| D28 | Manual assets 🔒 (owner, 2026-11-27) | **FD, PPF and EPF entered by hand with the fewest fields the maths needs** (no bank name, label or PAN), owned by the household with an existing member picked. Only the inputs are stored, sealed; the value is computed live by one shared calculator. A separate `GET /api/assets`; two XIRRs: Funds & stocks (default) and Overall (§21.12, M19). | Owner: easy to manage, no breaking change to members, and it never feels like we're collecting private data. |

---

## 2. Current state and gaps (summary)

| Area | Today | Problem for multi-user |
|---|---|---|
| Data scope | `build_portfolio(PARSED_DIR)` reads **every** JSON in `data/parsed/` (`app/portfolio.py`) | Every user would see everyone's data |
| Storage | PDFs and JSON on the local disk, named `{PAN}_{MONYYYY}_{TYPE}` | No filesystem on Workers; no owner; collisions between users |
| State | `SESSIONS` dict (`app/main.py`), stock-refresh thread with a module lock (`app/stocks.py`) | Breaks with more than one instance; threads don't exist on Workers |
| Secrets in files | KFintech pending passwords in `data/.statement-requests.json`, keyed by PAN | Must be per household, encrypted, in a DB |
| Member IDs | `m0, m1…` by value rank (`app/portfolio.py`) | Not stable; must be DB IDs |
| Caches | `data/.nav-cache`, `data/.stock-cache` | Public market data: fine to share, but must move to R2 or D1 |
| External quotas | CASParser, RapidAPI, BharatStock keys shared | Fixed by D8, D9 and D10 |
| Auth | none | §7 |
| Compliance | "everything stays on this machine" | Now a data fiduciary under DPDP (§12) |

**What carries over unchanged:**
- **Parsers and analysis.** `app/parsers/*`, `app/analysis.py`, most of `app/portfolio.py`, `app/market.py` maths, and the matching logic in `app/stocks.py`.
- **The whole React dashboard.** It only calls relative `/api/*` and stores nothing in `localStorage`.

---

## 3. Test results and research (D11, D16–D18)

### 3.1 Can the Python parser run in a Python Worker (Pyodide)? Tested 🧪

Test setup:
- **Runtime:** Pyodide 314.0.8 under Node (Python 3.14.2), the same runtime family as Cloudflare Python Workers.
- **Input:** one real CDSL eCAS (11 pages). Only counts were printed.
- **Scripts:** in the session scratchpad; not committed.

| Check | Result |
|---|---|
| `cryptography`, `pydantic`, `sqlite3`, `pypdfium2` import | ✅ All available as Pyodide builds |
| `pip install pdfplumber` | ❌ Pins `pillow>=13`; Pyodide ships Pillow 12.2 |
| `pip install casparser` | ❌ Needs `rapidfuzz`, which is native and has no Pyodide build. Used only by `casparser_isin` (`fuzz.token_sort_ratio`) |
| Our CDSL parser (pure-Python packages copied in) | ✅ Parsed correctly (8 holdings). **2.0 s in Pyodide vs 0.9 s native** |
| WASM heap after one parse | **108 MB.** That includes the 48 MB `casparser_isin/isin.db` sitting in the in-memory filesystem |
| `casparser` (CAMS/KFintech path) | Imports. Runs only with a `rapidfuzz` shim. Not tested end to end: the local KFintech PDFs use one-time passwords that were already deleted |

Platform limits (Cloudflare docs, 2026-11):
- **Memory:** a Worker has 128 MB per isolate, and WebAssembly memory counts toward it.
- **Bundle size:** about 64 MiB.
- **CPU:** the paid plan allows 30 s per request by default, up to 5 min.

**Conclusion:** a Python Worker is too risky.
- The heap is already near 128 MB on a small statement. A 10-year CAMS detailed statement will be larger.
- `isin.db` alone takes most of the bundle.
- Two dependencies need patching.

→ The Python code goes in a **Container**. GA since 2026-04-13 on Workers Paid; it runs real CPython, so the existing code runs as is.

Container facts used here (Cloudflare docs):
- **Instance types (vCPU / memory / disk):** lite 1/16 / 256 MiB / 2 GB, basic 1/4 / 1 GiB / 4 GB, standard-1 1/2 / 4 GiB / 8 GB,
  standard-2 1 / 6 GiB / 12 GB, standard-3 2 / 8 GiB / 16 GB, standard-4 4 / 12 GiB / 20 GB.
- **Billing:** per 10 ms while running. **CPU is billed on active use only. Memory and disk are billed on the
  provisioned size for as long as the instance is awake, busy or idle.** Included each month on Workers Paid: 375 vCPU-minutes,
  25 GiB-hours of memory and 200 GB-hours of disk. See §3.6 for prices.
- **Cold start:** 1–3 s.
- **Scaling:** scale-to-zero after an inactivity timeout (`setInactivityTimeout()`). **No autoscaling.** The `default`
  scheduling policy (with `max_instances`) is **deprecated**. The `durable_object` policy has no `max_instances`: we start
  one instance per named Durable Object, so the pool size is how many names we use (§14, D16).
- **Account limits:** 15,000 concurrent vCPU, 60 TiB memory, 50 GB of total image storage. No instance-count limit is published.
- **How it's reached:** through a Durable Object binding from the Worker. It has no public URL.

### 3.2 In-memory parsing 🧪
- `casparser.read_cas_pdf` accepts a file-like object, and `pdfplumber.open` accepts `BytesIO`.
- Only `parse_cdsl_cas` fails, because of `Statement(source=path.name)` (`app/parsers/cdsl.py:207`).
- **Fix:** accept `str | Path | BinaryIO` and use `source=getattr(path, "name", "upload.pdf")`. Then the engine never writes a PDF to disk.

### 3.3 Engine cost measured locally (2026-11-25) 🧪
Native CPython on the owner's laptop (Apple Silicon). Only timings, sizes and ok/fail were printed.

| Measurement | Result |
|---|---|
| Python + parsers + `isin.db` loaded | 69 MB RSS (21 MB bare Python) |
| `isin.db` | 49 MB (in the image, opened read-only) |
| Parse a CDSL eCAS (11 pages, 349 KB) | **0.83 s CPU**, peak RSS **145 MB** |
| `build_portfolio` for one household (4 statements) | 0.23 s CPU, peak RSS 156 MB |
| Statement JSON | 0.2–97 KB each. **142 KB → 11 KB gzipped (12×)** |
| Snapshot JSON | **170 KB → 28 KB gzipped (6×)** |
| KFintech CAS parse (3 statements: 2, 4 and 10 pages; 109–178 KB) | **0.13 / 0.31 / 0.46 s CPU**, peak RSS **86–104 MB**, JSON 5–76 KB (≤ 5 KB gzipped) |
| A large multi-year *detailed* CAMS statement | ⚠️ Not measured yet (none available). Assume ~0.05 s CPU per page until then. The KFintech statements above are detailed: up to 314 transactions in 10 pages |
| **M1, engine `/parse` in the container** (2026-11-25; linux/amd64 emulated on an Apple Silicon Mac, so CPU is ~1.7–2.1× native) | KFintech 388 / 681 / 1,032 ms, CDSL 1,797 ms; peak RSS **105–166 MB** for the whole process. Image 386 MB. Read-only root filesystem, `/tmp` empty after every parse. Native, the same code takes 228 / 316 / 456 / 849 ms and 80–147 MB. ⚠️ Re-measure on Cloudflare in M4 |

**Worker pre-check (pdf.js 6.5 in Node, the same engine a Worker would run; §10.1 A):** open the PDF with the candidate
passwords, read the text of pages 1–2, detect the statement type, and look for the member's PAN.

| PDF | Result | CPU |
|---|---|---|
| KFintech, 2 pages | right password found after 1 wrong try; type RTA; PAN found | 160 ms (includes JIT warm-up) |
| KFintech, 4 pages | same | 90 ms |
| KFintech, 10 pages | same | 80 ms |
| CDSL, 11 pages | first candidate (PAN) worked; type CDSL; PAN found | 130 ms |

- Heap growth per check was 2–12 MB. pdf.js is ~3.4 MB of JavaScript (main + worker module).
- The Python equivalent (pdfplumber) took 90–170 ms and agreed on every result.
- **Holder PAN from the text:** the PAN printed after a "PAN" label on pages 1–3 was the holder's in 4 of 4 statements.
  KFintech statements also contain a trust's PAN (4th letter `T`), which the individual-PAN rule (4th letter `P`) skips (D19).
- Every check that needs the user can therefore run in the Worker in **well under 1 s of CPU** (30 s allowed), before
  any PDF is stored.

**M3, the real pre-check (`worker/src/lib/pdfcheck.ts`) inside workerd** (2026-11-25, `wrangler dev` 4.168 running the
wrangler bundle on the owner's Apple Silicon laptop; `node worker/scripts/measure-pdfcheck.ts`). Candidates in the same
order as the engine (file-name PAN, then the test password). Time is wall time inside the Worker, which equals CPU here
(the check does no I/O, and local workerd's clock advances during CPU work). Memory: the isolate's V8 heap plus
ArrayBuffers via the inspector, after the check and before GC, and the peak RSS of the workerd processes above idle.

| PDF | Result | Time (median of 5; first) | Isolate heap + buffers | Peak RSS above idle |
|---|---|---|---|---|
| KFintech, 2 pages, 0.1 MB | ok, password 2nd candidate (1 wrong try), RTA, PAN found | 22 ms (38) | +3.5 MB | 22 MB |
| KFintech, 4 pages, 0.1 MB | same | 32 ms (33) | +0.8 MB | 29 MB |
| KFintech, 10 pages, 0.2 MB | same | 33 ms (32) | +0.0 MB | 30 MB |
| CDSL, 11 pages, 0.3 MB | ok, 1st candidate (PAN), CDSL, PAN found | 37 ms (40) | +1.0 MB | 26 MB |
| Synthetic, 300 pages, 12 MB, RC4-128 | ok, 2nd candidate | 24 ms | +23 MB | 68 MB |
| Same file, 2 wrong passwords | `password_required` | 4 ms | +13 MB | 68 MB |

- Loading pdf.js (first check in an isolate) takes **40–53 ms**. The V8 heap goes from 5.0 to 7.2 MB after GC.
- The bundle with pdf.js is **3.4 MB, 685 KB gzipped** (`wrangler deploy --dry-run`). esbuild puts the dynamic
  `import()` in the same file but runs pdf.js's module code only on first use.
- Time doesn't grow with file size or page count: only pages 1–3 are read. Most of the 12 MB file's memory is the
  bytes themselves, held twice: the request body, and the copy handed to pdf.js (which may detach its input).
  The peak stays **well under the 128 MB isolate limit**, but the Worker should not hold more than one upload in memory.
- Agreement: the pre-check and the Python engine agree on type, password index and PAN on **4 of 4** private PDFs
  (`worker/test/pdfcheck.private.test.ts`, booleans only), and a wrong first candidate is skipped on each.
- ⚠️ Re-measure CPU on Cloudflare in M4 (Workers logs report `cpuTime`; assume ~1.5× the laptop numbers until then).

Planning numbers for the cloud: Cloudflare cores are assumed ~1.5× slower than the laptop. So a CDSL parse is about
**1.2 vCPU-s**, a KFintech/CAMS parse about **0.2–0.7 vCPU-s** (measured, short statements), and a build about
**0.5 vCPU-s**. Use **~0.8 vCPU-s** as the average parse. On a `basic` instance (1/4 vCPU) a CDSL parse takes ~5 s of
wall time and a 10-page KFintech ~3 s. On `standard-2` (1 vCPU) they take ~1.2 s and ~0.7 s. Peak RSS stayed **under
150 MB** for every statement measured, far below `basic`'s 1 GiB.
Stored data per household is **about 0.3 MB raw, about 40 KB compressed**. The earlier 0.5–2 MB estimate was too high.

### 3.4 Cloudflare limits that shape the design (docs read 2026-11-25) 🧪

| Limit | Free | Paid ($5/mo) | What it means here |
|---|---|---|---|
| Worker CPU per request | **10 ms** | 30 s default, 5 min max | Free can't run auth, crypto or NAV ingest |
| Worker requests | 100k/day | 10M/month, then $0.30/M | Fine |
| Worker CPU billing | – | 30M CPU-ms/month, then $0.02/M | Fine (~8 ms per request) |
| Worker memory | 128 MB | 128 MB | Don't `JSON.parse` snapshots; stream decrypted bytes (§10.2) |
| Subrequests / simultaneous connections | 50 / 6 | 10,000 / 6 | Fine |
| Request body (Cloudflare Free zone) | 100 MB | 100 MB | 10 MB upload cap is fine |
| Cron triggers | **5** | 1,000 | We use 8 |
| Cron / queue consumer wall time | 15 min | 15 min | Split long jobs through queues |
| D1 database size | 500 MB | **10 GB, can't be raised** | Two DBs (D17) |
| D1 queries per invocation | 50 | 1,000 (`batch()` counts as 1) | Batch writes |
| D1 throughput | **One query at a time per DB.** ~1,000 QPS at 1 ms per query, ~10 QPS at 100 ms. "Overloaded" errors when the queue is full | same | **The real bottleneck under a burst** |
| D1 rows read / written | 5M / 100k a day | 25B / 50M a month, then $0.001 / $1.00 per M | Fine with caching |
| D1 row / statement / bound params | 2 MB / 100 KB / 100 | same | 30-row inserts, PDFs never in D1 |
| D1 Time Travel | 7 days | 30 days | "Deleted" rows survive 30 days → no PDFs in D1 |
| D1 read replicas | – | No extra cost. Needs the Sessions API (`env.DB.withSession()`). APAC replica exists | Use on `pocketfolio-market` |
| R2 | 10 GB, 1M Class A, 10M Class B per month free | $0.015/GB-month, $4.50/M Class A (PUT/LIST), $0.36/M Class B (GET/HEAD), DELETE free, no egress fees | Fine |
| R2 same-key writes | **1 per second** (429 above) | same | Versioned snapshot keys (§10.2) |
| R2 lifecycle | – | Rules by prefix, minimum 1 day | 24 h safety net on `tmp/` |
| Queues | 10k ops/day, 24 h retention | 1M ops/month, then $0.40/M. Retention 4–14 days | ~3 ops per message |
| Queue message | **128 KB** | 128 KB | A PDF can't ride in a message. Send its R2 key |
| Queue consumers | 250 concurrent, batch ≤ 100, 5,000 msg/s per queue | same | `max_concurrency` = engine slots |
| Durable Objects | 100k requests/day (SQLite only) | 1M requests/month, then $0.15/M. ~1,000 req/s soft limit per object | One `EnginePool` object handles a burst |
| Containers | **Not available** | See §3.1 and §3.6 | Needs Workers Paid |
| Rate limiting binding | – | Periods of 10 or 60 s only. Per location, approximate | Abuse control only. Exact quotas stay in D1 |
| KV | 1k writes/day | 1M writes/month. 1 write/s per key, eventually consistent | Not used for tokens or quotas |

### 3.5 What happens when 10,000 users upload at once 🧪
Scenario: 10k households each upload 2 statements within ~10 minutes, so 20k parses and 10k builds. Using §3.3,
that's **~21,000 vCPU-s** of engine work (20k × ~0.8 + 10k × ~0.5, §3.3).

**With the plan as first drafted (3 × `basic` = 0.75 vCPU, random routing, synchronous 60 s parse):**
1. **Engine.** It would take **~8 h** to clear the backlog. Each parse takes ~3–5 s of wall time on ¼ vCPU, and requests
   pile up behind random routing. Only ~450 parses finish in the first 10 minutes, so with a 60 s timeout **~97% of
   uploads fail**.
2. **Memory.** FastAPI runs sync endpoints in a 40-thread pool. Several parses then share one core under the GIL while
   each holds its own ~90–150 MB (measured; more for long statements), which can run a 1 GiB `basic` instance out of memory.
3. **Email.** Cloudflare Email Service starts new accounts on a "conservative daily quota" (no number published,
   raised on request), publishes no per-second limit, and has no batch endpoint, so it is one call per email.
   10k magic links could exhaust the quota or hit `E_RATE_LIMIT_EXCEEDED`.
4. **D1.** Each API call does a session read, a household read and a consent read before any work. 10k browsers polling
   `/api/portfolio/status` every 2 s add thousands of queries a second, against a DB that runs one query at a time.
   Expect "overloaded" errors.
5. **Rebuild races.** A family uploading 4 PDFs fires 4 rebuilds that can run at the same time. They waste engine time,
   can hit R2's 1-write-per-second limit on `snapshot.bin`, and can let an older snapshot overwrite a newer one.

**The same pile-up happens every night** when the NAV day becomes final and `snapshot-prebuild` enqueues every active
household (§10.3).

**What the burst costs** (no included allowance left, so the worst case):

| Item | Cost |
|---|---|
| Container CPU: 21k vCPU-s × $0.000020 | $0.42 |
| Container memory: ~84k GiB-s at 4 GiB per vCPU × $0.0000025 | $0.21 |
| Container disk | ~$0.02 |
| Workers, Durable Objects, Queues, D1, R2 | within included amounts |
| Worker CPU for the pdf.js pre-check: 20k × ~150 ms = 3M CPU-ms (of 30M included) | ~$0 |
| **Total** | **≈ $0.65 (up to ~$2 with idle tails)** |

**Conclusion:** a burst is cheap. The risk is throughput and correctness, not money. The fixes are D16, D17, §7.1
(fewer D1 reads), §7.3 (email queue + raised quota), §10.1 (two-path upload) and §10.2 (single-flight rebuilds). With them, the
same burst drains in **~10 min**: 21k vCPU-s ÷ 600 s ≈ 35 vCPU, for example 30 `EngineFast` (`standard-2`)
plus 20 `EngineBatch` (`basic`), at the same CPU cost. The starting caps of 60 + 60 leave headroom for longer statements. Pool caps are config values (§15.1), not code.

### 3.6 Steady-state cost model: what actually drives the bill 🧪
- **Prices:** CPU $0.072 per vCPU-hour, only while working. Memory $0.009 per GiB-hour and disk $0.00025 per GB-hour,
  **for every second an instance is awake**.
- **So the bill is driven by how long instances stay awake × their size, not by how much parsing is done.**

| Instance | Awake cost per hour (memory + disk) | GiB per vCPU | CDSL parse (est.) |
|---|---|---|---|
| `basic` | $0.010 | 4 | ~5 s |
| `standard-1` | $0.038 | 8 (worst) | ~2.5 s |
| `standard-2` | $0.057 | 6 | ~1.2 s |
| `standard-3` | $0.076 | 4 | ~1.2 s per process (2 processes) |

Example: one `standard-2` awake 16 h a day costs ~$27 a month. One `basic` awake for the same time costs ~$5.

Rules that follow:
- Uploads (`EngineFast`, `standard-2`): fast for the user, with a **60 s inactivity timeout**. The parse queue hides
  cold starts.
- Rebuilds and scrapes (`EngineBatch`, `basic`): latency doesn't matter. Run them in batches so instances are busy while awake.
- **Fill the first instance first** (D16), so light traffic keeps one instance warm instead of waking many.
- Never keep an instance warm on purpose.

---

## 4. Target architecture

```
                     Browser (React SPA, same origin)
                                │  HTTPS, session cookie
                                ▼
┌──────────────────────── Worker "app" (TypeScript, Hono) ─────────────────────────┐
│  static assets: web/dist (SPA fallback)                                          │
│  /api/auth/*      Better Auth (Google, magic link, device-authorization QR)      │
│  /api/*           app API: households, members, uploads, portfolio, settings     │
│  crypto.ts        envelope encryption (WebCrypto AES-256-GCM)                    │
│  ratelimit        Workers Rate Limiting binding + D1 quota counters              │
│  scheduled()      cron: market data, stock disclosures, snapshot prebuild, cleanup│
│  queue()          consumers: parse, rebuild, market, email (one queue each)      │
└──┬──────────────┬──────────────┬──────────┬───────────────┬──────────────────────┘
   │              │              │          │               │
   ▼              ▼              ▼          ▼               ▼
 D1 ×2           R2           Queues    DO "EnginePool"   DO "EngineFast-{n}" ─► Container standard-2
 app: auth,     h/…  encrypted (parse,   (leases slots,   DO "EngineBatch-{n}" ─► Container basic
  households,     statements,  rebuild,  fill-first,      (Python 3.12, FastAPI:
  statements,     snapshots,   market,   queue position,   POST /parse  POST /build
  jobs, quotas    daily cache  email)    ETA)              POST /stocks/scrape  GET /health)
 market: scheme, tmp/ parked
  nav, days       PDFs (≤24 h)
                market/ NAV series, fund holdings
Outbound (from the Worker or engine): api.mfapi.in (NAVs), amfiindia.com (NAV file),
AMC websites (disclosures), BharatStock (fallback), Google OAuth.
Cloudflare Email Service (`send_email` binding) for outbound email.
```

**Request paths**
- **Page load:** `GET /api/portfolio`. The Worker checks the session from the signed cookie cache (no D1 read, §7.1),
  reads the household's **snapshot** from R2, decrypts and decompresses it, and streams it back without parsing the JSON.
  No container call, so it's fast.
- **Upload (two paths, §10.1):**
  1. `POST /api/statements`. The Worker runs every check the user could fix: rate limit, size, `%PDF`, duplicate hash,
     PAN format, member, quota, and a **pdf.js pre-check** of the password, statement type and PAN (§10.1 A5). Any failure
     is answered straight away and nothing is stored.
  2. **Direct path (normal traffic):** it asks `EnginePool` for an `EngineFast` slot. If one is free, it sends the PDF
     bytes and candidate passwords to `/parse` and stores the encrypted JSON. The PDF is never stored. It returns
     `201` with the statement.
  3. **Queued path (engine busy):** it encrypts the PDF into R2 `tmp/`, writes a `parse_job` row, sends a `parse`
     message holding only the job ID, and returns `202 { job: { id, position, eta_s } }`. The PDF is deleted as soon as
     the job ends.
  4. Either way it enqueues a debounced `rebuild` (10 s delay) for the household.
  5. The SPA shows progress and polls `GET /api/jobs/:id` or `GET /api/portfolio/status` **with backoff**
     (1 s → 2 s → 4 s → 8 s → 10 s cap), honouring `Retry-After`. The user may close the tab; the job finishes anyway.
- **Daily:**
  1. Cron refreshes NAVs into the market D1 and the R2 series.
  2. Stale snapshots are rebuilt for households active in the last 7 days. They go through the `rebuild` queue,
     capped by `EngineBatch` slots, so the nightly burst is drained at a steady rate instead of all at once.
  3. Others rebuild lazily on their next visit: the stale snapshot is returned at once with `stale: true`, a rebuild is enqueued, and the UI shows "Updating to today's NAV…".

---

## 5. Repository layout (target)

```
/web                      existing React SPA (unchanged toolchain)
  src/pages/              NEW: login, link-device, onboarding, settings, legal
  src/lib/auth-client.ts  NEW: Better Auth client
/worker                   NEW: TypeScript Worker
  wrangler.jsonc
  src/index.ts            Hono app, routes mount, scheduled(), queue()
  src/auth.ts             Better Auth factory (per request, because D1 is a binding)
  src/routes/*.ts         households, members, statements, portfolio, settings, account
  src/lib/crypto.ts       envelope encryption
  src/lib/tenant.ts       requireHousehold(), assertMember()
  src/lib/email.ts        EmailSender interface + Cloudflare Email Service impl (send_email binding)
  src/lib/quota.ts        fair-use counters
  src/lib/blob.ts         compress-then-encrypt helpers (seal/open with gzip, D18)
  src/lib/pdfcheck.ts     pdf.js pre-check: password, statement type, PAN, page count (§10.1 A5)
  src/engine.ts           EngineFast / EngineBatch: Container-backed Durable Object classes
  src/engine-pool.ts      EnginePool Durable Object: slot leases, fill-first routing, queue position, ETA (§14)
  src/jobs/*.ts           parse, rebuild, market-data, stocks, email, cleanup
  migrations/app/0001_auth.sql …     → D1 pocketfolio-app
  migrations/market/0001_market.sql … → D1 pocketfolio-market
  test/                   vitest + @cloudflare/vitest-plugin (renamed from vitest-pool-workers)
/engine                   NEW: Python container
  Dockerfile
  pyproject.toml          (from requirements.txt + openpyxl, python-calamine)
  engine/server.py        FastAPI: /parse /build /stocks/scrape /health
  engine/parsers/         ← moved from app/parsers (with the BytesIO fix)
  engine/portfolio.py     ← refactored app/portfolio.py (pure functions, no disk)
  engine/analysis.py      ← app/analysis.py (unchanged)
  engine/market.py        ← app/market.py (reads NAVs from the request payload / R2)
  engine/stocks/          matching (from app/stocks.py) + scrapers/amc/*.py
  tests/
/app, parse.py, static/   REMOVE after the move (parse.py → engine/cli.py, kept as a dev tool)
/docs                     this plan
```

---

## 6. Data model (D1)

There are **two D1 databases** (D17), bound as `DB` (`pocketfolio-app`) and `MARKET` (`pocketfolio-market`).
Nothing joins across them. The upload handler writes to both: user rows to `DB`, public scheme IDs to `MARKET`.

The Better Auth tables (`user`, `session`, `account`, `verification`; `deviceCode` arrives with M13) come from
`npx auth generate` (✅ M5: the CLI package is now `auth`, 1.7.28; `@better-auth/cli` is stuck at 1.4. It runs on
`worker/scripts/auth-schema.config.ts`, which diffs against an empty in-memory SQLite) and are committed as
`migrations/app/0001_auth.sql`. **M5 also needed `household` and `snapshot` at signup**, so those two tables (plus a
small `rate_limit` table, §7.1) are in `migrations/app/0002_household.sql`. The other app tables below go in
`migrations/app/0003_app.sql` (M6):

```sql
CREATE TABLE household (
  id            TEXT PRIMARY KEY,                -- uuid
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  dek_wrapped   BLOB NOT NULL,                   -- per-household data key, wrapped by the KEK (§8)
  kek_version   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL                -- drives prebuild + DPDP inactivity handling
);

CREATE TABLE member (
  id            TEXT PRIMARY KEY,                -- uuid; replaces m0/m1
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  pan_hmac      TEXT NOT NULL,                   -- HMAC-SHA256(PAN_PEPPER, PAN): lookups/dedupe, never reversible
  pan_enc       BLOB NOT NULL,                   -- encrypted PAN (default PDF password)
  pan_masked    TEXT NOT NULL,                   -- "AB••••••4F" for display
  display_name_enc BLOB,                         -- holder name from the statement (encrypted)
  created_at    INTEGER NOT NULL,
  UNIQUE (household_id, pan_hmac)
);
-- A PAN may exist in many households (two family members each with their own login). That's allowed.

CREATE TABLE statement (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('CDSL','CAMS','KFINTECH')),
  as_of         TEXT NOT NULL,                   -- YYYY-MM-DD (valuation/period end)
  period_from   TEXT,
  blob_key      TEXT NOT NULL,                   -- R2: h/{household_id}/statements/{id}.bin (encrypted JSON)
  content_hash  TEXT NOT NULL,                   -- HMAC of the PDF bytes: reject exact duplicate uploads
  parser_version TEXT NOT NULL,                  -- engine version that produced it
  holdings_count INTEGER NOT NULL,
  warnings_count INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (household_id, content_hash)
);
CREATE INDEX statement_member ON statement(member_id, kind, as_of);

CREATE TABLE snapshot (                          -- one current built portfolio per household
  household_id  TEXT PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  blob_key      TEXT,                            -- R2: h/{household_id}/snapshot/{inputs_hash}.bin (gzip+encrypted); NULL until first build
  inputs_hash   TEXT,                            -- hash of statement ids + market_date + engine version of blob_key
  market_date   TEXT,                            -- NAV date it was built with
  status        TEXT NOT NULL CHECK (status IN ('ready','building','failed')),
  building_hash TEXT,                            -- inputs_hash of the build in flight (single-flight, §10.2)
  building_until INTEGER,                        -- lease expiry; a crashed build is retried after this
  built_at      INTEGER
);
-- A new snapshot is written under a new key, then this row is switched with
-- UPDATE … SET blob_key=?, inputs_hash=? WHERE household_id=? AND building_hash=?  (compare-and-set).
-- The old blob is deleted afterwards. No same-key R2 writes, and an older build can never overwrite a newer one.

CREATE TABLE parse_job (                         -- queued uploads (§10.1 queued path); short-lived
  id            TEXT PRIMARY KEY,                -- uuid
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id     TEXT REFERENCES member(id) ON DELETE CASCADE,  -- set when the pre-check matched an existing member
  pan_hmac      TEXT,                            -- holder PAN found by the pre-check (new member); NULL if not identified (D19)
  blob_key      TEXT,                            -- R2: tmp/{household_id}/{id}.bin (encrypted PDF); NULL once deleted
  content_hash  TEXT NOT NULL,                   -- duplicate check also covers queued jobs
  kind          TEXT NOT NULL CHECK (kind IN ('CDSL','RTA')),  -- detected by the Worker pre-check (§10.1 A5)
  password_source TEXT NOT NULL CHECK (password_source IN ('typed','pan','kfintech_pending')), -- the candidate that opened it
  password_enc  BLOB,                            -- the VERIFIED password, only when typed; encrypted; deleted with the PDF
  status        TEXT NOT NULL CHECK (status IN ('queued','parsing','done','failed','expired')),
  -- No "needs_password" state: wrong passwords and unknown types are rejected before a job exists.
  error_code    TEXT,                            -- parse_error | multi_pan | member_limit | precheck_disagree | parse_timeout | password_unavailable
  attempts      INTEGER NOT NULL DEFAULT 0,
  seq           INTEGER NOT NULL,                -- position ticket from EnginePool (ETA = rank among queued seqs)
  statement_id  TEXT,                            -- set when done
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,                -- created_at + 24 h; cleanup deletes the PDF and marks 'expired'
  UNIQUE (household_id, content_hash)
);
CREATE INDEX parse_job_status ON parse_job(status, expires_at);
-- Finished rows ('done','failed','expired') are deleted by `cleanup` after 7 days. They hold no PDF and no password.
-- Re-uploading the same file after a 'failed' or 'expired' job deletes that old row first, so the UNIQUE doesn't block a retry.
-- ✅ M8: rebuilt in migrations/app/0004_parse_job.sql (SQLite can't alter a CHECK): password_source also allows 'none'
-- (an unencrypted PDF), plus user_id (the uploader, for the audit row), pending_pan_hmac (the pending KFintech password
-- used), pdf_bytes (for the parked-PDF recount) and updated_at (lost-message detection). Index on (household_id, created_at).

CREATE TABLE pending_statement_password (        -- KFintech guided request (D9); replaces .statement-requests.json
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  pan_hmac      TEXT NOT NULL,                   -- keyed by PAN, not member: the person may not be a member yet (D19)
  password_enc  BLOB NOT NULL,
  expires_at    INTEGER NOT NULL,                -- 30 days, as today
  PRIMARY KEY (household_id, pan_hmac)
);
-- Upload tries every unexpired pending password of the household (§10.1 A4) and deletes the one that worked.

CREATE TABLE quota (                             -- fair-use counters (§11)
  subject       TEXT NOT NULL,                   -- 'user:{id}' | 'household:{id}' | 'global'
  metric        TEXT NOT NULL,                   -- 'upload' | 'parse_fail' | 'device_link' ...
  window        TEXT NOT NULL,                   -- '2026-11-24' or '2026-11' (✅ M6: IST; also '2026-11-24T13' for hourly)
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, metric, window)
);

CREATE TABLE audit_event (                       -- security log, no PII; keep ≥ 1 year (DPDP Rule 6)
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT,
  household_id  TEXT,
  event         TEXT NOT NULL,                   -- 'login','device_linked','statement_added','statement_deleted','export','account_deleted',...
  ip_country    TEXT,
  ua_hash       TEXT,
  at            INTEGER NOT NULL
);

CREATE TABLE consent (                           -- DPDP consent records
  user_id       TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  notice_version TEXT NOT NULL,
  accepted_at   INTEGER NOT NULL,
  withdrawn_at  INTEGER,
  PRIMARY KEY (user_id, notice_version)
);

-- ─── pocketfolio-market (binding MARKET), migrations/market/0001_market.sql ───
-- Shared public market data (no user linkage)
CREATE TABLE tracked_scheme (                    -- union of schemes anyone holds; drives NAV + stock jobs
  isin          TEXT PRIMARY KEY,
  amfi_code     INTEGER,
  amc           TEXT,
  last_seen_at  INTEGER NOT NULL                 -- drop from jobs after 90 days unseen
);
CREATE TABLE fund_portfolio (                    -- stocks inside a fund for a month (§10.3)
  scheme_isin   TEXT NOT NULL,
  month         TEXT NOT NULL,                   -- YYYY-MM
  source        TEXT NOT NULL CHECK (source IN ('amc','bharatstock')),
  blob_key      TEXT NOT NULL,                   -- R2: market/holdings/{isin}/{month}.json
  fetched_at    INTEGER NOT NULL,
  PRIMARY KEY (scheme_isin, month)
);
CREATE TABLE scrape_run (
  amc           TEXT NOT NULL,
  month         TEXT NOT NULL,
  status        TEXT NOT NULL,                   -- 'ok' | 'not_published' | 'failed' | 'blocked'
  schemes_found INTEGER,
  error_class   TEXT,
  at            INTEGER NOT NULL,
  PRIMARY KEY (amc, month, at)
);
```

**Why the statement JSON goes in R2, not D1:**
- A D1 row is limited to 2 MB. Measured statements are 0.2–97 KB (§3.3), but a 10-year CAMS detailed statement is unmeasured.
- Reads and writes of blobs would take turns with every other query in the single-threaded D1 (§3.4).
- R2 is cheap: 10 GB free, $0.015/GB-month after that, and $0.36 per million reads. At ~40 KB compressed per household,
  10k households need ~0.4 GB.
- D1 holds only metadata and keys.

**Why parked PDFs go in R2, not D1:** uploads can be 10 MB, which is over the 2 MB row limit. And D1 Time Travel keeps
deleted rows for 30 days, which would break "deleted after parsing" (rule 5).

R2 key layout:
- `h/{household_id}/statements/{statement_id}.bin` (gzip, then encrypted)
- `h/{household_id}/snapshot/{inputs_hash}.bin` (gzip, then encrypted; versioned, §10.2)
- `h/{household_id}/daily/{inputs_hash}_{nav_date}_{member|all}.bin` (cached daily series, §10.5.3; replaced daily)
- `tmp/{household_id}/{job_id}.bin`: encrypted parked PDF. **Lifecycle rule: delete after 1 day** (the R2 minimum).
  The app deletes it as soon as the job ends.
- `market/nav/{amfi_code}.json`
- (`market/scheme-list.json` is replaced by the D1 `scheme` table, §10.4)
- `market/holdings/{isin}/{YYYY-MM}.json`

---

## 7. Authentication

### 7.1 Setup (Better Auth on Workers + D1)

```ts
// worker/src/auth.ts  — create PER REQUEST (the D1 binding only exists inside the handler)
import { betterAuth } from "better-auth";
import { magicLink, emailOTP, deviceAuthorization } from "better-auth/plugins";

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.APP_URL,                         // https://<APP_DOMAIN>
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,                             // native D1 support (Better Auth ≥ 1.5)
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }, // otherwise all users share one rate-limit bucket
      useSecureCookies: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24,              // 30 days rolling
      cookieCache: { enabled: true, maxAge: 5 * 60 },                     // signed cookie: most requests skip the D1 session read (§3.5)
      additionalFields: {                                                  // carried in the session (and so the cookie cache)
        householdId: { type: "string", input: false },
        consentVersion: { type: "string", input: false },
      },
    },
    // ✅ M5 (better-auth 1.7.28): cookieCache and session.additionalFields are the names. householdId is filled in
    // databaseHooks.session.create.before; after POST /api/consent (M14), refresh the cookie cache.
    // Trade-off: a revoked session can keep working for up to maxAge (5 min) on routes that trust the cache. Sensitive
    // routes (export, delete account, device approve, revoke) call getSession with disableCookieCache so they always hit D1.
    rateLimit: {
      enabled: true, storage: "database",                                 // ✅ M5: built as customStorage instead (below)
      // Database rate limiting writes a D1 row per request. Apply it only to the endpoints that send email or create
      // codes, and skip session reads.
      customRules: {
        "/get-session": false,
        "/sign-in/magic-link": { window: 3600, max: 5 },
        "/email-otp/send-verification-otp": { window: 3600, max: 5 },
        "/device/code": { window: 3600, max: 10 },
      },
    },
    account: { accountLinking: { enabled: true, trustedProviders: ["google", "magic-link"] } },
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" },
    },
    plugins: [
      magicLink({
        expiresIn: 600,                           // 10 min
        sendMagicLink: async ({ email, url }) => sendLoginEmail(env, email, { url }),
      }),
      emailOTP({                                  // 6-digit code, needed inside the installed iOS app (§13A.5)
        expiresIn: 600,
        sendVerificationOTP: async ({ email, otp, type }) => type === "sign-in" && sendLoginEmail(env, email, { otp }),
      }),
      // sendLoginEmail: one email per sign-in request holding BOTH the link and the code. ✅ M5: the login form calls
      // POST /api/login/email, which runs both plugin endpoints server-side and captures the token and the code, then
      // queues ONE email. The plugins' own send endpoints are not routed (see "As built" below).
      // ✅ M13 (1.7.28): options verificationUri, expiresIn, interval (time strings) and validateClient exist as named.
      // Built with an absolute `${APP_URL}/link`, "300s", "5s" (the plugin's default interval) and validateClient = "web-qr".
      deviceAuthorization({ verificationUri: "/link", expiresIn: "5m", interval: "5s" }), // §7.4
    ],
    databaseHooks: { user: { create: { after: async (u) => createHousehold(env, u.id) } } },
  });
}
// index.ts: app.on(["GET","POST"], "/api/auth/*", c => createAuth(c.env).handler(c.req.raw))
```

- **As built in M5** (`worker/src/auth.ts`, `src/routes/auth.ts`):
  - **Allow-list.** `/api/auth/*` routes only the endpoints the app uses (get-session, sign-out, social sign-in and
    the Google callback, magic-link verify, email-OTP sign-in, list/revoke sessions). Everything else is a 404,
    including `/sign-in/magic-link` and `/email-otp/send-verification-otp`. So the only way to get an email is
    `POST /api/login/email`: Turnstile, then 5 emails per address per hour and 60 per IP per hour (generous, because
    mobile carriers put many users behind one IP), then one queued email.
  - **Rate limits** use `customStorage`: one atomic UPSERT on a small `rate_limit` table, with HMACed keys so no IP or
    email is stored. Better Auth's own `"database"` storage costs 2–4 queries per request. `customRules` ends with
    `"/**": false`, so only `/sign-in/email-otp`, `/magic-link/verify` and `/sign-in/social` are limited.
  - **The emailed link opens the SPA** (`/login/verify#token=…`), which then calls `/api/auth/magic-link/verify`.
    Link scanners that prefetch URLs can't use up the single-use token, and the fragment never reaches a log.
  - Tokens and codes are stored hashed (`storeToken` / `storeOTP: "hashed"`), because D1 Time Travel keeps old rows.
  - Google's OAuth tokens are never stored (an `account` hook nulls them); we only need the identity.
  - `advanced.database.validateSchema: false`. Otherwise Better Auth introspects the schema once per instance, which
    means one extra D1 query per request, since the instance is created per request.
  - The household (with its wrapped DEK and an empty `snapshot` row) is created in `session.create.before`, which
    covers signup by any method. It's an idempotent batch that also stamps `last_active_at`.
  - Measured in a test: with a warm cookie cache, a signed-in request makes **0** D1 session queries.
- **Compatibility:** set `nodejs_compat` in wrangler (it's the default from compatibility date 2026-08-04).
- **Magic-link tokens** stay in D1, which is the default. Don't use KV as `secondaryStorage`: it is eventually
  consistent and has no atomic get-and-delete, and single-use tokens need both.
- **Turnstile** (free) protects the "email me a link" form. The Worker checks the token before calling Better Auth.
- **Session middleware** (Hono) loads `auth.api.getSession({ headers })`. With the cookie cache this normally makes no
  D1 query, and `householdId` and `consentVersion` come from the session itself, so there's no household or consent
  lookup per request either. Routes get `c.var.user` and `c.var.householdId`. No session means 401, and the SPA
  redirects to `/login`. Target: **≤ 3 D1 queries per dashboard load** (down from ~20).
- **Batch writes.** Every multi-row write in a request (upload, member create, delete) goes in one `db.batch()`,
  which is one round trip and one transaction.

### 7.2 Google Cloud setup (owner checklist)
1. Create a Google Cloud project and set the OAuth consent screen to **External** with scopes `openid email profile`
   only. These are non-sensitive scopes, so **no app verification is needed**.
2. Verify `<APP_DOMAIN>` in Google Search Console with the project-owner account.
3. Add a homepage, a privacy policy and terms on the same domain (§12), plus app name (PocketFolio), logo and support email.
4. Request **brand verification**: minutes if automated, otherwise 2–3 business days. It's valid for 7 days, so
   publish within that window.
5. Set publishing status to **In production**. Testing mode caps you at 100 test users with 7-day tokens.
6. Create a Web client ID:
   - JS origin: `https://<APP_DOMAIN>`
   - Redirect URI: `https://<APP_DOMAIN>/api/auth/callback/google`
   - Add a second client ID for `http://localhost:8787` (dev).

### 7.3 Email
- **Interface:** `EmailSender.send({ to, subject, html, text })`, implemented with `CloudflareEmailSender` over the
  `send_email` binding `EMAIL` (`env.EMAIL.send({ to, from, subject, html, text })` → `{ messageId }`). It needs no
  secret. If the beta fails us, a `ResendSender` (HTTPS API, `RESEND_API_KEY`) can be added behind the same interface.
- **Sender:** "PocketFolio" `login@<APP_DOMAIN>`. ✅ 2026-11-25: the owner onboarded `pocketfolio.in` itself (no
  subdomain) in Email Sending. Cloudflare manages SPF, DKIM and DMARC, with its bounce records on
  `cf-bounce.pocketfolio.in`.
- **Support mailbox:** `support@<APP_DOMAIN>` is received through Cloudflare Email Routing, which forwards it to the
  owner's inbox. Replies go out through Gmail "Send mail as" over Cloudflare's SMTP (`smtp.mx.cloudflare.net:465`,
  user `api_token`, password a token with Email Sending: Edit). ✅ M5: Email Routing (root MX) and Email
  Sending (`cf-bounce` MX) coexist on the same zone. The docs say so ("separate DNS records and separate settings
  pages … Removing one does not affect the other"), and both record sets are live on `pocketfolio.in`.
- **Emails at launch:**
  - the sign-in email (magic link plus a 6-digit code, §13A.5)
  - "Your account was deleted"
  - the DPDP inactivity notice (§12)
- **Keep emails plain.** The magic-link email contains no portfolio data: link, expiry, "didn't request this? ignore it".
- **Sending through a queue.** `sendLoginEmail` puts a message on the `email` queue. Email Service has no batch
  endpoint, so the consumer sends each message in the batch with its own `env.EMAIL.send()` call. It acks each one
  separately. On `E_RATE_LIMIT_EXCEEDED` it retries that message with `retry({ delaySeconds })`. On
  `E_DAILY_LIMIT_EXCEEDED` it retries later and raises an alert. Permanent errors (`E_RECIPIENT_SUPPRESSED`, invalid
  address) are acked, logged by code only, and never retried. Set `max_batch_timeout` to 1 s, so a login email still
  arrives within seconds, and keep `max_concurrency` low (2), because no per-second limit is published. ✅ M5
  (Email Service docs, 2026-11-25):
  - **Sender restriction:** `allowed_sender_addresses`. Deploying with the binding needed no extra token permission.
  - **Local dev:** `wrangler dev` only logs the message and saves it to a temp file. `"remote": true` sends for real.
  - **Errors:** `send()` throws an `Error` with `.code`. A malformed argument throws a `TypeError` with no code.
    Codes: `E_RATE_LIMIT_EXCEEDED` and `E_INTERNAL_SERVER_ERROR` / `E_EMAIL_SENDING_NOT_READY` are retried.
    `E_DAILY_LIMIT_EXCEEDED` is retried and alerted. Config errors (`E_SENDER_*`, `E_RECIPIENT_PLAN_RESTRICTED`,
    `E_ACCOUNT_SUSPENDED`) are dropped and alerted. Permanent errors (`E_VALIDATION_ERROR`, `E_RECIPIENT_SUPPRESSED`,
    `E_RECIPIENT_NOT_ALLOWED`, `E_DELIVERY_FAILED`, size and header codes) are dropped.
  - **Expiry:** a sign-in email older than its 10-minute expiry is dropped instead of sent late.
  - **Test sink:** with the `EMAIL_SINK_KEY` secret (local and staging only; production's config doesn't list it),
    `@sink.pocketfolio.test` addresses are written to R2 instead of sent, so `worker/scripts/auth-smoke.ts` can sign
    in on staging end to end.
- **Make Google the main sign-in button** (§13). It sends no email, so most signups never touch the email budget.
- **Budget:** Workers Paid includes 3,000 emails a month, then $0.35 per 1,000. Hard bounces count; sends blocked by the
  suppression list don't. Sends to the account's *verified destination addresses* are free and don't count, which
  makes them useful for staging tests. The daily quota for a new account is unpublished: **file Cloudflare's Limit
  Increase Request before public launch** (M17). Alert at 80% of the monthly allowance, and on any
  `E_DAILY_LIMIT_EXCEEDED` (audit event plus a log line).

### 7.4 QR login for a new device (D2) — design

This is the RFC 8628 device grant, which is the same shape as WhatsApp Web.

```
New device (logged out)                Worker / Better Auth              Logged-in phone
──────────────────────                 ────────────────────              ───────────────
/login → "Log in with QR"
POST /api/auth/device/code  ─────────► creates deviceCode (5 min, single use)
◄── device_code, user_code, verification_uri_complete = https://<APP_DOMAIN>/link?code=ABCD-EFGH
Render QR of verification_uri_complete
plus the user_code in text
poll POST /api/auth/device/token every `interval`
                                                                          Scan with the phone camera (it opens the URL),
                                                                          or in-app "Link a device" → camera scanner
                                                                          /link page (must be logged in):
                                                                           "Sign in on Chrome · macOS · Mumbai, IN?"
                                                                           shows the code ABCD-EFGH (match it with the screen)
                                                                           [Approve] [Deny]
                                                        ◄──────────────── POST /api/auth/device/approve {userCode}
◄── token response (Better Auth session token)
POST /api/session/adopt {token} ─────► validate token → set the session cookie
redirect to /
                                       session for the approver's own user; audit_event;
                                       in-app "New device linked" notice on the other devices
```

Implementation notes:
- **One account, many devices (owner, 2026-11-26).** Like WhatsApp Web, the new device joins the approver's account.
  The device grant issues a session for the approving user (`deviceCode.userId`), so it carries the same
  `householdId` and sees the same data. No user row is created, nothing is typed on the new device, and there's no
  signup or consent step for it (consent belongs to the user, §12). Signing out of it, or revoking it in Settings →
  Devices, ends only that session.
- **No email on link (owner, 2026-11-26).** Instead of a "New device signed in" email, the other signed-in devices
  show a one-time toast "New device linked: Chrome · macOS · Mumbai" (from the `audit_event`, read with the next
  `/api/me`), and Settings → Devices marks that session "New" for 7 days. This saves the email budget (§7.3).
- **Libraries.** Generate the QR in the browser with `uqr` or `qrcode` (small, no network). Scan in-app with
  `BarcodeDetector` where it exists (Chrome and Android), falling back to `qr-scanner` (jsQR-based). Most people will
  just use the phone's camera app, since the QR is a URL.
- **Security** (these are required by the Better Auth docs and the IETF cross-device BCP):
  - The approval page shows the requesting device's browser, OS and approximate location. Store the country, the
    city and the parsed UA when the code is created (✅ M13, better-auth 1.7.28: extra fields exist only through the
    plugin's internal `grant` option, which also changes its client-id rules, so the fallback is used: a side table
    `device_code_meta(user_code, label, city, country, created_at)`. `POST /api/login/qr` writes it, and it stores
    a short label like "Chrome · macOS", not the raw UA. City and country come from `request.cf`, which a client
    can't forge like a `cf-ipcity` header. Cleanup deletes rows after an hour).
  - It shows the user code to compare and needs an explicit **Approve**.
  - Warning text: "Only approve if you're signing in on a device in front of you right now."
  - The code lasts 5 minutes and is single use. Device-code creation is limited to 10 per hour per IP.
- **Cookie bridge.** The device token endpoint returns a session token (✅ M13, 1.7.28: it sets **no** cookie. It
  only calls `setNewSession` and returns `access_token`). Built simpler and safer than the `/api/session/adopt`
  sketch: the token never reaches the page.
  - A tiny plugin (`pf-device-session-cookie` in `worker/src/auth.ts`) adds an after-hook on `/device/token` that
    calls Better Auth's own `setSessionCookie`, so the cookie has the normal name, signature and cookie cache.
  - `POST /api/login/qr/poll` calls the endpoint through `auth.api`, passes the `Set-Cookie` headers on, and drops
    the token from the body.
  - So there's no `bearer()` plugin, no adopt route and no 60-second window.
- **Routes (M13).** Better Auth's `/device*` endpoints aren't routed. The app uses its own routes:
  - `POST /api/login/qr` (10 an hour per IP) and `POST /api/login/qr/poll` (answers `pending`, `slow_down`,
    `approved`, `denied` or `expired`);
  - `GET /api/link?user_code=` (30 per 10 min per user). In 1.7.28 approval needs the code to be **claimed** first
    by a signed-in `GET /device`, and this route does that claim. A code claimed by another account looks like a
    wrong code;
  - `POST /api/link/approve` and `POST /api/link/deny`;
  - `GET /api/devices`, `DELETE /api/devices/:id` and `POST /api/devices/sign-out-others`. These replace Better
    Auth's `list-sessions` and `revoke-*`, which are no longer routed, because `list-sessions` would hand every
    session token to the page.
  - The QR URL is `/link?user_code=ABCDEFGH` (the plugin's parameter name).
- **Client ID.** Better Auth's device plugin expects one. Use the fixed value `web-qr` and validate it with
  `validateClient: id => id === "web-qr"`.
- **Settings → Devices** lists sessions with UA, city and last active, with **Sign out this device** and **Sign out all
  other devices** (✅ M13: our `/api/devices` routes, see above). A device linked by QR in the last 7 days shows a
  "New" badge.
  - City and country are plain `session` columns, so they stay out of the cookie cache. They're written by a
    `session.create` after-hook from `request.cf`, and by the poll route for QR sessions. `session.linkedAt`
    marks a QR link.
  - The one-time notice is a subquery inside `/api/me`'s single household read, so the D1 budget is unchanged.
    `session.noticeAt` records that a device has shown it.

---

## 8. Encryption

Statements and snapshots are encrypted in the application, on top of Cloudflare's at-rest encryption, so a leaked R2
bucket or D1 export is useless on its own.

- **KEK** (key-encryption key):
  - 32 random bytes held as a Worker secret, `DATA_KEK_V1`.
  - `kek_version` is stored per household. To rotate: add `DATA_KEK_V2`, re-wrap the DEKs, then remove V1.
    ✅ M6: new DEKs are wrapped with the highest `DATA_KEK_V<n>` that is set, and `rewrapDeks()` moves households in
    batches with a compare-and-set on `kek_version` (call it until it returns 0). Tested.
- **DEK** (data key): 32 random bytes per household, generated at household creation and stored wrapped
  (`AES-GCM(KEK, DEK)`) in `household.dek_wrapped`.
- **Blob format:** `0x01 | kek_version (1B) | flags (1B) | iv (12B) | AES-256-GCM ciphertext+tag`. `flags` bit 0 = the
  plaintext was gzip-compressed before encryption (D18). It's set for JSON blobs and clear for parked PDFs. The AAD is
  `"{household_id}:{blob_key}"`, so a blob can't be swapped into another household. Use `CompressionStream("gzip")`
  and `DecompressionStream` in the Worker. Never compress after encrypting.
  ✅ M6 (`src/lib/crypto.ts`, `src/lib/blob.ts`): the AAD is the 3 header bytes followed by `"{household_id}:{key}"`,
  so the flags and KEK byte can't be edited either. Encrypted columns use the same format, with a field name as the key
  (`member/{id}/pan`, `member/{id}/name`). `kek_version` records the KEK at seal time; a re-wrap keeps the DEK, so
  old blobs still open. D1 returns BLOB columns as number arrays; the readers accept them.
- **Fields:** `pan_enc`, `display_name_enc`, `password_enc` (both tables) and all R2 user blobs, including parked PDFs
  in `tmp/`, use the household DEK.
  `pan_hmac = HMAC-SHA256(PAN_PEPPER, PAN)`, where `PAN_PEPPER` is a Worker secret.
- **API:** WebCrypto only (`crypto.subtle`), in `worker/src/lib/crypto.ts`. Expose
  `seal(householdId, key, bytes)` and `open(householdId, key, bytes)`. Cache the unwrapped DEK per request only;
  never store it in KV.
  ✅ M6: these are `Vault.seal(key, bytes, flags)` / `Vault.open(key, bytes)`, where a `Vault` holds one household's
  non-extractable DEK for one request (`tenant(c).vault()`, at most one D1 read, or none when the key row comes in a
  batch). `blob.ts` adds `sealJson`/`openJson` (gzip), `sealPdf`/`openPdf` (no gzip) and the R2 key builders.
- **The engine never sees keys.** The Worker decrypts and sends plaintext over the internal DO→container channel, and
  the engine returns plaintext.
- **Account deletion is crypto-shredding.** Delete `household.dek_wrapped` first, then the R2 prefixes
  `h/{household_id}/` **and `tmp/{household_id}/`**, then the rows. D1
  Time Travel (30 days) can still hold rows, but they're useless without the DEK. Say this in the privacy policy:
  "backups purged within 30 days".
  ✅ M6: `shredHousehold()` in `src/lib/household.ts` (blanks `dek_wrapped`, deletes both prefixes, then the household
  row, which cascades). ✅ M14: `deleteAccount()` (`src/lib/account.ts`) calls it from `DELETE /api/account` and the
  inactivity erasure, then removes every other row naming the user. A test scans every table and column for the
  user id, household id and email afterwards: only `audit_event` remains. Sealed `/daily` entries in the edge cache
  expire within a day and are unreadable without the DEK.

---

## 9. API (Worker)

### 9.1 Tenant guard (use everywhere)
```ts
// lib/tenant.ts
export async function assertMember(c, memberId: string) {
  const row = await c.env.DB.prepare("SELECT id FROM member WHERE id=? AND household_id=?")
    .bind(memberId, c.var.householdId).first();
  if (!row) throw new HTTPException(404);   // 404, not 403: don't reveal existence
}
```
- Every SQL statement on user tables includes `household_id = ?` bound from the session.
- R2 keys are built only from server-side IDs.
- The SPA never sends a household ID.
- ✅ M6: `src/lib/tenant.ts` is a per-request `Tenant` (`tenant(c)`): `assertMember`, `assertStatement` (non-UUIDs are
  404 without a query), `keys.*` for R2, and `vault()`. Errors are thrown as `ApiError` and returned as
  `{ ok: false, code }` (the shape the Worker has used since M2, not `{ error: { code, message } }`; the SPA maps codes to
  safe messages).

### 9.2 Endpoints

| Method & path | Auth | Purpose | Notes |
|---|---|---|---|
| `GET/POST /api/auth/*` | – | Better Auth (Google, magic link, device flow, sessions) | |
| `POST /api/session/adopt` | device token | QR cookie bridge (§7.4) | only if needed |
| `GET /api/me` | ✅ | `{ user: {name, email, image}, household: {id, created_at}, consent_ok, limits, usage }` | ✅ M14: also `notice_version`; `consent_ok` comes from the session, else one D1 check. 401 when the household is gone (a deleted account's other devices hold a valid cookie cache for ≤ 5 min). `limits`/`usage` not built yet |
| `POST /api/consent` | ✅ | record acceptance of `notice_version` | Blocks every `/api/*` data route until accepted (403 `consent_required`). ✅ M14: body `{ notice_version, adult: true }` (`409 notice_changed`, `400 adult_required`). Writes `consent`, stamps every session of the user and re-issues the cookie cache, so gating costs 0 D1 queries on a consented request. A session without the current version pays one query (`UPDATE session … WHERE EXISTS consent … RETURNING`), which also covers consent given on another device. `requireSession()` gates by default; `/me`, `/consent`, export and delete pass `consent: false` |
| `GET /api/config` | – | `{ features: { cdsl_fetch: false, kfintech_auto: false, stocks: true }, kfintech_form_url, turnstile_site_key }` | replaces today's sandbox config |
| `POST /api/metrics` | ✅ | `{ metric }` → 204 | ✅ M15: anonymous install / launch counters (§13A.6). Fixed list of names, 30 a day per account, no user ID stored |
| `GET /api/members` | ✅ | list `{id, name, pan_masked, statements: [{id, kind, as_of, holdings_count}]}` | ✅ M6: returns `{ members: [...] }`; `name` is null until a statement or a rename sets it. One D1 batch |
| `PATCH /api/members/:id` | ✅ | rename (display override) | ✅ M6: `{ name }`, 1–60 characters; replaces the sealed `display_name_enc` (a later statement doesn't overwrite it, M7) |
| `DELETE /api/members/:id` | ✅ | delete member + their statements + blobs; enqueue rebuild | confirm in UI |
| `POST /api/statements` | ✅ | multipart `file`, `password?` **only**: no PAN, no member (D19). The member comes from the statement |  §10.1. `201 {statement}` (direct path) or `202 {job: {id, position, eta_s}}` (queued path). ✅ M7: `201 { statement: {id, kind, as_of, holdings_count, warnings_count}, member: {id, name, pan_masked, created} }`; ✅ M8: `202 { job }` when no slot is free, `503 queue_full` over the parked-PDF cap |
| `GET /api/jobs` | ✅ | the household's open and recently finished parse jobs: `[{id, status, position, eta_s, error_code, statement_id}]` | drives the "Processing" list; no PDF data. ✅ M8: `{ jobs }`, open ones plus those finished in the last 24 h; one D1 read + one pool call |
| `GET /api/jobs/:id` | ✅ | one job's status | polled with backoff; `Retry-After` header set to the suggested next poll. ✅ M8: `{ job }`; `Retry-After` 2–10 s while queued, 2 s while parsing, none once finished; a `done` job also returns `statement` and `member` (as the `201` does) |
| `DELETE /api/jobs/:id` | ✅ | cancel: delete the parked PDF and the job | ✅ M8: also dismisses a finished job; `409 job_running` while it's being parsed |
| `DELETE /api/statements/:id` | ✅ | delete one statement; enqueue rebuild | ✅ M7: row (`RETURNING blob_key`) + audit in one batch, then the blob; 404 for other households. The rebuild is enqueued from M10 |
| `GET /api/portfolio` | ✅ | snapshot JSON (same shape as today's `Portfolio` type, with stable member IDs) + `{ stale, building }` | §10.2 |
| `GET /api/portfolio/status` | ✅ | `{ status, built_at, market_date }` for polling after upload. ✅ M10: also `building`, `pending` (`snapshot.requested_at > checked_at`: a rebuild is due) and `stale`; `status` is `empty`/`pending`/`building`/`failed`/`ready` | one indexed D1 read; polled with backoff (2 → 15 s), `Retry-After: 3` while due |
| `GET /api/portfolio/daily?days=30&member=all` | ✅ | daily returns (§10.5): `{ as_of, coverage, today, series }` | `days` ≤ 366; `member` is `all` or a member ID, checked with `assertMember` |
| `POST /api/sips/skip` · `DELETE /api/sips/skip` | ✅ | skip the next instalment of one SIP, or undo it (§10.5.1, M12): `{ member_id, isin, folio, due }` | `member_id` checked with `assertMember`; `due` today to +100 days; one skip per SIP |
| `POST /api/sips/cancel` | ✅ | cancel one SIP in PocketFolio for good (§10.5.1, M12): `{ member_id, isin, folio, confirm: true }` | `assertMember`; no undo; ≤ 200 changes per household |
| `GET /api/assets` · `POST /api/assets` · `PATCH/DELETE /api/assets/:id` | ✅ | FD, PPF and EPF (§21.12, M19), gold, silver and SGBs (§21.5, M29) entered by hand: inputs only, the SPA computes values. `rates.metals` carries the gold and silver ₹/g series (edge-cached 1 h) | ✅ M19: `member_id` optional, checked with `assertMember`; another household's id → 404; `400 bad_input {field}`; `409 asset_limit` (50); `429 asset_write_limit` (30 adds/edits a day; deletes are never limited) |
| `GET /api/market/status` | – | `{ latest_nav_date, coverage_pct, final }` for the "NAVs updating" hint | public, cacheable for 5 min |
| `POST /api/kfintech/guide` | ✅ | `{ member_id or pan, password? }` → stores a pending password, returns `{ password, form_url }` | the manual path only (D9); same validation as `kfintech.password_problem`. **The one place a PAN may be typed:** KFintech's own form needs it, and a new person isn't a member yet. Picking an existing member needs no PAN |
| `GET /api/account/export` | ✅ | JSON download of all parsed statements and members (decrypted) | DPDP access right; 3 per day. ✅ M14: fresh session (D1), `429 export_limit`. Streams: account, sign-in methods, sessions (IP, UA), consents, household, members (name, PAN), SIP changes, uploads, pending passwords, the user's security log, then each statement's parsed JSON. Leaves out internal keys and lookup values (DEK, HMACs, R2 keys, hashes, tokens) and snapshots (derived) |
| `DELETE /api/account` | ✅ + recent auth | delete everything (§8), sign out all sessions, send the confirmation email | requires a session less than 10 min old or a fresh magic link. ✅ M14: `{ confirm: "DELETE" }` (`400 confirm_required`), `403 reauth_required` past 10 min (the UI signs out and back in, then reopens the dialog). `shredHousehold()`, then quota, pending codes/links, the per-address rate-limit row and the user (cascades session, account, consent), a second prefix sweep, and the email. `audit_event` rows stay (ids only, 400 days) |
| `POST /api/cdsl/*`, `POST /api/kfintech/request` | – | **Not deployed** (D8, D9). Return 404. | Keep the old code in `engine/legacy/` or git history |

Errors: JSON `{ error: { code, message } }`. Messages are safe to show and never contain PANs or file names.

---

## 10. Pipelines

### 10.1 Upload and parse (two paths, D6 + D16)

**A. Verify everything the user could fix, before anything is stored** (synchronous, in the Worker, < 1 s). The user is
still on the page, so every mistake is reported straight away. A PDF that fails any of these checks is never stored.
Once a PDF passes, **the only thing left is parsing**: a queued job never needs the user again, even if they close the
tab (owner decision, 2026-11-25).
1. **Rate limit and quota (§11).** Size ≤ 10 MB, and the bytes must start with `%PDF`. The household's open jobs
   must be under the cap (§11).
2. **No PAN or member is asked for (D19).** The request carries only the file and an optional password. The member is
   worked out from the statement itself in step 5.
3. **Duplicate check.** `content_hash = HMAC(PAN_PEPPER, bytes)`. If it already exists in `statement`, or in an open
   `parse_job` of the household, return 409 "already added" or "already processing".
4. **Candidate passwords, in order:**
   1. the password the user typed, if any;
   2. the PAN of **each existing member** of the household (decrypted from `pan_enc`, at most 10; the usual CDSL
      password);
   3. every unexpired pending KFintech password of the household (`pending_statement_password`).

   A wrong try costs ~10–30 ms in pdf.js, so 10+ candidates still fit well inside the budget.
5. **Pre-check the PDF in the Worker** (`worker/src/lib/pdfcheck.ts`, pdf.js; measured 22–37 ms in workerd plus
   40–53 ms to load pdf.js once per isolate, §3.3):
   - **Password.** Open the PDF with each candidate in turn. pdf.js throws `PasswordException` for a wrong one. If none
     works, return 422 `password_required`. If a password was typed, the message is "That password didn't open this
     statement". If none was typed (for example the first statement of a new household), it's "This statement is
     password-protected. Enter its password." with the hint "For a CDSL eCAS this is usually the PAN in capital
     letters. For CAMS/KFintech it's the password you chose when requesting it." The dialog shows the password field;
     nothing was stored. Remember **which candidate worked** (`password_source`: `typed` | `pan` | `kfintech_pending`).
   - Unencrypted PDFs simply open with no password.
   - **Statement type.** Read the text of pages 1–2 and apply the same keyword rules as `detect_type` in
     `app/parsers/__init__.py` (CDSL: "HELD IN DEMAT", "CAS ID", "CENTRAL DEPOSITORY"; RTA: "KFIN", "CAMS",
     "COMPUTER AGE"). If neither matches: 422 `unrecognised`, "Upload a CDSL or CAMS/KFintech consolidated statement".
   - **Find the holder's PAN in the statement** (pages 1–3, upper-cased, also with whitespace removed):
     - Take tokens matching `PAN\s*[:\-]?\s*(NO\.?\s*[:\-]?\s*)?([A-Z]{5}[0-9]{4}[A-Z])`, i.e. a PAN printed after a
       "PAN" label.
     - Keep only **individual PANs** (4th letter `P`). KFintech statements also print a trust's PAN (4th letter `T`),
       which must be ignored.
     - Measured on 2026-11-25: the labelled PAN was the holder's in 4 of 4 statements, and the extra PAN-like string on
       each KFintech statement was a `T` PAN.
     - If `password_source='pan'`, the PAN that opened the file is a strong signal and must agree with the one found.
   - **Resolve the member from that PAN** (`pan_hmac = HMAC(PAN_PEPPER, PAN)`):
     - It matches an existing member → that member.
     - It's new → a new member will be created **after the parse succeeds**, so a failed parse leaves no empty
       member. The member cap (§11) is checked now: 422 `member_limit` if the household is full.
     - No single individual PAN was found (ambiguous or none) → don't block. The member is decided from the engine's
       parsed `statement.pan` (step 6), and the member cap is checked then.
   - **Page count.** Over 300 pages: 422 `too_large`.
   - pdf.js reads from an in-memory `Uint8Array` and never writes anything. Call `loadingTask.destroy()` afterwards.
   - Logs carry only the outcome code and CPU time. Never the text, the PAN or the password.
   - ✅ (M3, 2026-11-25) **pdf.js 6.5 (`pdfjs-dist`, modern build) runs inside workerd** with `nodejs_compat`. No
     fallback is needed: `unpdf` and an engine `/precheck` weren't tried. How it works:
     - `loadPdfJs()` dynamically imports `pdfjs-dist` and `pdfjs-dist/build/pdf.worker.mjs` on first use. It sets
       `globalThis.pdfjsWorker`, so pdf.js's fake worker runs in the same isolate without importing a URL.
     - Options: `useWasm: false`, `useWorkerFetch: false`, `useSystemFonts: false`, `disableFontFace: true`. Text
       extraction needs no canvas, fonts, wasm or fetches. pdf.js 6 no longer uses `eval`.
     - Candidates go through `loadingTask.onPassword`, so a wrong try doesn't reload the document.
     - CPU and memory for a 12 MB, 300-page encrypted PDF are in §3.3: 24 ms, peak RSS +68 MB, under 128 MB.
     - Tested in `@cloudflare/vitest-plugin` (workerd) and in the wrangler bundle under `wrangler dev`.
   - The full parse reads the PAN again from the parsed data (step 6), as a final guard.

**B. Ask for a slot.** `EnginePool.acquire({ class: "fast", wait: false })` returns a lease `{ name, lease_id }` or
`busy` together with `{ queued_ahead, eta_s }`.

**C. Direct path (a slot is free; the normal case):**
5. **Parse.** Call `/parse` on `EngineFast-{name}` with the bytes, **the one verified password** and the detected
   `kind`. The engine:
   - opens the PDF in memory (`BytesIO`) and never writes a file;
   - returns `{ ok, kind, pan, statement }` or `{ ok: false, code }`, where `code` is `parse_error` (layout the parser
     can't read), `multi_pan`, or `precheck_disagree` (the engine couldn't open a PDF the pre-check opened, or saw a
     different type: a bug, counted in metrics).
   - Release the lease in `finally`. Leases expire after 90 s in case the Worker dies.
6. **Member from the parsed PAN.** `statement.pan` is authoritative.
   - If the pre-check identified a PAN and it differs, fail with `precheck_disagree` (a bug, counted in metrics).
   - Otherwise find or create the member by `pan_hmac`. Store `pan_enc`, `pan_masked`, and `display_name_enc` from the
     holder name in the statement.
   - If creating the member would exceed the cap: `member_limit`.
   - CAMS/KFintech statements covering several PANs still fail with `multi_pan` ("upload one statement per member"),
     as `rta.py` does today.
7. **Store** (`storeStatement`, shared with path D):
   - Compress and encrypt the JSON and put it in R2.
   - In one `DB.batch()`: create the member if needed, insert the `statement` row, delete the pending password if it
     was the one used, and bump the quota.
   - Upsert `tracked_scheme` in `MARKET` for the statement's ISINs and AMFI codes, as **one multi-row statement**
     (≤ 30 rows per statement). That table holds only public scheme IDs, with no link to the user.
8. **Respond.** Enqueue a debounced `rebuild(household_id)` (§10.2) and return
   `201 { statement: {id, kind, as_of, holdings_count, warnings_count} }`.
9. **Nothing to clean up.** The bytes were never written.

✅ M7 (2026-11-26), as built in `src/lib/statements.ts` + `src/routes/statements.ts`:
- **One D1 round trip before the pre-check:** the household key, members, unexpired pending passwords, the duplicate
  check (stored or open job), open jobs and the three quota counters, all in one batch. Then one store batch.
- **Refusals** (all `{ ok: false, code }`, nothing stored): `413 file_too_large` (also refused from `Content-Length`
  before buffering), `422 not_pdf`, `409 already_added` / `already_processing`, `422 password_required` with
  `typed: true|false` (the SPA picks the message), `unrecognised`, `too_large`, `pan_mismatch` (the member PAN that
  opened the file differs from the PAN printed in it), `member_limit`, `parse_error`, `multi_pan`, `precheck_disagree`,
  `504 parse_timeout`, `429 upload_limit` / `too_many_failures` / `jobs_limit` with `retry_after` and `Retry-After`.
- ~~Until M8, a busy pool answers `503 busy`~~: replaced by the queued path in M8 (`202`, below).
- A typed PAN in lower case is also tried upper-cased. If the PDF has no single labelled PAN but a member's PAN opened
  it, that PAN is the pre-check PAN.
- **Failed parses** (`parse_fail`, 10 per hour) count wrong typed passwords, unrecognised files and parser failures.
  The first "this statement needs a password" prompt (nothing typed) doesn't count.
- **Race-safe store:** the member insert is `INSERT … SELECT … WHERE (member count) < 10 ON CONFLICT DO NOTHING`, and
  the statement row takes `member_id` from a `pan_hmac` subquery. A full household fails the batch on the NOT NULL
  `member_id` (`member_limit`), a concurrent duplicate on the UNIQUE `content_hash` (`409`), and the upload quota on its
  NOT NULL trick (`429`). Any of these deletes the already-written blob again. The upload quota is also read early,
  so the engine isn't used for an upload that would be refused.
- A statement for an existing member without a name sets the holder's name; a rename is never overwritten.
- **24 per member:** after the insert, the same batch deletes the oldest statements of the arriving kind until the
  member has 24 (`DELETE … RETURNING blob_key`), then their blobs.
- **Blob:** `{ format: 1, kind, parser_version, statement }`, gzip then sealed. The engine's `/parse` now returns its
  `version` (stored as `parser_version`).
- **`tracked_scheme`:** fund ISINs (`INF…`) only, 30 rows per statement (D1's 100-parameter limit), all in one `MARKET`
  batch. Rows unchanged and seen within the last day are skipped by the upsert's `WHERE`; a CDSL statement (no AMFI
  code) never erases a known code. A failure here is logged and doesn't fail the upload.
  ✅ M9: the same batch gives CDSL ISINs their code from `scheme`, and marks codes never backfilled `pending`; those
  are sent to nav-backfill once, with the earliest transaction date for their ISINs (§10.4.3).
- The engine call retries a refused connection or an engine `503` up to 3 times, 1 s apart (the process restarts every
  200 requests), and gives up after 60 s with `parse_timeout`.
- Tests: `test/statements.test.ts` (31, synthetic PDFs, fake engine) and `test/statements.private.test.ts` (4 private
  statements through the real engine container: stored sealed, nothing in `tmp/`, duplicate refused, re-filed by the
  member PAN with no password).

**D. Queued path (all slots busy; only reached after every check in A passed):**
5. **Park.** Encrypt the PDF with the household DEK (no gzip; PDFs are already compressed) and put it at
   `tmp/{household_id}/{job_id}.bin`. Insert the `parse_job` row with `status='queued'`, the detected `kind`, the
   `password_source`, the **verified** password encrypted (only when `password_source='typed'`; otherwise it's
   re-derived from the member's PAN or the pending KFintech password when the job runs), `expires_at = now + 24 h`, and
   `seq` from the pool.
6. **Enqueue** `{ job_id }` on the `parse` queue. The message is tiny and never holds the PDF (128 KB limit).
7. **Respond** `202 { job: { id, position, eta_s } }`.
8. **Consumer** (`parse` queue, `max_batch_size: 1`, `max_concurrency` = `EngineFast` cap):
   1. Load the job. Stop if it's no longer `queued` (cancelled, done, or picked up twice).
   2. `EnginePool.acquire({ class: "fast", wait: true })`. If there's no slot, `msg.retry({ delaySeconds: 5–30 })` with
      jitter and don't count it as an attempt.
   3. Set `status='parsing'`, `attempts += 1`. Read and decrypt the PDF, then call `/parse` with the verified password.
   4. **Success:** PAN check, then `storeStatement` (step 7). **Delete the R2 object**, set `status='done'` and
      `blob_key=NULL`, clear `password_enc`, then enqueue the debounced rebuild.
   5. **Any parse failure** (`parse_error`, `multi_pan`, `member_limit`, `precheck_disagree`):
      set `failed` with the code, and **delete the PDF**. None of these can be fixed by the user typing something, so
      there's no state that waits for them. The UI shows the safe message next time they look (§13).
   6. **Engine crash or timeout:** retry up to 3 attempts, then set `failed` / `parse_timeout` and delete the PDF.
   7. If the pending KFintech password was the source and has since expired, fail with `password_unavailable`.
      To avoid that, the pending password's expiry is extended to at least the job's `expires_at` when the job is parked.
9. **`tmp-sweep` cron** (hourly, §10.3): any job past `expires_at` has its PDF deleted and becomes `expired`. The R2
   lifecycle rule (1 day on `tmp/`) is the safety net if the cron fails.
10. **Time estimate.** `EnginePool` keeps a moving average of parse time per class (p50 over the last 200 jobs) and
    the number of free slots. `eta_s ≈ ceil((jobs ahead + 1) / slots) × avg_parse_s`, plus a cold-start allowance
    (3 s) when instances are asleep. `GET /api/jobs/:id` returns the current `position` and `eta_s`.

✅ M8 (2026-11-26), as built in `src/lib/jobs.ts` + `src/routes/jobs.ts`:
- **One pool call decides the path.** After every check in A, the upload asks `acquire({ class: "fast", wait: true,
  park: bytes })`: a lease (direct path), `busy` with a ticket (queued path; the parked-PDF counter is taken in the same
  call), or `full` when the global cap is reached (`503 queue_full`, `Retry-After: 60`, nothing stored).
- **Park** = sealed PDF in `tmp/`, then one batch: delete a finished job row for the same file, insert the job (the
  open-jobs cap is enforced inside the INSERT by writing NULL into the NOT NULL `status`, so a race can't pass 10),
  extend the pending KFintech password to the job's expiry, and **take the upload quota now**, so a parked job never
  fails on quota later. Any refusal deletes the PDF again. Then `{ job_id }` is sent; if that send fails the job is
  safe and tmp-sweep re-sends it. Response `202 { job: { id, position, eta_s } }`.
- **Password at parse time:** `typed` is kept sealed in `password_enc` (AAD `job/{id}/password`); `pan` is re-read from
  the member (`member_id`); `kfintech_pending` from `pending_pan_hmac`; an unencrypted PDF is `none`.
- **Slot waits re-send a fresh delayed message and ack the original** instead of `msg.retry()`. The Queues docs
  (read 2026-11-26) don't say whether `retry()` counts toward `max_retries`, and retries are capped (100 at most), so a
  long wait could have pushed a healthy job into the DLQ. The delay is about half the job's ETA, 5–60 s with ±20%
  jitter (the plan said 5–30 s; longer waits far back in a 10k burst keep the pool's request rate down). A queued job
  keeps its place: the pool re-registers an expired ticket at the same number (the ticket is `parse_job.seq`).
- **Claim** is a compare-and-set on `status` + `updated_at`, so a message delivered twice is parsed once. A job left
  `parsing` for 2 min is treated as crashed and re-claimed. An engine timeout, a crash or an infrastructure error goes
  back to `queued` (attempts 1–2) and fails as `parse_timeout` on the 3rd. `parse_error`, `multi_pan`,
  `precheck_disagree`, `member_limit` and `password_unavailable` fail at once. A missing parked object becomes
  `expired`. A concurrent direct upload of the same file ends the job as `done`.
- **Store** reuses `finishParsed` + `storeStatement` (the C6/C7 code of the direct path) with the job's `done` update in
  the same batch and no second quota take. The statement_added audit row has no country or UA (no request). Then the
  PDF is deleted and `blob_key` set NULL. Every end deletes the PDF first; if that fails, `blob_key` stays and
  tmp-sweep deletes it. The pool's parked counter and waiter are released.
- Failed queued parses don't count toward the hourly failed-upload limit (nothing the user did).
- **tmp-sweep** (`15 * * * *`, dispatched on `event.cron`): expires open jobs past `expires_at` (PDF first), deletes
  leftover PDFs of finished jobs, re-sends open jobs untouched for 15 min (waiting jobs touch `updated_at` every 5 min;
  the sweep touches what it re-sends), and recounts the parked PDFs into `EnginePool.setParked()`.
- **ETA:** `ceil((ahead + 1) / slots) × moving-average job time`, as before. The 3 s cold-start allowance isn't added:
  a busy answer means every slot was used in the last minute, so none is asleep.
- Tests: `test/jobs.test.ts` (16, real `EnginePool` forced to 0 free slots, fake engine container; one goes through the
  real pf-parse queue), 6 new `EnginePool` tests, and 4 private statements through the queued path on the real engine
  (consumer 0.35–1.7 s each, `tmp/` empty after).

**Never logged:** file names, PANs, passwords, statement contents. Log only `job_id`, status changes, durations and
error codes.

Engine `/parse` timeout: 60 s. On timeout return `parse_timeout`, and count it in metrics. A large CAMS statement on
`EngineFast` (1 vCPU) is expected to take ≤ 10 s (⚠️ measure in Phase 0).

### 10.2 Portfolio build (snapshot)
- **Refactor `build_portfolio`** into a pure function:
  `build_portfolio(statements: list[StatementInput], market: MarketData, today: date) -> dict`
  - `StatementInput = { member_id, pan, kind, as_of, data }`, decrypted by the Worker.
  - `MarketData` holds the NAV series for the needed AMFI codes, the benchmark series, scheme-list entries for
    demat-only ISINs, and stock-holding snapshots for the equity ISINs.
  - Member IDs are the DB UUIDs, not `m{idx}`. Members are still sorted by value.
  - `_latest_by_member` logic stays, but works on the list instead of a directory glob.
- **Market data.** D1 is the source of truth for NAVs (§10.4). After each ingest, the full NAV series of every
  *tracked* scheme that changed is written to R2 as `market/nav/{amfi_code}.json` (`{dates:[], navs:[]}`). To avoid
  large payloads, the engine reads these from R2 itself. ✅ Changed in M10: instead of the S3 API with a read-only R2
  token, the EngineBatch container (still `enableInternet: false`) has one outbound route,
  `ctx.container.interceptOutboundHttp("market.internal", ctx.exports.MarketGateway)`. The engine fetches
  `http://market.internal/nav/{code}.json` (`NAV_STORE_URL`), and `MarketGateway` (`worker/src/market-gateway.ts`)
  serves only `market/nav/*` from the R2 binding, read-only. No R2 credentials enter the container, and a container
  holding decrypted statements has no route to the internet. Verified with a real container in vitest
  (`test/market-gateway.container.test.ts`); the `R2_MARKET_READONLY_*` secrets aren't used. It keeps an in-process LRU cache keyed by `(code, market_date)`. ✅ M10: keyed by `(code, nav_key)`, where
  `nav_key` = market date | final | tracked coverage, so it changes as the night's rows land. Missing series aren't
  cached, and codes whose backfill is still pending (`refresh`) are always read fresh; the consumer builds again every
  2 min (at most 10 times) while they are. The Worker
  sends only the statements plus `market_date`. ISIN → AMFI code lookups come from the D1 `scheme` table, passed in
  the `/build` request.
- **New snapshot fields for daily returns (§10.5).** For each holding: `amfi_code` and `units_timeline`
  (`[[date, units], …]` change points), plus `units_exact` (true when it comes from full CAMS/KFintech transactions).
- **Debounce.** Every trigger (upload, delete, stale read, prebuild) sends `rebuild(household_id)` on the `rebuild`
  queue with `delaySeconds: 10`. A family uploading 4 PDFs within a few seconds then gets **one** build instead of
  four. Duplicate messages are harmless because of the steps below.
- **Consumer** for `rebuild(household_id)` (`rebuild` queue, `max_concurrency` = `EngineBatch` cap). It's idempotent
  and **single-flight per household**:
  1. Load the statements and compute `inputs_hash`.
  2. If it equals the snapshot's `inputs_hash`, stop.
  3. **Claim the build** with one conditional update:
     `UPDATE snapshot SET status='building', building_hash=?, building_until=now+120s WHERE household_id=? AND (building_hash IS NULL OR building_until < now OR building_hash <> ?)`.
     If no row changed, another consumer is building the same inputs, so stop. The `snapshot` row is created
     (`status='ready'`, `blob_key=NULL`) together with the household, so it always exists.
  4. Get an `EngineBatch` lease (`wait: true`; retry the message with a delay if there's none), and call `/build`.
     ✅ M10: the lease is taken *before* the claim (steps 3 and 4 swapped). A message waiting for a slot then never
     holds the claim, and a wait costs no D1 writes, which matters in the nightly burst.
  5. Compress, encrypt, and put the result at **`h/{household_id}/snapshot/{inputs_hash}.bin`**, a new key every time.
     ✅ M10: the key is `{inputs_hash}-{8 random hex}.bin`. A forced rebuild of the same inputs (backfill follow-up)
     would otherwise write the current pointer's key, and a superseded build would delete the live blob. The engine
     returns the gzip snapshot itself (`format: "gzip"`), so the Worker seals those bytes and never parses them.
     That avoids R2's 1-write-per-second-per-key limit and partial overwrites.
  6. **Compare-and-set** the pointer:
     `UPDATE snapshot SET blob_key=?, inputs_hash=?, market_date=?, status='ready', building_hash=NULL, built_at=? WHERE household_id=? AND building_hash=?`.
     If no row changed, a newer build claimed the household in the meantime. Delete our blob and stop: an older build
     can never overwrite a newer one.
  7. Delete the previous snapshot blob, and the household's `daily/` cache entries for the old `inputs_hash`.
  8. On error set `failed`, clear `building_hash`, and keep the previous blob.
  9. After the pointer switch, re-check the statement set. If it changed during the build, enqueue another debounced rebuild.
- **`GET /api/portfolio`:**
  - No snapshot yet: return the empty state (onboarding).
  - Snapshot has an older `market_date` than the current one: return it with `stale: true` and enqueue a rebuild.
  - **Stream, don't parse.** Decrypt, then pipe through `DecompressionStream`, or send the gzip body as is with
    `Content-Encoding: gzip`. The `stale`/`building` flags go in response headers (`X-Snapshot-Stale`,
    `X-Snapshot-Building`) and the SPA merges them in. That keeps Worker CPU and memory flat, whatever the portfolio size.
    ✅ VERIFY (M10, `wrangler dev` + curl): with `encodeBody: "manual"` the bytes on the wire are identical to what the
    Worker sent (same SHA-256), and one gunzip gives the JSON. Without it, workerd gzips the body a second time. A client
    without `Accept-Encoding: gzip` gets the body through `DecompressionStream` (still not parsed). Staging re-check
    after the M10 merge.

### 10.3 Market data and stocks (cron + queues)

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `nav-ingest`, `nav-backfill`, `nav-repair` | see §10.4 | Official AMFI NAVs for every scheme into D1, several times a night. This replaces the old per-scheme mfapi refresh. |
| `snapshot-prebuild` | triggered when a market day becomes final (§10.4), at the latest `0 5 * * *` | Enqueue a rebuild for households with `last_active_at` in the last 7 days, with `sendBatch` (100 per call). The `rebuild` queue's `max_concurrency` and the `EngineBatch` cap set the drain rate, so this is the nightly burst handled at a steady pace. The per-message delay is spread over 0–30 min to smooth the wake-ups. |
| `stocks-monthly` | `0 5 10-20 * *` | §10.3.1. ✅ M11: until the AMC scrapers ship (M18) this cron is replaced by a daily BharatStock run, `stocks` at `0 4 * * *` (09:30 IST: after BharatStock's UTC day resets, before the 10:00 IST final NAV run and prebuild). ✅ M18: `amc` at `0 2 * * *` (07:30 IST, daily: each AMC is scraped once a month, retried daily until its month is out), then the 09:30 BharatStock run fills the gaps. |
| `cleanup` | `0 21 * * *` | Expire pending passwords and old quota windows. Drop `tracked_scheme` rows unseen for 90 days. Delete finished `parse_job` rows older than 7 days and expired Better Auth `session` / `verification` rows. Send DPDP inactivity notices and do erasures (§12). ✅ M14 (`src/lib/cleanup.ts`): also expired `rate_limit` rows, `audit_event` older than 400 days, SIP skips older than the member's newest statement, `nav_run` older than 90 days, and `stock_match` rows unwanted for 90 days with every `fund_portfolio` row (and R2 blob) no wanted row reads. Inactivity: 500 notices and 50 erasures per run. Each step fails alone (logged by class) |
| `tmp-sweep` | `15 * * * *` (hourly) | Parked PDFs past `expires_at`: delete the R2 object, set `expired`. Re-enqueue `queued` jobs whose message was lost (no change for 15 min). Counts only in logs. ✅ M8: also deletes leftover PDFs of finished jobs and recounts the parked PDFs for `EnginePool` (§10.1 D, as built). |

#### 10.3.1 Stocks inside funds: AMC scraper first, BharatStock fallback (D10)

SEBI requires every AMC to publish each scheme's portfolio monthly, usually within 10 days of month end, on the AMC
website (typically one Excel file per month, one sheet per scheme). We scrape **only AMCs that appear in
`tracked_scheme`**.

- **Adapter per AMC** in `engine/engine/stocks/scrapers/amc/<slug>.py`:
  ```python
  class Adapter(Protocol):
      slug: str                                   # "ppfas", "hdfc", ...
      def discover(self, month: str, http) -> list[str]: ...      # URLs of disclosure files for YYYY-MM
      def parse(self, content: bytes, filename: str) -> list[SchemePortfolio]: ...
  # SchemePortfolio = { scheme_name, as_of, holdings: [{ name, isin|None, sector|None, weight_pct, kind: "equity"|"debt"|"cash"|"other" }] }
  ```
  - Read Excel with **`python-calamine`** (fast; handles xls, xlsx and xlsb), with `openpyxl` as the fallback. Handle zip archives.
  - Map a sheet to a scheme by matching `scheme_name` to our tracked ISINs with the token matcher that already exists
    in `app/stocks.py` (`_tokens`, `_score`), with a threshold and a manual override map per AMC.
  - Store each scheme as `market/holdings/{isin}/{month}.json` and a `fund_portfolio` row with `source='amc'`.
- **Run.** The Worker cron calls the engine `/stocks/scrape?amc=<slug>&month=YYYY-MM` for each tracked AMC, one AMC at
  a time, at most 1 request per second per host, with a generic UA and respecting robots.txt. Results go to `scrape_run`.
- **Fallback.** After day 15, any tracked equity scheme with no `fund_portfolio` row for the latest month is fetched
  from **BharatStock** through the existing logic (match once, refetch only when coverage shows a newer month). That
  logic is now driven by the job instead of a thread, and keeps the `BHARATSTOCK_DAILY_LIMIT` budget in `quota` with
  subject `global`. These rows get `source='bharatstock'`.
- **Rollout.**
  1. Launch with BharatStock only.
  2. Add adapters for the 10 AMCs holding the most tracked schemes. Query `tracked_scheme` grouped by AMC to pick them;
     expected to include SBI, ICICI Prudential, HDFC, Nippon India, Kotak, Axis, UTI, Aditya Birla Sun Life, Mirae
     Asset and PPFAS.
  3. Add more AMCs over time.
- **VERIFY per AMC** (✅ M18, checked live 2026-11-27 for October 2026; each adapter file's header has the details):

  | AMC | Page and files | Bot protection / robots.txt | Terms of use | Status |
  |---|---|---|---|---|
  | SBI | ✅ the page's own POST `/ajaxcall/CMS/GetSchemePortfolioSheets`; one combined xlsx (119 schemes) | ✅ none; `?query` disallowed, so the version tag is dropped | ✅ general disclaimer, nothing on reuse | active |
  | ICICI Prudential | ✅ the page's own API (`apimf…/nms/v1/downloads/files`); one zip, 151 workbooks, 26 MB | ✅ none | ⚠️ voice-assistant terms forbid systematic extraction without consent; no site-wide clause | active |
  | HDFC | ✅ one xlsx per scheme on `files.hdfcfund.com` | ⚠️ www.hdfcfund.com: Akamai 403 to a plain client, robots.txt included | ⚠️ non-commercial / personal use only | **blocked** (fallback). The adapter can probe 68 known file names on the open files host, a way around the wall: off unless the owner decides otherwise |
  | Nippon India | ✅ one combined xls linked from the page | ⚠️ robots.txt `Disallow: /InvestorServices/Factsheets` covers the files folder | ✅ general disclaimer | **blocked** (fallback) |
  | Kotak | ✅ one xlsx per scheme through `java17vlbapi.kotakmf.com` | ⚠️ www.kotakmf.com: Radware bot manager challenge; the API host is open, but using it goes around the wall | ⚠️ unreadable (behind the wall); Kotak group sites say non-commercial only | **blocked** (fallback) |
  | Axis | ⚠️ files only listed by the page's `/cms/` API (upload ids and hashes in the URLs) | ⚠️ robots.txt `Disallow: /cms/` | ⚠️ personal, non-commercial use only; no storing a significant portion | **blocked** (fallback) |
  | UTI | ✅ the page's own API `/api/get-consolidate-portfolio-disclosure`; one zip (85 schemes in one 9,375-row sheet) | ✅ none | ✅ informational disclaimer only | active |
  | Aditya Birla Sun Life | ✅ the page's own JSON list; one zip per month (106 schemes) | ✅ none | ⚠️ no downloading or copying without written consent | active |
  | Mirae Asset | ✅ the page's own POST `/AjaxService/GetDownloadsData`; one xlsx per scheme (101) | ✅ none | ⚠️ personal, non-commercial use only | active (only wanted schemes' files are fetched) |
  | PPFAS | ✅ links on the page; one combined workbook (7 schemes) | ✅ none | ⚠️ non-commercial / personal use only | active |

  Every active adapter's October 2026 files parse with every scheme's weights at 95–105% (`engine.amc.cli`), and the
  AMFI names tested match the right scheme. **Terms: 6 of the 10 restrict commercial use or reuse without written
  consent.** ✅ Owner, 2026-11-27: scrape all of them anyway and accept the risk, so every environment runs
  `AMC_SCRAPERS: "all"` (the blocked ones stay blocked: bot walls and robots.txt are still respected). Checked from a laptop: Cloudflare egress may meet bot
  walls this didn't (a run then records `blocked`).
- **Snapshot.** The `stocks` section of the portfolio is built in the engine from these blobs (same shape as today's
  `stocks.snapshot`). `refreshing` becomes `true` when a tracked equity ISIN has no data yet.
- ✅ **M18, as built (rollout step 2)** — `worker/src/market/amc-scrape.ts`, `worker/src/market/amc/*`,
  `engine/engine/amc/*`, migration `market/0005_amc.sql`. Changes from the design above:
  - **The engine still never calls out.** Each adapter is split: `discover` is TypeScript in the Worker
    (`worker/src/market/amc/<slug>.ts`), parsing is Python in the engine (`engine/engine/amc`, with optional per-AMC
    hooks in `adapters/<slug>.py`). The Worker downloads the files through `AmcFetcher` (robots.txt, ≥ 1 s per host,
    the adapter's hosts only, redirects off them refused, 48 MB cap, bot walls → `blocked`) and posts each one to
    `POST /stocks/parse` on an EngineBatch slot with the AMC's wanted funds. So EngineBatch keeps no route to the
    internet, as decided in M10, and there is no `/stocks/scrape`.
  - **Which funds:** `stock_match` (the funds builds report, as in M11), not all of `tracked_scheme`. Each gets its
    fund house from AMFI's `scheme` list (`stock_match.amc`). The top 10 were taken from the expected list: staging
    holds one family's funds, too few to rank AMCs by.
  - **Matching** is in the engine (`engine.amc.match`): the stocks.py token matcher over the fund's display name and
    AMFI's name, with option and plan words ignored, best ≥ 0.6, a tie is no match, plus `OVERRIDES` per adapter.
  - **Rows** are the stocks view's existing shape (`{isin, symbol, name, sector, type, pct}`, type EQUITY /
    FOREIGN_EQUITY / MUTUAL_FUND_UNIT / DEBT / CASH / OTHER), so the engine's snapshot code is unchanged: builds key
    an AMC fund as `amc:{isin}` in `market.stocks`. The section decides the type (an `INE…` ISIN is a bond in the debt
    section), fractions are scaled to percent, negative cash (net payables) is kept so weights add to 100.
  - **The job:** one `amc` message on pf-market (single-flight, `job_lock` 'amc'), from the daily cron `0 2 * * *`
    (07:30 IST) and from builds that find new or waiting funds. The target month is the previous month (IST). An AMC
    is due while a wanted fund isn't covered for it and wasn't tried in the last 20 h, so each AMC is scraped once a
    month and retried daily until published. Not published yet and a fund has no data at all: the month before is
    fetched too. Every run writes `scrape_run` (ok / not_published / failed / blocked). One-file-per-scheme AMCs
    (Mirae) fetch only the files whose scheme could be a wanted fund.
  - **Fallback** (`amc/coverage.ts` `amcCovers`): BharatStock skips a fund when its AMC has an active adapter and it
    has AMC data for the target month, or it's before day 15 and the scraper hasn't tried it yet or has older data to
    show. A fund the scraper tried and found nothing for goes to BharatStock straight away. An AMC row replaces a
    BharatStock row for the same month; BharatStock never overwrites an AMC row.
  - **Done when, not met yet:** ≥ 80% of tracked equity schemes from AMCs by day 15. On staging today (8 wanted
    funds, one family) 2 are under active adapters, 2 under blocked ones (HDFC, Nippon, Kotak, Axis) and 4 under 2
    fund houses with no adapter: 25%. It depends on the owner's terms decision, the blocked AMCs and rollout step 3.
- ✅ **mfforecast, the last fallback (M18 follow-up, owner request 2026-11-27)** — `worker/src/market/mfforecast.ts`,
  migration `market/0006_mfforecast.sql` (`fund_portfolio.source` gains `'mfforecast'`, `stock_match.mff_at`).
  Free holdings API on RapidAPI (`GET /funds/{amfi_code}/holdings`, 500+ equity and hybrid funds, a month behind the
  AMCs). Researched alternatives: Punji (free: top 10 holdings, 20 funds a month), mfdata.in (down), the
  fund-disclosures project (API offline), FinAPI and mfapi.in (NAVs only).
  - ✅ VERIFY limits: RapidAPI's headers say 500,000 requests a month (hard limit); mfforecast's page says 1,000 an
    hour. We budget 900 an hour and 450,000 a month in `quota`, stop below 100 left, and a 429 spends the hour.
  - Runs at the end of the `stocks` job, for wanted funds the AMCs don't cover, with no data from the last two
    months, that BharatStock can't serve (no key, today's budget spent, no match, or failing). Each fund at most once
    a week. It never overwrites an AMC or BharatStock month; BharatStock replaces an mfforecast month.
  - Key: optional secret `RAPIDAPI_KEY` (not in `secrets.required`).
  - **Order kept: AMC → BharatStock → mfforecast** (owner asked for the most complete, least refused source first;
    checked 2026-11-27). mfforecast had 7 of staging's 8 wanted funds, all a month old (September on 27 November),
    and 3 of the 7 summed to only 86–92%, so it's the least complete. AMC files are complete and current; BharatStock
    is complete and current but limited to 50 calls a day, which only the gaps the AMCs leave spend. So mfforecast
    stays last: it fills in when BharatStock's day is spent, finds no match or fails.
- ✅ **M11, as built (BharatStock only, rollout step 1)** — `worker/src/market/stocks.ts`, migration
  `market/0003_stocks.sql`:
  - **Which funds.** The Worker doesn't classify funds. Each `/build` returns the funds its stocks view needs in
    `X-Engine-Stocks-Want`: base64url JSON `[[isin, display name], …]`, covering the equity holdings plus the funds held
    inside them (fund-of-funds units, one level deep). The rebuild consumer upserts them into `stock_match`, refreshing
    `wanted_at` at most daily. Funds not wanted for 90 days drop out. That table is public data only, like `tracked_scheme`.
    So the match uses the engine's display name, as the old app did, not AMFI's scheme name.
  - **The job** is one `stocks` message on `pf-market`, single-flight through `job_lock`. A message that finds the lock
    held is retried in 60 s. A request during a run gets one more pass (up to 3). A message is sent when a build finds
    a new fund or one still waiting and the budget isn't spent, and also by the daily cron. One message is outstanding
    at a time; one lost for 15 min is sent again.
    The job searches each fund once (unmatched ones again after 30 days), fetches per portfolio name (direct and regular
    plans share one fetch), and refetches when the free coverage list shows a newer month (cached daily in
    `stock_coverage`). It writes one blob per ISIN and month plus the `fund_portfolio` row, and bumps
    `stock_state.version`, which is part of every snapshot's inputs hash.
  - **Budget.** One `quota` unit per paid call (subject `global`, metric `bharatstock`), taken before the call is sent.
    The window is the **UTC** day, because the provider's day is UTC (`QuotaSpec.utc`). A 429 uses up the rest of the
    day. Errors: a 4xx marks that one fund failed for a day; a 5xx or network error stops the pass, and the queue retries.
  - **Builds** load the held funds' `stock_match` + latest `fund_portfolio` row + R2 blob, then one more round for the
    funds inside them, and pass them as `market.stocks`. A fund still waiting (and budget left) asks for the job and
    a follow-up build (the same 2-min follow-ups as NAV backfills).
  - ✅ VERIFY (BharatStock API, 2026-11-26): the response fields match the old app (`scheme_name`, `fund_house`,
    `portfolio_date`, `pagination.total_pages`, rows with `isin`, `symbol`, `company_name`, `sector`,
    `instrument_type`, `pct_of_aum`). `page_size` above 100 is a 422. `/v1/mf-coverage` needs no key and lists
    82 fund houses with `latest_month`.
  - The key is an optional secret (`BHARATSTOCK_API_KEY`, not in `secrets.required`). Without it the stocks view is
    off (`enabled: false`) and nothing is fetched.

---

### 10.4 NAV data service (D15)

This is our own daily NAV store for every mutual fund scheme. It feeds daily returns (§10.5), the value chart, fund
returns and the Nifty comparison. The rest of this section is *public market data* and holds nothing about users.

#### 10.4.1 Sources (tested 2026-11-24 🧪)

| Source | What it gives | Observed | Use |
|---|---|---|---|
| **AMFI daily file** `https://www.amfiindia.com/spages/NAVAll.txt` (✅ M9: now a 302 to `https://portal.amfiindia.com/spages/NAVAll.txt`, which the Worker fetches directly) | The latest NAV of every open scheme. Semicolon separated, 8 columns: `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date`. Category and AMC header lines and blank lines appear in between. | 1.5 MB, 14,481 scheme rows, 1 `N.A.` NAV, stale dates for wound-up schemes. **It fills in gradually overnight.** At 23:24 IST on 24-Nov only 714 rows had 24-Nov and 8,098 still had 23-Nov. | **Primary**, for daily ingest |
| **AMFI NAV history report** `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=DD-Mon-YYYY&todt=DD-Mon-YYYY` (add `&mf=<AMC id>&tp=1` for one AMC) | Historical NAVs. The column order differs: `Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date` | All schemes for one day: 8,841 rows, 1.2 MB, 2.2 s. One AMC for 3.5 months: 15,936 rows, 2 MB, 3.6 s | **Repair and fallback backfill.** ✅ M9: **range limit between 107 days (works) and 153 days (refused)**, so 90-day chunks. A refused range answers **200 with an HTML page**, so the parser rejects any body without the report header. Data from 2019 is served. **83 AMC ids** read from the fund-house list in `https://www.amfiindia.com/net-asset-value/nav-history`, kept in `worker/src/market/amc-ids.ts`; 55 of the 56 AMC lines in NAVAll match by name (`IL&FS Mutual Fund (IDF)` has no id). Without `tp=1` the report also has close-ended and interval schemes |
| **mfapi.in** `https://api.mfapi.in/mf/{code}` | The full history of one scheme in one call | ~130 KB per scheme | **Backfill** when a scheme is first tracked. It's a community API, so keep fetches gentle: ≤ 4 concurrent, generic UA |

✅ M9 findings (2026-11-26, live fetches):
- **24-Nov-2026 was a market holiday** (Guru Nanak Jayanti), and 21-Nov a Saturday. On those dates only the daily-NAV
  funds (overnight, liquid) publish: 714 and 606 rows in the history report, against 8,273 for 25-Nov (1.1 MB, 1.8 s).
  So the "714 rows at 23:24 IST on 24-Nov" observation above was the holiday, not a slow night. Finality (§10.4.3) and
  `/api/market/status` treat a date with under half the recent busiest day's rows as a non-business day.
- NAVAll.txt on 26-Nov: 14,481 rows, 8,783 dated 25-Nov, 837 distinct dates (wound-up schemes keep their last one).
  **241 rows have a NAV of `0`** (no `N.A.` that day); they are dropped like `N.A.`. Empty ISINs are `-` in NAVAll and
  empty in the history report. Lines are CRLF, and "blank" lines can hold one space.
- mfapi answers an **unknown code with 200 and `data: []`**, so an empty answer also falls back to AMFI's history.
  Its history skips holidays (no 24-Nov row).

Every source keys rows by **AMFI scheme code** and includes **ISINs**. So demat-only (CDSL) holdings map straight to a
code through the ISIN, and mfapi's scheme list is no longer needed.

#### 10.4.2 Tables (D1 `pocketfolio-market`, migration `migrations/market/0002_nav.sql`)
Codes and dates are stored as **INTEGER** (`amfi_code` as a number, `date` as `YYYYMMDD`, e.g. `20261124`). Compared with
TEXT this makes `nav` rows roughly a third smaller and the keys faster to compare (⚠️ measure after the first month). The
Worker converts to ISO strings at the API edge. `tracked_scheme.amfi_code` (§6) is INTEGER too.
```sql
CREATE TABLE scheme (                      -- refreshed by every nav-ingest run
  amfi_code     INTEGER PRIMARY KEY,
  isin_growth   TEXT,                      -- "ISIN Div Payout/ ISIN Growth" column; NULL when "-"
  isin_reinvest TEXT,
  name          TEXT NOT NULL,
  amc           TEXT,                      -- from the AMC header line above the row
  category      TEXT,                      -- from the "Open Ended Schemes(...)" header line
  plan          TEXT, option TEXT,
  latest_nav    REAL, latest_date INTEGER,   -- YYYYMMDD
  updated_at    INTEGER NOT NULL
);
-- Upsert so unchanged rows aren't rewritten 4 times a night (each rewrite counts as rows written and holds the DB):
-- INSERT … ON CONFLICT(amfi_code) DO UPDATE SET latest_nav=excluded.latest_nav, latest_date=excluded.latest_date,
--   updated_at=excluded.updated_at, name=excluded.name, … WHERE excluded.latest_date > scheme.latest_date
--   OR excluded.name <> scheme.name;
CREATE INDEX scheme_isin_growth   ON scheme(isin_growth);
CREATE INDEX scheme_isin_reinvest ON scheme(isin_reinvest);

CREATE TABLE nav (
  amfi_code INTEGER NOT NULL,
  date      INTEGER NOT NULL,              -- YYYYMMDD
  nav       REAL NOT NULL,
  PRIMARY KEY (amfi_code, date)
) WITHOUT ROWID;

CREATE TABLE market_day (                  -- one row per NAV date: how complete it is
  date            INTEGER PRIMARY KEY,     -- YYYYMMDD
  schemes_updated INTEGER NOT NULL,        -- all schemes with a NAV for this date
  tracked_total   INTEGER NOT NULL,        -- schemes anyone holds (tracked_scheme)
  tracked_updated INTEGER NOT NULL,
  final           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE nav_backfill (
  amfi_code INTEGER PRIMARY KEY,
  status    TEXT NOT NULL CHECK (status IN ('pending','done','failed')),
  source    TEXT,                          -- 'mfapi' | 'amfi_history'
  rows      INTEGER, from_date INTEGER,
  at        INTEGER NOT NULL
);
```
- **What gets stored daily: all schemes**, not just tracked ones.
  - That's about 14.5k new rows a night, roughly 3.6M a year at ~25–40 B each, so about 100–150 MB a year
    (⚠️ measure after the first month). The market DB's own 10 GB limit (D17) lasts decades.
  - Writes: ~435k a month, against 50M included.
  - The benefit: when someone uploads a fund nobody held before, today's and yesterday's NAVs are already there.
- **Full history only for tracked schemes**, backfilled on first sight, plus benchmark `120716`.
  - 3,000 tracked schemes × ~3,000 days is about 9M rows, about 400 MB.
  - It's a one-off write that fits within the included quota.
- `tracked_scheme` (§6) gains an `amfi_code` resolved from `scheme` by ISIN when a statement is stored.
- ✅ M9, as built in `migrations/market/0002_nav.sql`: the four tables above, plus `nav_anomaly` (the ±20% side table,
  §10.4.4) and `nav_run` (one row per scheduled fetch, for the "fetched nothing twice" alert). `scheme.latest_nav` and
  `latest_date` are nullable (a scheme whose NAV is dropped is still listed, for ISIN lookups).
- ✅ M9: **rows go in as one JSON array per statement, read with `json_each(?1)`**, instead of 30 bound rows: 2,000 NAV
  rows or 400 scheme rows per statement, one or two bound parameters each. Checked on the real staging D1: one
  statement took a 52 KB NAV array and a 98 KB worst-case scheme array (the 400 longest names) in 0.7 ms. A whole
  night's file is then one `batch()` (one transaction, one query toward the 1,000 per invocation), so the
  "split through the queue near 1,000 queries" step isn't needed.

#### 10.4.3 Jobs

| Job | Schedule (UTC → IST) | What it does |
|---|---|---|
| `nav-ingest` | `30 17 * * *` (23:00), `30 20 * * *` (02:00), `30 1 * * *` (07:00), `30 4 * * *` (10:00, late overseas FoFs) | 1. One fetch of `NAVAll.txt`. 2. Parse it (§10.4.4). 3. Upsert `scheme`, skipping unchanged rows (§10.4.2). 4. Insert `nav` rows `ON CONFLICT DO NOTHING`, 30 rows per statement (D1 allows ≤ 100 bound params), in `batch()` calls, split through the queue if a run gets near 1,000 queries. 5. Recompute `market_day` for the dates touched. 6. Write the R2 series for tracked schemes that changed. 7. Mark a date `final` when `tracked_updated / tracked_total ≥ 0.98`, or at the 10:00 IST run. Becoming final triggers `snapshot-prebuild` once for that date. Re-runs are no-ops. |
| `nav-backfill` | Queue message when a new `tracked_scheme` appears | mfapi full history into `nav`. On failure, use the AMFI history report for that scheme's AMC in 90-day chunks back to the first transaction date found in statements (pass only the date, no user data). Set `nav_backfill.status`. |
| `nav-repair` | `0 3 * * SUN` (Sunday 08:30; Cloudflare rejects `0` for Sunday) | For the last 30 business days, find tracked schemes missing a NAV on a date where `market_day.schemes_updated` is high. Fetch the AMFI history report for those dates and insert. Log counts only. |

Scheduled runs handle failures this way: retry with backoff, log `error_class`, and raise an alert when a run fetches
nothing two times in a row.

✅ M9, as built in `worker/src/market/` (`amfi.ts` parsers, `store.ts` D1/R2 writes, `jobs.ts` jobs and the `pf-market`
consumer):
- **nav-ingest:** one fetch (3 tries, 2 s then 8 s backoff on network errors, 429 and 5xx), then one batch: anomalies
  against `scheme.latest_*`, NAV rows (`ON CONFLICT DO NOTHING RETURNING`, so the inserted rows are known exactly),
  the scheme upsert, tracked ISINs resolved to codes, and `nav_backfill` rows marked `pending` for tracked codes (plus
  the benchmark) that have none. A second batch updates `market_day` for the dates that got rows, makes dates final,
  and reads the tracked set. Then `pf-market` messages: backfills, and series rewrites (20 codes each).
  Measured under `wrangler dev` on the real file: first run 14,240 rows inserted, 14,481 schemes, 1.8 s wall
  (≈0.9 s is the fetch); a re-run inserted 0 rows and rewrote 0 schemes in 0.8 s.
- **market_day** only keeps dates within 45 days (older dates come from wound-up schemes). `schemes_updated` adds the
  rows each ingest or repair stored; `tracked_*` is recounted exactly when a date gets rows. A tracked scheme whose
  latest NAV is over 14 days older than the date (wound up, merged) doesn't count toward its total, so it can't hold a
  date back. **Final:** `tracked_updated ≥ 98%` of `tracked_total` (with `tracked_total > 0`), or the 10:00 IST run,
  which makes every non-final date up to the file's latest final. `UPDATE … WHERE final = 0 RETURNING` hands each date
  to `marketHooks.onFinal` exactly once; M10 enqueues `snapshot-prebuild` there.
- **The tracked set** (used by series, backfill and coverage): `tracked_scheme` codes seen in the last 90 days, plus
  benchmark `120716`.
- **nav-backfill:** sent once per code when an upload first tracks it (with the earliest transaction date for its
  ISINs, a date only) or by nav-ingest (no date: 5 years back). mfapi first (2 tries); an error or an empty answer falls
  back to AMFI's report for the scheme's AMC (`mf=` from `amc-ids.ts`) in 90-day chunks from that date (not before
  1-Apr-2006). A chunk with no report is skipped. Rows and anomalies (found over the whole series) go in one batch with
  `nav_backfill` → `done`. Then the R2 series. A failure retries with backoff (60 s doubling, ≤ 15 min); the 5th attempt
  marks it `failed` and acks (no DLQ). nav-ingest re-sends `pending` rows untouched for 6 h (a lost message);
  nav-repair re-sends `failed` ones after 7 days.
- **nav-repair** (Sunday): looks 45 calendar days back. A date is "full" when it has at least half the window's busiest
  day's rows. One `repair` message per full date where a live tracked scheme (one with an earlier NAV) has none, and
  per weekday with no `market_day` row at all (every run missed it; a holiday found this way gets a low row and isn't
  asked again). A repair stores AMFI's all-scheme report for that one day like an ingest, without the scheme upsert.
- **R2 series** `market/nav/{amfi_code}.json` = `{ amfi_code, dates: ["YYYY-MM-DD", …], navs: [...] }`, oldest first,
  rebuilt in full from D1 (ISO dates, as the engine's `NavSeries` takes them). Read from the primary
  (`withSession("first-primary")`), since the rows were just written.
- **Logs** carry counts, dates, sources and error classes, never scheme codes: a backfill logged right after an upload
  would tie that household to a fund it holds (§0.1). The alert is the log line `nav_fetch_alert` (M16 alerts on it).

#### 10.4.4 Parsing rules (`worker/src/market/amfi.ts`, pure and unit-tested)
- **Lines:**
  - A line with 8 `;` fields whose first field is digits is a NAV row.
  - A line starting with `Open Ended`, `Close Ended` or `Interval Fund` sets the current category.
  - Any other non-blank line sets the current AMC.
  - Skip the header row and blank lines.
- **Values:**
  - Drop `N.A.` and non-positive NAVs.
  - `-` or an empty ISIN becomes `NULL`.
  - Parse the date `DD-Mon-YYYY` to the `YYYYMMDD` integer.
  - A NAV date in the future is dropped.
- **History report:** the same rules with its own column order. Parse by header names, not positions.
- **Sanity:**
  - A day-on-day move over ±20% is stored but flagged in an `anomaly` side table. Typical causes are a split,
    merger, IDCW record date, or an AMFI typo.
  - Daily returns show flagged days with a ⚠ note (§10.5).

### 10.5 Daily returns (D15)

**Goal:**
- "Today: **+₹2,340 (+0.42%)**" on the overview, for everyone or for one member.
- A 1-day change per fund.
- A history of daily changes over 1M, 3M and 1Y, as a bar chart and a calendar.

#### 10.5.1 Units over time (engine, in the snapshot)
- **Full transaction history** (CAMS/KFintech detailed statement): an exact `units_timeline`, with one point per
  transaction date from the running balance. `units_exact: true`.
- **CDSL only:** points at each CDSL statement date, taken from the holdings in each monthly statement. Between points
  units are assumed constant. `units_exact: false`.
- **After the latest statement date** (🔒 owner change, 2026-11-26, M12; this replaces "units are assumed constant"):
  the dashboard shows the portfolio as of today from the last statement, without asking for an upload every month.
  Code: `engine/engine/projection.py`.
  - **Estimated SIP instalments.** Each active SIP is rolled forward on its mandate day. Walking back from the
    latest instalment, keep the days each one could have been due on (its date, or a weekend/holiday just before it)
    and stop at the first that doesn't fit, which is where the date was changed. (M12 fix, owner's case: three SIPs
    moved from the 20th to the 24th in June. The first rule, the most common day over a year, still said 20th, so
    their November instalments weren't estimated.) Every due date after the
    statement and up to today is an estimated instalment. Its units are the amount after 0.005% stamp duty, divided by
    the NAV of its run day. They're added to `units_timeline`, `units`, `invested` and the XIRR `cashflows`, and listed
    in `activity` with `estimated: true`. Irregular and stopped SIPs aren't estimated.
  - **Run day, as brokers do it.** ✅ AMFI "Payment modes and their efficiency", Annexure A2: NACH/e-NACH debits on
    T (the SIP date) and allots on T. Auto-debit and internet SIP allot on T+1. KFintech's SIP TAT table for
    non-liquid schemes gives NACH T debit, T+1/T+2 allotment, and internet SIP T+2. A due date on a weekend or
    exchange holiday runs on the next business day, at that day's NAV.
  - **The holiday calendar** (owner request: "a job that checks for holidays"). ✅ 2026-11-26: Upstox's public
    market-holidays API (`https://api.upstox.com/v2/market/holidays`, no key) lists NSE/BSE closures as JSON. NSE's
    own API turns away automated clients, and its circular is a PDF. Its 2026 list (16 NSE trading holidays) matches
    the NAV store: every past date has no NAV for an equity fund, except 31 Mar (financial-year end: NAVs are
    published, but the exchange and SIPs are closed). The job `refreshHolidays` (`worker/src/market/holidays.ts`)
    rides the daily `0 4 * * *` cron and fetches at most weekly into `market_holiday` (migration
    `market/0004_holiday.sql`). The next year's dates arrive once the exchanges publish them in December. A failed
    fetch keeps the stored dates and retries the next day. Each build sends the dates from 400 days back on
    (`market.holidays`, part of the inputs hash, so a new holiday rebuilds). The engine falls back to its own 2026
    list (`engine/engine/holidays.py`) when none are sent. Past weekdays with no NAV for the fund also count as
    holidays.
  - **Status, as the broker shows it.** An instalment is `in_progress` from its run day T until units show (T+2
    business days, the latest in KFintech's table), then `done`. Its units count in the value as soon as T's NAV is
    out. Until then it's `pending`: debited but not yet valued. Each SIP carries `next_date` (the run date),
    `next_due`, `next_moved` (`weekend` / `holiday`) and its `latest` instalment with `status` and `units_by`.
  - **Today's value.** Every coded mutual fund is valued at its latest NAV (`units`, `nav`, `value`, `as_of` move to
    that day). The statement's own figures stay in `holding.statement`, and members get `statement_total`,
    `value_date` and `estimated` totals. The month-end chart carries on to the latest NAV when it already covers every
    fund. ETFs and shares keep the statement's value.
  - **A newer statement replaces every estimate:** estimates only ever start after the newest statement date.
  - **Deploys that change the build** bump `SNAPSHOT_VERSION`. Each snapshot row records the version it was built
    with (`snapshot.version`, `app/0007`), and an older one counts as stale, so the next read rebuilds it (M12 fix:
    the bump alone didn't, until the next market day).
  - **Skip and cancel** (owner decision, 2026-11-26, instead of a time limit on estimates). As at brokers, the user
    can skip the **next** instalment only (one per SIP, undoable until its date), or cancel a SIP for good, after a
    confirmation saying it can't be undone. PocketFolio doesn't place or stop SIPs, so both only record what the
    user did with their broker or fund house, and the dialog says so. Skipped instalments and anything due on or after
    a cancel aren't estimated, and the SIP shows "Skipping 24 Dec" or "Cancelled". A newer statement that shows
    instalments after a cancel wins. Stored in `sip_override` (migration `app/0006_sip_override.sql`): the SIP (ISIN,
    folio) is sealed with the household key, with an HMAC to find it again. Rows go with the member and household
    (FK cascade). Sent to `/build` as `overrides` and part of the inputs hash. Routes: `POST /api/sips/skip`,
    `DELETE /api/sips/skip`, `POST /api/sips/cancel` (`confirm: true` required), each audited and followed by a
    rebuild.
  - Tax figures (`tax`, `analysis.harvest`) stay as of the statement.
- **ETFs and shares held in CDSL** (`asset_type == "equity_or_bond"`) have no AMFI NAV. They're excluded and listed
  as "not included".

#### 10.5.2 Calculation (`worker/src/lib/daily.ts`, a pure function with golden tests)
For each holding *h* and each NAV date *d* in the window, where *p* is the previous NAV date for that scheme:
- `units_h(d⁻)` is the units held at the **start** of day *d*, i.e. after transactions dated before *d*. Units bought
  on *d* earn nothing until the next day, so a purchase or redemption is never counted as a gain or loss.
- `change_h(d) = units_h(d⁻) × (nav_h(d) − nav_h(p))`
- `value_h(d) = units_h(d) × nav_h(d)`

Portfolio totals:
- Day change: `Σ change_h(d)`.
- Day %: `Σ change_h(d) / Σ units_h(d⁻) × nav_h(p)`, over holdings that have a NAV on both *d* and *p*.

Edge cases:
- **Weekends and holidays** have no NAV rows and produce no point.
- **"Today"** uses each scheme's latest NAV date. If some tracked funds haven't published yet, the result is
  `coverage = { updated: 22, total: 24 }` and the UI labels the total "so far".
- **IDCW payout** plans drop on record date. If the statement shows a dividend payout on that date, add it back.
  Otherwise flag the day.

#### 10.5.3 Endpoint
`GET /api/portfolio/daily?days=30&member=all`
0. **Cache first (from v1, not deferred).** Look for `h/{household_id}/daily/{inputs_hash}_{latest_nav_date}_{member}.bin`
   and return it if it's there (one R2 read). Store the full 366-day series per member key and slice `days` from it.
   Why: this endpoint is the largest D1 read load in the design. It reads ~13k rows per call, and on a single-threaded DB
   a 10–20 ms query caps it at ~50–100 calls a second (§3.4). A morning burst of users opening the app would hit that.
1. Read and decrypt the snapshot to get `amfi_code` and `units_timeline` per holding.
2. Run one query on **`MARKET`** per ≤ 90 codes: `SELECT amfi_code, date, nav FROM nav WHERE amfi_code IN (…) AND date >= ?`.
   Use `MARKET.withSession("first-unconstrained")` so read replicas serve it (D17). The window starts one NAV date
   before the range. That's about 50 funds × 260 days ≈ 13k rows.
3. Run `dailySeries()`, write the cache blob (compressed and encrypted, D18), and return:
```jsonc
{
  "as_of": "2026-11-24",
  "coverage": { "updated": 22, "total": 24 },
  "today": {
    "change": 2340.5, "pct": 0.0042,
    "by_member": [{ "member_id": "…", "change": 1800.2, "pct": 0.0051 }],
    "by_fund":   [{ "isin": "…", "change": 640.1, "pct": 0.011, "nav_date": "2026-11-24" }]
  },
  "series": [{ "date": "2026-10-27", "value": 551200.0, "change": -1240.4, "pct": -0.0022, "flag": null }],
  "notes": { "units_as_of": "2026-11-12", "units_exact": false, "excluded": ["ETFs and shares"] }
}
```
- **Invalidation.** The key includes `inputs_hash` (new statements) and `latest_nav_date` (new NAVs), so stale entries
  are never read. The rebuild deletes old entries (§10.2 step 7). While coverage is partial ("22 of 24 funds"), cache
  with a 30-minute freshness check instead, so late NAVs show up.
- ✅ Measured in M12 (vitest/workerd, local): a 50-fund household with a year of NAVs (~19k rows) takes 57 ms
  uncached and has a cached p95 of 3 ms. A 2-fund household: 7–11 ms uncached, 3 ms cached p95. A cached call is one
  D1 read (the snapshot row) plus one R2 read, with no MARKET read.
  ✅ Staging, 2026-11-26 (real statement, `Server-Timing`): the R2 read added ~250 ms per cached call, so the sealed
  blob now also sits in the edge cache (Cache API, a day). The endpoint's own work is now **4 ms p50** (edge read,
  decrypt, slice); the p95 check passes. The full server time was 223 ms p50, of which 220 ms is the D1 snapshot-row
  read every signed-in endpoint makes. The test machine reaches Cloudflare through Marseille (MRS) while the staging
  D1 is in APAC, so that read crosses continents. Re-measure from India in the M16 load test.
  The NAV read is one statement with a `json_each` list instead of ≤ 90-code chunks, so there's no bound-parameter
  cap, plus the window's `nav_anomaly` rows in the same batch.
- Market days for the window come from the household's own funds: a date counts when more than half of the funds
  alive then have a NAV for it (`market_day` only keeps recent dates). The latest market date always counts.
- The dashboard loads `/api/portfolio` first, then `/daily` in parallel for the Today tile. The overview never waits
  on it.

#### 10.5.4 UI (same design system, §13)
- **Overview bento, "Today" tile.** Use the same `Panel` look as the other tiles:
  - a large signed ₹ change in the gain or loss colour, with a % pill;
  - "NAV of 24 Nov" in muted text;
  - a 30-bar mini chart of daily changes;
  - while coverage is partial, "22 of 24 funds updated · rest after 11 PM".
  - Tapping it opens the Daily returns view.
- **Holdings table.** A new **1D** column (₹ and %), sortable. On mobile it shows under the value.
- **Daily returns panel** (Insights):
  - a `Segmented` control for 1M, 3M and 1Y;
  - a Recharts bar chart of daily change;
  - a month calendar heatmap with gain/loss tokens at 3 intensities;
  - best day, worst day, and % of positive days.
  - The member filter applies.
- **Honesty note** (muted text with a tooltip): "Estimated from daily NAVs and your units as of 12 Nov, plus 2
  estimated SIP instalments (₹20,000) since then." When `units_exact` is false, add "(from your CDSL statement)". The
  tooltip says a newer statement replaces the estimates. It never asks the user to upload one.
- **SIPs (M12, owner request).** Upcoming SIPs, the SIP page and the fund dialog show the run date, "Moved from 24 Nov
  (market holiday)" when it moved, and "In progress · debited 25 Nov · units by 27 Nov" for an instalment still being
  processed. The overview hero says the value is at the latest NAV with N estimated instalments. Estimated rows in
  Transactions say "Estimated".
- **Market-day hint.** Before the first NAV of the day lands, show "Today's NAVs usually arrive after 9 PM" instead
  of a 0.

## 11. Fair-use limits (D7)

| Limit | Value | Enforced by |
|---|---|---|
| Members per household | 10 | D1 count |
| Statements per member | 24 kept; the oldest beyond that are deleted after a newer one of the same kind arrives | upload handler |
| Uploads | 20 per day, 100 per month per user | `quota` |
| Failed parses (wrong password, etc.) | 10 per hour per user | `quota`, then 429 "Try again later" |
| Open parse jobs (queued, parsing) | 10 per household | `parse_job` count, then 429 "Finish the uploads in progress first" |
| Parked PDFs, all users | 50,000 objects or 5 GB in `tmp/` | `EnginePool` counter. Above it, uploads get 503 + `Retry-After` and nothing is stored (protects R2 and the 24 h promise if the engine is down). ✅ M8: taken in the same `acquire` call that queues the upload; `503 queue_full`, `Retry-After: 60`; tmp-sweep recounts it from D1 hourly |
| Status polling | `Retry-After` 1 → 10 s, set by the server | the SPA follows it; the IP rate limit catches clients that don't |
| API requests | 120 per 60 s per user; 300 per 60 s per IP | Rate Limiting binding (approximate, per location) |
| Magic-link requests | 5 per hour per email, 20 per hour per IP, plus Turnstile | Better Auth rate limit + binding |
| Device codes | 10 per hour per IP | binding |
| Export | 3 per day | `quota` |

Show the limits in Settings, using the existing UI style. Return 429 with a friendly `message` and a `retry_after`.

✅ M6: `src/lib/quota.ts` `takeQuota(env, specs)` takes one unit from several counters all-or-nothing in one D1 batch.
At the limit the UPSERT writes NULL into the NOT NULL `count`, which fails the statement and rolls the batch back, so
there's no read-then-write race (tested: 30 parallel takes at a limit of 20 give exactly 20). Windows are IST hours,
days and months; the refusal says which counter and the seconds until it resets.

---

## 12. Privacy and legal (DPDP Act 2023 + DPDP Rules 2025)

**Timeline:**
- The rules were notified on 2025-11-13.
- **Most fiduciary obligations apply from 2027-05-13.**
- Build for them now; they are cheap now and expensive to retrofit.

| Obligation | Implementation |
|---|---|
| **Consent notice (Rule 3)** | A standalone, plain-English notice shown after first sign-in. It lists the data collected (email, name, PAN, holdings, transactions), the purpose (showing your portfolio and analytics), how to withdraw consent, your rights, and the grievance contact. "I agree" writes `consent(notice_version)`. Data routes stay blocked until then. A new notice version re-prompts. |
| **Security safeguards (Rule 6)** | Encryption (§8), access control (§9.1), and `audit_event` kept for at least 1 year. No PII in logs. Backups are D1 Time Travel only. |
| **Breach (Rule 7)** | Write `docs/INCIDENT_RESPONSE.md`. Notify affected users without delay. Send the Data Protection Board an initial notice, then a detailed report within 72 h. Report to **CERT-In within 6 h**. Keep a contact list and email templates. |
| **Uploaded PDFs** | Say it plainly in the consent notice and the privacy page: "We read your statement and keep only the parsed data, encrypted. Usually the PDF is never stored. When many people upload at once, it's held encrypted until it's processed, usually for minutes, and always deleted within 24 hours." The `tmp-sweep` job and the R2 lifecycle rule enforce this (§10.1). |
| **Retention and erasure (Rule 8)** | Data is erased on account deletion (immediately; backups within 30 days). Inactivity: after **3 years** with no login (owner, 2026-11-26), email a 48-hour notice, then erase. ✅ M14 (DSCI's DPDP retention FAQ and MeitY/PIB's notification summary; the gazette text itself, G.S.R. 846(E), wasn't read): the fixed 3-year period of Rule 8(1) and the Third Schedule binds only e-commerce entities and social media intermediaries with ≥ 2 crore registered users and online gaming intermediaries with ≥ 50 lakh, counted from the user's last contact or exercise of a right. Everyone else erases "as soon as it is reasonable to assume the specified purpose is no longer being served" (Act s. 8(7)), with no fixed period. PocketFolio isn't in those classes, so 3 years matches the strictest period the Rules name. Rule 8(2): tell the user at least 48 h before erasure that it happens unless they sign in. Rule 8(3) with Rule 6(1)(e): keep personal data, traffic data and logs for at least a year from processing, so `audit_event` is kept 400 days. Rule 8 applies from 13 May 2027. Lawyer to confirm (M17). |
| **Contact (Rule 9)** | A grievance/DPO contact on the privacy page and in the app footer. |
| **Rights (Rule 14)** | Access = export. Correction = re-upload or delete a statement. Erasure = delete account or member. Withdraw consent = delete account. Respond to emails within 90 days. |
| **Children (Rule 10)** | Terms require 18+ and there is a checkbox at consent. Minors' PANs can be added by a parent as members; the parent is the user. |
| **Cross-border** | Allowed (no blacklist notified). The privacy policy says data is stored on Cloudflare infrastructure, which may be outside India. |

**Pages to add** (styled like the app, §13):
- `/privacy`
- `/terms`, including **"Not investment advice; analytics only"**. The tax-harvest and health-check panels need
  this disclaimer inline too.
- `/security`, a short page on how data is protected
- the consent screen

The owner must provide the legal entity name, grievance officer name and email, and jurisdiction. Get a lawyer to
review before launch.

✅ M14 as built: the pages and the consent screen are in `web/src/pages/legal.tsx` and `consent.tsx`. The notice
version is `NOTICE_VERSION` in `worker/src/lib/consent.ts` and `web/src/lib/legal.ts`; they must match, and a bump asks
everyone again. The legal details are in `web/src/lib/legal.ts`: entity "PocketFolio"; questions and
complaints go to `support@pocketfolio.in`, answered within 30 days; no named officer and no court named (owner,
2026-11-26). User-facing text names no hosting provider or data location (owner); Rule 3 doesn't require either.
**The lawyer review is deferred about 6 months** (owner, 2026-11-26: no budget yet), so it no longer gates M17. The footer (every page, including /login) carries "Not investment advice" and the legal links. The tax-harvest
and health-check panels aren't in the UI yet; the fund dialog's tax split has the disclaimer inline. The emails ("Your
account was deleted", the inactivity notice) are in `src/lib/email.ts`. Breach plan: `docs/INCIDENT_RESPONSE.md`.

**Also rewrite the README "Privacy" section.** "Everything stays on this machine" is no longer true.

---

## 13. Frontend changes (keep the current design)

> **From M24 (D21), design system v2 replaces the rules below** (tokens, fonts, cards). M24 rewrites this section with
> the v2 reference. The layout, mobile, states and accessibility rules stay.

**Design consistency is required:**
- **Tokens and theme.** Use the tokens in `web/src/index.css` only: `bg-surface`, `ring-border`, `text-muted-foreground`,
  gain/loss and the chart colours. No new colours or fonts. IBM Plex Sans, the existing radius scale, and dark-first
  with the existing `ThemeToggle`.
- **Cards.** Build cards with the existing `Panel` pattern (`rounded-2xl bg-surface p-4 ring-1 ring-border sm:p-6`)
  and the bento grid from the overview. Use the existing shadcn components in `web/src/components/ui/` (Button,
  Dialog, Input, Label, Badge, Tabs, Segmented, Skeleton, Tooltip, Sonner toasts) and `lucide-react` icons.
- **Mobile.** New pages work at 360 px wide and reuse `BottomNav` and `TabNav` patterns. Touch targets are at least 44 px.
- **States.** Every screen has loading (Skeleton), empty and error states that look like the current ones.
- **Accessibility.** Labels on inputs, focus rings, AA contrast in both themes.

**New screens and changes:**
1. **`/login`**:
   - "PocketFolio" wordmark and the one-line pitch ("Your family's mutual funds, in one place.").
   - **Continue with Google** as the main (primary) button, since it needs no email (§7.3). Then an email field with
     **Email me a link** (Turnstile invisible widget, secondary button style), then a
     **Log in with QR** tab (shows the QR, the user code and a countdown; auto-refreshes on expiry).
   - "Check your inbox" state.
   - Links to the privacy policy and terms.
2. **`/link?code=…`**: the approval page (§7.4). If logged out, send to `/login?next=/link?code=…`.
3. **Consent screen**: a full-page panel with the notice, an 18+ checkbox and **I agree**.
4. **Onboarding (empty household)**:
   - A bento-style welcome panel explaining the two statement types (CDSL eCAS, CAMS/KFintech CAS).
   - The **Add statement** primary action.
   - Under it, "Don't have one? Get your CAMS/KFintech statement" (the guided manual flow), and **Fetch from CDSL with
     OTP — Coming soon** shown disabled with a `Badge`.
5. **Add statement dialog** (existing `add-statement-dialog.tsx`):
   - **Only the file and an optional password (D19).** No PAN field and no member picker. Copy: "Add any family
     member's statement. We'll file it under the right person automatically."
   - The password field is collapsed by default ("Has a password? Add it"). It opens automatically when the server
     answers `password_required`, with the hint from §10.1 A5. Most uploads in an existing household need no typing,
     because members' PANs and pending KFintech passwords are tried automatically.
   - On success, say whose portfolio it went to: "Added to <member name>" or "New member added: <member name>", using
     the holder name from the statement and the masked PAN. The user can rename the member in Members.
   - Progress: uploading → reading statement → updating dashboard. Poll `/api/portfolio/status` with backoff, following `Retry-After`.
   - **Queued state (`202`).** "In queue · about 2 min · 14 ahead of you", with a progress bar from `eta_s`, refreshed
     by polling `/api/jobs/:id` with backoff. "You can close this window; we'll finish it for you."
     **Cancel** calls `DELETE /api/jobs/:id`.
   - **Instant checks, before any upload is queued** (§10.1 A5): a missing or wrong password, an unrecognised
     statement or a full household shows inline in the dialog right away, while the user is still there ("That password
     didn't open this statement", "Upload a CDSL or CAMS/KFintech consolidated statement"). They fix it and resubmit.
     Nothing was stored.
   - A **Processing** list (top of Members/Statements) shows queued jobs with their ETA. If a job later fails (rare:
     only a parser problem can fail it now), show a toast on the next visit and the safe message with **Try again**,
     which re-opens the dialog. The file is already deleted.
   - The CDSL OTP tab becomes "Coming soon".
   - In `request-statement-form.tsx`, keep the manual path only and label automatic sending "Coming soon".
6. **Members**, in Settings or a new tab: rename, see statements per member (kind, as-of date), delete a statement,
   delete a member.
7. **Settings**:
   - Account (name, email, sign-in methods)
   - **Devices** (sessions list with a "New" badge on recently linked ones, sign out others, **Link a device** opening the scanner)
   - Fair-use usage
   - **Download my data**
   - **Delete account** (typed confirmation)
   - Theme
8. **App shell**:
   - An avatar menu in the header (Settings, Sign out).
   - A global 401 handler in `lib/api.ts` that redirects to `/login`.
   - A `stale` or `building` banner ("Updating to today's NAV…") in the current toast or inline style.
   - Remove the sandbox notice.
9. **Routing**: add a tiny router (`wouter` or React Router). Keep the existing tab state for the dashboard.
10. **Types**: `Member.id` is now a UUID. Nothing else in `Portfolio` changes shape, so existing components keep working.

---

## 13A. Installable web app (PWA) (D14)

The goal: users add PocketFolio to their phone home screen or desktop and check their portfolio in one tap. There is
no app store at launch.

### 13A.1 Make it installable
- **`web/public/manifest.webmanifest`:**
```json
{
  "id": "/",
  "name": "PocketFolio",
  "short_name": "PocketFolio",
  "description": "Your family's mutual funds in one place. Check today's change in one tap.",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0A0C14",
  "theme_color": "#0A0C14",
  "categories": ["finance"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [
    { "src": "/screens/mobile-today.png",  "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "Today's change at a glance" },
    { "src": "/screens/desktop-overview.png", "sizes": "1920x1080", "type": "image/png", "form_factor": "wide", "label": "Family overview" }
  ],
  "shortcuts": [
    { "name": "Today's change", "url": "/?view=today&source=shortcut" },
    { "name": "Add statement", "url": "/?action=add-statement&source=shortcut" }
  ]
}
```
  - The colours are the dark-theme `--background` from `web/src/index.css` (dark-first). ✅ M15: that is `#0A0C14`
    (light `#F2F3F7`); the `#0F1226` / `#F5F6FA` first written here were never in the CSS. Shortcuts carry the 192 icon.
  - Screenshots must use **demo data**, never real portfolios. Chrome shows them in its richer install dialog.
- **`web/index.html`:**
  - `<link rel="manifest" href="/manifest.webmanifest">`
  - `<meta name="theme-color" content="#F2F3F7" media="(prefers-color-scheme: light)">` and the `#0A0C14` dark
    version. ✅ M15: `ThemeColorSync` (in `components/pwa.tsx`) updates both metas whenever the theme changes, from the
    toggle or from Settings. `apple-mobile-web-app-status-bar-style` stays `default`: `black-translucent` paints white
    status-bar text, which is unreadable on the light theme.
  - `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">`
  - `<meta name="apple-mobile-web-app-title" content="PocketFolio">`
  - `viewport-fit=cover`
- **Safe areas.** In standalone mode, `BottomNav` and the header pad with `env(safe-area-inset-*)`.
- **Icons.** Generate them from `web/public/favicon.svg` with `@vite-pwa/assets-generator`. Keep the maskable safe
  zone at 80%. ✅ M15: `web/pwa-assets.config.ts`, `npm run icons`; the maskable and Apple icons sit on a full-bleed
  square of the favicon's own `#3D4DB7`, so launcher masks never show a second shape. Output is committed.
- **Service worker:** `vite-plugin-pwa` (Workbox `generateSW`) with `registerType: "prompt"`.
  - **Precache the app shell only:** HTML, JS, CSS, fonts and icons. `navigateFallback: "/index.html"`,
    `navigateFallbackDenylist: [/^\/api\//]`.
  - **`/api/*` is NetworkOnly.** Never put portfolio data in Cache Storage or IndexedDB: phones get shared and lost,
    and DPDP applies.
  - **Offline.** Show a panel in the app's style: "You're offline. Connect to see today's numbers."
  - **Updates.** When a new SW is waiting, show a Sonner toast: "A new version of PocketFolio is ready · Reload".
  - **Sign out** needs no cache purge, because no API data is cached. It clears in-memory state and returns to `/login`.
- **Worker headers.**
  - `manifest.webmanifest` is served as `application/manifest+json`; `sw.js` with `Cache-Control: no-cache`.
  - CSP gains `manifest-src 'self'; worker-src 'self'`. ✅ M15: the two headers come from `web/public/_headers`
    (Workers Static Assets reads it; checked under `wrangler dev`). There is no CSP yet; it arrives in M16 with these
    two directives already in its list (§17 Phase 6).
- **Installability.** Chromium checks for HTTPS and a manifest with name, 192 and 512 icons, `start_url` and
  `display`. Check it in DevTools → Application → Manifest and in Lighthouse. ✅ M15 (Chrome blog "Revisiting Chrome's
  installability criteria", read 2026-11-27): the fetch-handler requirement is gone for the menu's "Install app"
  (Chrome 108 mobile, 112 desktop) but still applies to `beforeinstallprompt`; the Workbox SW has one. Lighthouse
  dropped its PWA category, so the check is DevTools / CDP `Page.getInstallabilityErrors`: none in a normal profile
  (only `in-incognito` in a private one), and Chrome for Testing fired a real `beforeinstallprompt` on `vite preview`.

### 13A.2 When to ask (standard practice: after value, never on arrival)
Show the install prompt automatically only when **all** of these are true:
1. **Signed in, consented, and the dashboard has rendered a real portfolio** (at least one statement).
2. **A moment of value:** either this is a later session (on at least the 2nd day with a visit), or the user just
   finished a first successful upload and has spent 20 s or more on the dashboard.
3. **Not already installed.** That means none of: `matchMedia('(display-mode: standalone)').matches`,
   `navigator.standalone === true` (iOS), or a launch with `?source=pwa`.
4. **The platform can install** (§13A.3).
5. **Not dismissed in the last 14 days.** After 3 dismissals, never auto-show again.
6. **Nothing else is in progress:** no dialog is open and no upload is running. Show it at most once per session.

These conditions live in one pure function, `installEligibility(state)`, with unit tests. Its UI state is stored in
`localStorage["pf.install"] = { dismissals, lastDismissedAt, installed }`, which holds no personal data.

✅ M15: `installEligibility()` is in `web/src/lib/install.ts` (unit tests in `install.test.ts`, `npm test` in `web/`).
"A later session" counts distinct local days with a signed-in dashboard visit (`localStorage["pf.visits"] =
{ days, last }`). "The first upload just finished" means the household was empty earlier in this page load and now has
a portfolio. Only a prompt that opened by itself counts a dismissal (Not now, close, Escape, or "Got it" on the iOS and
Mac steps). "Busy" is any open dialog, the upload dialog, a rebuild in progress, or a hidden tab.

**Entry points that are always available**, with no nagging:
- Settings → **Install app**
- the avatar menu → **Install PocketFolio** (shown only when installable)
- ✅ M15: on Chromium these call the browser's own dialog straight away (the click is the user activation it needs);
  elsewhere they open the sheet with the steps, or a short note for in-app browsers and Firefox
- a small "Get the app" link in the login page footer, for returning users

### 13A.3 How, per platform

| Platform | Detection | Flow |
|---|---|---|
| Android Chrome, Edge, Samsung Internet; desktop Chrome and Edge | The `beforeinstallprompt` event fires | Call `e.preventDefault()` and keep the event. Show our sheet or card. On **Add to home screen**, call `deferred.prompt()`. It must run inside the click handler, or it fails without user activation. Await `userChoice`, then discard the event, which is single use. On `appinstalled`, set `installed` and show the toast. |
| iPhone and iPad (Safari; Chrome, Edge and Firefox on iOS offer it in their Share menu) | iOS UA (`iPhone`/`iPad`/`iPod`, or iPadOS's `Macintosh` UA with touch), not standalone | There is no API (WebKit doesn't support `beforeinstallprompt`). Show the instruction sheet (§13A.4) with the iOS Share icon. The arrow points at the bottom toolbar on iPhone Safari and the top bar on iPad. ✅ M15 (iOS 26 guides, 2026-11-27): in Safari's default compact tab bar Share sits behind **⋯**; the Bottom and Top layouts show Share directly. Then **Add to Home Screen** (scroll down; if missing, Edit Actions) and **Add**; "Open as Web App" is on by default. The copy says "If you don't see it, tap ⋯ first". Recheck on a device in the owner's manual install test. |
| macOS Safari 17+ | Safari UA on a Mac, not standalone | Instruction card: **File → Add to Dock** (or Share → Add to Dock) |
| Firefox desktop; in-app browsers (WhatsApp, Instagram, Gmail webviews) | No `beforeinstallprompt`; webview UA | Don't auto-prompt. In webviews, show a small note: "Open in Chrome or Safari to add PocketFolio to your home screen." |

Not used now: Chrome's `<install>` element and `navigator.install()`, which are origin trials in 2026. Revisit them
once they ship.

### 13A.4 Copy
These use the existing Dialog styles: a bottom sheet on mobile and a non-blocking card bottom-right on desktop, with
the PocketFolio icon, `Panel` surface and ring, `lucide-react` icons, and the primary and ghost Buttons.

**Mobile (Chromium):**
> **Your portfolio, one tap away**
> Add PocketFolio to your home screen and check today's gain or loss in a single tap. No searching, no typing the address.
> - ⚡ (`Zap`) Opens instantly, full screen, just like an app
> - 📈 (`TrendingUp`) Today's change for the whole family at a glance
> - 🔒 (`ShieldCheck`) Same secure sign-in. No app store, nothing extra to download
>
> **[Add to home screen]**  [Not now]

**Desktop:**
> **Install PocketFolio on this computer**
> Open it from your Dock, taskbar or Start menu and see your portfolio in one click.
> **[Install]**  [Not now]

**iPhone / iPad:**
> **Add PocketFolio to your Home Screen**
> Check your portfolio in one tap, right from your Home Screen.
> 1. Tap **Share** ⬆︎ in Safari's toolbar (at the bottom on iPhone, the top on iPad). If you don't see it, tap **⋯** first
>    (✅ M15, iOS 26)
> 2. Scroll down and tap **Add to Home Screen**
> 3. Tap **Add**
>
> You'll sign in once inside the app.
> **[Got it]**

**After install (toast):**
> **PocketFolio is on your home screen.** Open it any time for today's numbers.

**Settings row:**
> **Install app**: quick access from your home screen or desktop.

### 13A.5 Signing in inside the installed app (important)
- **iOS keeps a home-screen web app's cookies separate from Safari.** Users have to sign in again inside the app
  (✅ M15: still so per WebKit bug 181849 and current PWA references; iOS copies cookies once, at install time, then
  keeps them apart. The owner's iPhone install test confirms it end to end).
  - **Magic links open in Safari or Mail, not in the installed app**, so the session would land in the wrong place.
  - **Fix:** every sign-in email carries **both the link and a 6-digit code** (Better Auth `emailOTP` next to
    `magicLink`, §7.1).
  - In standalone mode, the login screen leads with "Enter the 6-digit code we emailed you". Google sign-in works
    inside the app.
- **Android and desktop** installed apps share the browser's cookies, so the session usually carries over. The code
  path covers the cases where it doesn't.

### 13A.6 Measure (no PII)
- ✅ M15: `POST /api/metrics { metric }` (signed in and consented; anything else is 400 `unknown_metric`) adds 1 to
  `metric_daily` (`migrations/app/0009_metric_daily.sql`: metric, IST date, count; no user or household column). One
  D1 batch with a per-account cap of 30 a day (a `quota` row, deleted with the account), and always 204. The web app
  sends each metric at most once per page load.
- **Counters** go in a new D1 table `metric_daily(metric, date, count)` (or Cloudflare Web Analytics custom events):
  `install_prompt_shown`, `install_accepted`, `install_dismissed`, `app_installed`, `launch_standalone` (from
  `start_url ?source=pwa`), `launch_shortcut`.
- **Target:** at least 15% of users with 3 or more sessions install the app. Tune the timing in §13A.2 from the data.

### 13A.7 Acceptance
- Lighthouse and DevTools show the app as installable.
- Manual installs work on Android Chrome, desktop Chrome and Edge, iOS Safari and macOS Safari. Shortcuts work on Android.
- Standalone mode respects safe areas and looks right in both themes, with no browser UI and the correct theme colour.
- Cache Storage contains no `/api/` responses (DevTools check after browsing every tab).
- The prompt never shows on first arrival, before sign-in, while installed, within 14 days of a dismissal, or after 3 dismissals.
- On iOS standalone, the email-code sign-in works end to end.

## 14. Engine (Python container)

- **Dockerfile:**
  - Base `python:3.12-slim`, `linux/amd64`. Install with `uv sync --frozen` from `engine/uv.lock` in a build stage.
  - Run as a non-root user, read-only root filesystem, `tmpfs` only for `/tmp`.
  - `uvicorn engine.server:app --host 0.0.0.0 --port 8080 --workers 1 --limit-max-requests 200`. The process exits
    after 200 requests and is restarted by a tiny supervisor loop in the entrypoint, which caps memory growth from
    pdfminer's caches. ✅ Verified in M1: uvicorn exits with code 0 at the limit, and `engine/entrypoint.sh` restarts it
    (and stops cleanly on SIGTERM). A request that arrives during the ~1 s restart fails to connect; the caller retries.
  - Keep the image slim (no build tools in the final stage) for faster cold starts. `isin.db` (49 MB) is the largest file.
- **Endpoints:** `/parse`, `/build` (JSON), `/stocks/scrape` (M18), and `/health` (returns `{version, isin_db, busy}`).
  See `engine/README.md` for the exact contract.
  - **`/parse` takes the raw PDF as the request body**, with the password base64url-encoded in `X-Pdf-Password` and the
    pre-checked type in `X-Statement-Kind`. ✅ Changed in M1: Starlette spools multipart uploads over 1 MB to a
    temporary file on disk, which would break "PDFs never touch disk". A raw body is read into memory only.
- **Internal auth.** It is reachable only through the Durable Object. It still requires the header
  `X-Engine-Key: <ENGINE_SHARED_SECRET>` (container env secret), compared in constant time.
- **Logging.** Keep the current policy: error class names only. Turn off uvicorn access logs, because query strings and
  paths are not sensitive but noise. Never log request bodies.
- **One job at a time per process.** Make `/parse` and `/build` `async def` handlers that take a process-wide
  `asyncio.Semaphore(1)` and run the CPU work with `await asyncio.to_thread(...)`. Only one job thread runs at a time,
  and the event loop stays free for `/health` and fast 503s. If the semaphore is taken, return `503 busy` immediately. Don't let FastAPI's
  default 40-thread pool run several parses at once: they'd share one core under the GIL while each holds ~90–150 MB or more
  (§3.5). `EnginePool` should never send a second job, so the 503 is only a safety net.
- **Memory guard.** Reject PDFs over 10 MB (the Worker already does) and over 300 pages. Call `page.flush_cache()` /
  close pages as the parser goes. Report peak RSS per job, as a number only, in the response metrics.
- **Two container classes** (same image, D16):

  | Class | Instance | Used for | Inactivity timeout | Pool cap (start) |
  |---|---|---|---|---|
  | `EngineFast` | `standard-2` (1 vCPU, 6 GiB) | `/parse` (direct and queued uploads) | 60 s | 60 |
  | `EngineBatch` | `basic` (1/4 vCPU, 1 GiB) | `/build`, `/stocks/scrape` | 60 s | 60 |

  - Uploads get a full core (~1.2 s for a CDSL statement, §3.3). Rebuilds use the cheapest memory per job, since nobody
    waits for them.
  - The 60 s timeout keeps idle memory low (§3.6). The queue hides cold starts.
  - ⚠️ VERIFY in Phase 0: `/parse` p95 on a large CAMS detailed statement on `standard-2`, and peak RSS. If RSS stays under
    ~700 MB, test `basic` for `EngineFast` too and keep whichever is cheaper at an acceptable p95 (target ≤ 10 s).
    Also check that `/build` for a 10-member household fits in 1 GiB, or else move `EngineBatch` to `standard-1`.
- **`EnginePool` Durable Object** (`worker/src/engine-pool.ts`, one instance named `pool`):
  - State: for each class, a list of slot names (`EngineFast-0` … `EngineFast-59`), each slot's lease
    (`lease_id`, `expires_at`), last-used time, a moving average of job time, a queue `seq` counter and the parked-PDF counter.
  - `acquire({ class, wait })`:
    1. Pick the **lowest-numbered free slot that is already warm** (used in the last 60 s).
    2. Otherwise the lowest-numbered free slot ("fill first", so light traffic keeps only `-0` awake).
    3. If none is free, return `busy` with `{ queued_ahead, eta_s }`.
  - `release(lease_id, { duration_ms, ok })` updates the averages. Leases expire (parse 90 s, build 120 s) so crashed
    callers can't hold slots.
  - Load: about 2 calls per job. A 20k-parse burst over 10 min is ~70 calls a second, well under the ~1,000/s
    per-object soft limit.
  - Single-threaded by design, so slot counts are exact, unlike the approximate Rate Limiting binding.
  - ⚠️ VERIFY: if a single pool object ever becomes hot, shard by class (`pool-fast`, `pool-batch`).
- **Parser changes:**
  - BytesIO support (§3.2).
  - Remove `parse_and_store` file writes; return dicts.
  - Move `kfintech.py` password helpers into the Worker (TypeScript port of `password_problem` and `generate_password`).
  - `/parse` takes **one verified password** and the `kind` detected by the Worker pre-check, instead of a candidate list.
    It skips `detect_type` but re-checks it, returning `precheck_disagree` on a mismatch.
- **Keep `casparser_isin`** (scheme info and 2018 NAVs for grandfathering) inside the image. Rebuild the image monthly
  to pick up new ISINs.
- **Tests:**
  - **Pure-JSON tests** for `build_portfolio`, `analysis` (FIFO, LTCG grandfathering, harvest) and the merge rules,
    using **synthetic statement JSON fixtures** (made-up PAN `ABCDE1234F`, fake funds) committed to `engine/tests/fixtures/`.
  - **Real-PDF tests** read from a git-ignored `engine/tests/private/` folder and are skipped when it's absent.
    They assert counts only.

---

## 15. Config and deployment

### 15.1 `worker/wrangler.jsonc` (sketch; ✅ keys checked in M2, the real file is `worker/wrangler.jsonc`)
✅ Verified in M2 against the wrangler 4.168 config schema and `wrangler dev`: every key in this sketch exists, except
the container fields noted below. Wrangler also has a newer `exports` map for Durable Objects (mutually exclusive with
`migrations`). M2 keeps the classic `durable_objects` + `migrations` form, which wrangler 4.168 and the Vitest
integration accept. Switch only if a later wrangler requires `exports`.
```jsonc
{
  "name": "pocketfolio",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "../web/dist", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "limits": { "cpu_ms": 30000 },
  "d1_databases": [
    { "binding": "DB",     "database_name": "pocketfolio-app",    "database_id": "…", "migrations_dir": "migrations/app" },
    { "binding": "MARKET", "database_name": "pocketfolio-market", "database_id": "…", "migrations_dir": "migrations/market" }
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "pocketfolio-data" }],
  // Cloudflare Email Service (D5). ✅ M5: allowed_sender_addresses.
  "send_email": [{ "name": "EMAIL", "allowed_sender_addresses": ["login@pocketfolio.in"] }],
  // R2 lifecycle (set with `wrangler r2 bucket lifecycle add`): prefix "tmp/" → delete after 1 day.
  "queues": {
    "producers": [
      { "binding": "Q_PARSE",   "queue": "pf-parse" },
      { "binding": "Q_REBUILD", "queue": "pf-rebuild" },
      { "binding": "Q_MARKET",  "queue": "pf-market" },   // nav-backfill, stock-scrape, R2 series writes
      { "binding": "Q_EMAIL",   "queue": "pf-email" }
    ],
    "consumers": [
      { "queue": "pf-parse",   "max_batch_size": 1,   "max_concurrency": 60, "max_retries": 10, "dead_letter_queue": "pf-dlq" },
      { "queue": "pf-rebuild", "max_batch_size": 1,   "max_concurrency": 60, "max_retries": 5,  "dead_letter_queue": "pf-dlq" },
      { "queue": "pf-market",  "max_batch_size": 10,  "max_concurrency": 4,  "max_retries": 5,  "dead_letter_queue": "pf-dlq" },
      { "queue": "pf-email",   "max_batch_size": 100, "max_batch_timeout": 1, "max_concurrency": 2, "max_retries": 5, "dead_letter_queue": "pf-dlq" }
    ]
  },
  // max_concurrency of pf-parse / pf-rebuild must equal the EngineFast / EngineBatch pool caps (§14).
  // Slot waits send a fresh delayed message and ack the original (✅ M8, §10.1 D): they don't count as attempts
  // (parse_job.attempts) and can't use up max_retries.
  "triggers": { "crons": ["30 17 * * *", "30 20 * * *", "30 1 * * *", "30 4 * * *", "0 5 * * *", "0 3 * * SUN", "0 4 * * *", "0 21 * * *", "15 * * * *"] },
  // nav-ingest ×4 (23:00, 02:00, 07:00, 10:00 IST), snapshot-prebuild fallback, nav-repair (Sun), stocks, cleanup, tmp-sweep (hourly).
  // ✅ M11: stocks is a daily BharatStock run at "0 4 * * *" until M18 adds the monthly AMC scrape; dispatch on event.cron.
  "ratelimits": [
    { "name": "RL_USER", "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } },
    { "name": "RL_IP",   "namespace_id": "1002", "simple": { "limit": 300, "period": 60 } }
  ],
  "vars": { "ENGINE_FAST_MAX": "60", "ENGINE_BATCH_MAX": "60", "TMP_MAX_OBJECTS": "50000" },
  // ✅ M2: "durable_object" is the current policy. "default" is deprecated, and so is omitting the field. With
  // durable_object, wrangler REJECTS "image", "instance_type" and "max_instances". Images are named under "images", and
  // each Durable Object passes the image and instance size to ctx.container.start() (worker/src/engine.ts).
  "containers": [
    { "name": "pocketfolio-engine-fast",  "class_name": "EngineFast",  "scheduling_policy": "durable_object", "images": { "engine": { "dockerfile": "../engine/Dockerfile" } } },
    { "name": "pocketfolio-engine-batch", "class_name": "EngineBatch", "scheduling_policy": "durable_object", "images": { "engine": { "dockerfile": "../engine/Dockerfile" } } }
  ],
  // EngineFast starts with { instance: "standard-2" }, EngineBatch with { instance: "basic" }. EnginePool's caps are the
  // only instance limit.
  "durable_objects": { "bindings": [
    { "name": "ENGINE_FAST",  "class_name": "EngineFast" },
    { "name": "ENGINE_BATCH", "class_name": "EngineBatch" },
    { "name": "ENGINE_POOL",  "class_name": "EnginePool" }
  ] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["EngineFast", "EngineBatch", "EnginePool"] }],
  "observability": { "enabled": true }
}
```
- **Engine routing.** `EngineFast` and `EngineBatch` are plain Durable Objects that drive `ctx.container` directly.
  ✅ M2 fallback taken: the Durable Object Container API docs now treat the `@cloudflare/containers` `Container` class as
  the legacy path, with a "migrate from the Container class" guide, and its timeout is a `sleepAfter` property, not
  `setInactivityTimeout`. The raw API has everything we need: `start({ image: ctx.container.images.engine, instance,
  env, enableInternet: false })`, `getTcpPort(8080).fetch()`, and `setInactivityTimeout(60_000)`. That timeout is per
  instance, so it is applied after each start and again in the constructor if the container is already running.
  ✅ Locally the container stopped ~60 s after the last request and restarted on the next one: a cold
  `/api/health` takes ~1.8 s, a warm one ~20 ms. The engine secret goes in as a container env var at `start()`. The
  Durable Object adds `X-Engine-Key` to every request, so routes never handle the secret. The Worker never picks an instance itself: it asks `ENGINE_POOL` for a lease, then calls
  `env.ENGINE_FAST.getByName(lease.name)`. No `getRandom`.
- **Locality.** Pick the D1 (both databases) and R2 location hint `apac` at creation. Containers: with the
  `durable_object` policy, instances run near their Durable Object. Create the engine and pool objects from an APAC
  request, or with a location hint. Fallback taken in M4: accept Cloudflare's placement and say so in §12's
  cross-border text. `wrangler containers instances` reports `location: null`, so staging can't show where an
  instance runs, and `constraints.regions` is rejected under `durable_object` (below). Measured from India on
  2026-11-25, the edge was `MRS`. A warm `/api/health` (Worker → pool → container) took ~0.50 s, against ~0.44 s
  for a static asset or a Worker-only 404, so the DO + container hop adds ~60 ms. A cold start took ~11 s, the first
  run after an image rollout.
  M2 note for M4: the Containers platform docs now say "Durable Objects and their associated Container instances are
  not guaranteed to run in the same location". `constraints.regions` is rejected under `durable_object`, since only
  name, class_name, scheduling_policy, images, observability and ssh are allowed. Expect the fallback, and check real
  placement on staging.
- **D1 read replication:** enable on `pocketfolio-market` only (Settings → Enable read replication) and read through
  `MARKET.withSession(…)` (✅ M9: the argument is `"first-primary"`, `"first-unconstrained"` or a bookmark string, per
  `worker-configuration.d.ts` for compatibility date 2026-11-01. Replication was turned on for `pocketfolio-market-staging`
  on 2026-11-26 through the D1 API, `PATCH …/d1/database/{id}` with `{"read_replication":{"mode":"auto"}}`, which also
  needs doing for production in M17. Read-only paths use `"first-unconstrained"` (`/api/market/status`, nav-repair's
  scan); the series writer uses `"first-primary"`.) Leave it off on `pocketfolio-app`, so auth
  reads always see their own writes.

### 15.2 Secrets (`wrangler secret put`)

| Secret | What it is |
|---|---|
| `BETTER_AUTH_SECRET` | Better Auth signing secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client (§7.2) |
| `TURNSTILE_SECRET` | Turnstile check on the email form |
| `DATA_KEK_V1` | key-encryption key (§8) |
| `PAN_PEPPER` | HMAC key for PANs and file hashes (§8) |
| `ENGINE_SHARED_SECRET` | Worker → engine header (§14) |
| `BHARATSTOCK_API_KEY` | stocks fallback (§10.3.1) |
| ~~`R2_MARKET_READONLY_ACCESS_KEY_ID`, `…_SECRET`~~ | not used (M10): the engine reads `market/nav/*` through `MarketGateway` (§10.2) |

Plain vars: `APP_URL`, `BHARATSTOCK_DAILY_LIMIT=50`, `TURNSTILE_SITE_KEY`. Email needs no secret: it uses the
`send_email` binding (D5).

**Remove from the cloud config:** `CASPARSER_API_KEY`, `RAPIDAPI_KEY` and `NUM_PERIODS`. They stay out of the cloud
until those features ship.

### 15.3 Environments and CI
- **Environments:** `dev` (local), `staging` (its own D1, R2 and Google client) and `production`.
- **Local dev:**
  - `wrangler dev` serves the Worker on :8787 and runs the container locally through Docker (supported by wrangler
    for Containers). ✅ Verified in M2 with wrangler 4.168 and Docker Desktop. It needs wrangler ≥ 4.136 for the
    `durable_object` policy, so the Worker uses Node ≥ 22.12 (`worker/.nvmrc`). `max_instances` doesn't apply locally,
    and container code doesn't hot-reload (press `r` to rebuild). The local runtime doesn't set `--read-only` on the
    container: the engine writes nothing either way (verified in M1).
  - Tests: `@cloudflare/vitest-pool-workers` is deprecated and was renamed to **`@cloudflare/vitest-plugin`** (used from
    M2, with vitest 5). It runs container-backed Durable Objects too. It builds the engine image with Docker, so
    `npm test` includes one real `/api/health` round trip through the pool.
  - `npm run dev` runs the SPA through a Vite proxy to :8787.
  - D1 uses `--local`.
- **GitHub Actions:**
  - On a PR: lint, typecheck, `vitest` (Worker, with the isolation tests in §16), `pytest` (engine), and
    `npm run build`.
  - On a merge to main: deploy to staging (`wrangler d1 migrations apply pocketfolio-app --remote` and
    `… pocketfolio-market --remote`, then `wrangler deploy`).
  - Production: manual approval.
- **Domain.** Use a custom domain on Cloudflare. `<APP_DOMAIN>` is needed before Google and email setup.
  - **`<APP_DOMAIN>` = `pocketfolio.in`** (owner, 2026-11-25), with its DNS on Cloudflare. Staging is
    `staging.pocketfolio.in`; production is `pocketfolio.in`.
- **Staging resources (created in M4, 2026-11-25).** D1 `pocketfolio-app-staging` and `pocketfolio-market-staging`
  (`apac`), R2 `pocketfolio-data-staging` (`apac`, lifecycle rule `tmp-expire-1d`: `tmp/` → delete after 1 day),
  queues `pf-{parse,rebuild,market,email}-staging` + `pf-dlq-staging`, Turnstile widget `pocketfolio-staging`
  (managed, domain `staging.pocketfolio.in`; its site key is the plain var `TURNSTILE_SITE_KEY`). Worker
  `pocketfolio-staging` on the custom domain `staging.pocketfolio.in`, plus its workers.dev URL (preview URLs off).
  - CI smoke test: from GitHub runners, `staging.pocketfolio.in` answers **403** at the edge, probably the zone's Bot
    Fight Mode, which the Free zone plan can't skip with a WAF rule. The Worker itself never returns 403. Owner's
    choice (2026-11-25): staging alone turns on `workers_dev`, and CI checks
    `pocketfolio-staging.<subdomain>.workers.dev/api/health`, looking up the subdomain from the API at run time.
    Production keeps `workers_dev` off. Re-check bot protection on `/api/*` before launch (M16/M17): a challenge
    breaks the SPA's fetch calls for real users on shared mobile IPs.
  - ✅ wrangler 4.168 doesn't inherit bindings, vars, secrets or containers into an environment, so `env.staging` and
    `env.production` in `worker/wrangler.jsonc` repeat them all. The top level stays the local-dev config. Queue, D1,
    R2 and container-application names are account-wide, so staging uses a `-staging` suffix. Rate-limit namespace
    IDs are account-wide too: staging uses `2001`/`2002` and production `1001`/`1002`.
  - ✅ `wrangler deploy --secrets-file <json>` uploads secrets with the first version, so a new Worker never runs
    without `ENGINE_SHARED_SECRET`. Secrets are additive across later deploys.
  - ✅ `wrangler d1 migrations apply DB --remote --env staging` (binding name + env) works, and succeeds on an empty
    migrations folder.
  - ✅ Cloudflare cron day-of-week is `1–7` or `SUN–SAT`. `0 3 * * 0` is rejected (code 10100), although local
    wrangler accepts it, so nav-repair is `0 3 * * SUN`.
  - ✅ First deploy (wrangler 4.168, from a laptop): image build + push + upload took ~2 min.
    `https://staging.pocketfolio.in/api/health` → `{"ok":true,…,"slot":"EngineFast-0"}`, the SPA and its fallback
    → 200, and `/api/nope` → JSON 404.
  - ✅ Containers and `limits.cpu_ms` are both refused on the Free plan (`containers/me` → 401 "requires the Workers
    Paid plan"; `cpu_ms` → code 100328). Even `wrangler deploy --dry-run` needs Docker, because it builds the image.

---

## 16. Testing

| Kind | Must cover |
|---|---|
| **Tenant isolation** (Worker, vitest) | User A cannot read, delete or upload to user B's members, statements or snapshot by ID guessing (all 404). The R2 key always contains the session's household. Two households with the same PAN stay separate. |
| Auth | Magic link single use and expiry. Google account linking to an existing magic-link user. Session revoke. QR flow: approve, deny, expired code, code reuse, approving while logged out; the approved session has the approver's user and `householdId`, no user row is created, no email is queued, and the other device gets the "New device linked" notice once. |
| Crypto | Round trip, both compress-then-encrypt JSON (flags bit set) and a parked PDF (no gzip). Tampering with the AAD or ciphertext fails. KEK rotation re-wrap. Deletion crypto-shreds. |
| Upload | Wrong password, then a candidate password works. Different PAN rejected. Duplicate gives 409 (including while the same file is queued). Non-PDF rejected. Over 10 MB rejected. Quotas give 429. A failed parse leaves no empty member. |
| **Queued upload** | With the pool forced to 0 free slots: `202` with position and ETA. The R2 `tmp/` object is encrypted (raw read shows no `%PDF`). After processing, **the `tmp/` object is gone** and `blob_key` is NULL. Cancel deletes the PDF. Expiry: a job older than 24 h is swept and its object deleted. Account deletion removes `tmp/{household_id}/`. A lost queue message is re-enqueued by `tmp-sweep`. |
| **Pre-check (before storing)** | Wrong password → 422 and **no R2 object, no `parse_job` row**. All candidates wrong → 422. The right candidate is found when it's the PAN, the typed password or the pending KFintech password, and only that one reaches the engine. Non-CAS PDF → 422 `unrecognised`. The holder PAN is found even when split by whitespace in the text, and the engine's parsed PAN agrees with it. Over 300 pages → 422. Pre-check and engine agree on every private PDF (counts only). Worker CPU and memory for a 10 MB / 300-page PDF stay within limits in workerd. |
| **No PAN input (D19)** | `POST /api/statements` ignores any `pan`/`member_id` field. With no typed password, a CDSL statement of an existing member opens with that member's PAN and is filed under them. A KFintech statement opens with the pending password. A statement for a new PAN creates the member only after the parse succeeds, with name and masked PAN from the statement. The trust PAN (4th letter `T`) on KFintech statements is never taken as the holder. First upload in a new household with no password → 422 `password_required` with the hint, then succeeds once the password is typed. Member cap → 422 `member_limit` before storing when the PAN is known. |
| **EnginePool** | Fill-first routing (light traffic only uses slot 0). Leases expire after a crash. Never more than 1 job per slot. Over the parked-PDF cap → 503 with nothing stored. ETA within ±50% in the load test. |
| Engine | The synthetic JSON fixture build matches the expected snapshot (golden file). Parsers on private PDFs (counts only, skipped in CI). A second concurrent `/parse` on one process gets 503. Peak RSS of the largest private PDF is reported (number only). |
| Jobs | NAV batch retry. Rebuild idempotency (`inputs_hash`). **4 uploads in 5 s → 1 build.** **Race: an older build finishing after a newer one does not replace the pointer.** Stale snapshot served then rebuilt. Daily cache hit and invalidation. Scheme upsert skips unchanged rows. Scraper adapter parse on a saved public disclosure file (public data, OK to commit). |
| D1 budget | Dashboard load makes ≤ 3 queries to `DB` when the cookie cache is warm (count in a test wrapper). |
| E2E (Playwright, staging) | Sign up via magic link (test inbox) → consent → upload a fixture → dashboard renders → settings export → delete account. At 360 px and desktop, in light and dark. |
| Load (staging) | **Burst:** 2,000 uploads in 2 min from synthetic users (fixture PDFs) → no 5xx and no timeouts. Every upload ends `done` either directly or through the queue, `tmp/` is empty afterwards, and D1 has no "overloaded" errors. Record drain time, peak instances and the container bill. **Nightly:** prebuild for 5,000 synthetic households drains at the configured rate. **Polling:** 2,000 clients following `Retry-After` stay under the IP rate limit. Extrapolate to 10k (§3.5) from these. |
| Stocks (M11) | Equity funds in a test household get holdings: build → wanted funds → job → `fund_portfolio` + R2 → the follow-up build has them. The global budget stops at the limit (also with parallel callers), continues the next UTC day, and a 429 spends the rest of the day. Direct and regular plans share one fetch. Refetch only on a newer coverage month (an empty newest month falls back to the month before). Fund-of-funds look-through. Single flight. A live check (`BHARATSTOCK_LIVE=1`) runs the real engine and the real API. |
| NAV ingest | Parses the real AMFI file format (section headers, `N.A.`, `-` ISINs, stale dates). Idempotent re-runs insert 0 rows. Partial nights move `market_day` coverage. Backfill falls back to AMFI history when mfapi fails. |
| Daily returns | `dailySeries` golden tests: a purchase or redemption mid-window isn't a gain or loss; holiday gaps; partial coverage; IDCW drop flagged; CDSL-only `units_exact=false` note; member filter. |
| PWA | Eligibility function unit tests (each rule in §13A.2). Lighthouse installability. Manual installs on Android Chrome, desktop Chrome/Edge, iOS Safari and macOS Safari. Cache Storage holds no `/api` responses. |

---

## 17. Implementation phases

**The build order is [MILESTONES.md](MILESTONES.md).** It splits these phases into milestones M0–M33, one Claude Code
session each, with owner inputs and done-checks per milestone. Phase → milestones:

| Phase | Milestones |
|---|---|
| 0 | M0–M4 |
| 1 | M5 |
| 1b | M22 |
| 2 | M6–M8 |
| 3 | M9–M11 |
| 3b | M12 |
| 4 | M13 |
| 5 | M14 |
| 5b | M15 |
| 6 | M16, M31, M17 |
| 7 | M18 |
| 8 | M19–M21, M28, M29 |
| 9 (design and growth) | M23–M27, M30 |
| 10 (after launch) | M32, M33 |

The build order isn't the phase order (owner, 2026-11-26 and 2026-11-27): … M12 → M14 → M15 → M22 → M23 → M24 →
**M13** → M25 → M26 → M27 → M30 → M18 → M19 → M29 → M20 → M28 → M21 → **M16** → M31 → **M17** (production launch)
→ M32 → M33. Why: see MILESTONES.md "Order notes".

The phase text below stays the reference for acceptance criteria. Each phase ends with its acceptance criteria met and
a commit/PR.

### Phase 0: Restructure and engine
- Move `app/` to `/engine/engine/`, add the BytesIO fix, refactor `build_portfolio` to a pure function (§10.2), and
  add `server.py` with `/parse`, `/build` and `/health`, the one-job semaphore and process recycling (§14). Add the Dockerfile.
- Scaffold `/worker` (Hono, wrangler config with both D1 databases and all four queues, migrations folders)
  and serve `web/dist`.
- `EngineFast`, `EngineBatch` and `EnginePool` with leases and fill-first routing (§14).
- **Accept:**
  - `wrangler dev` serves the SPA.
  - Worker → `EnginePool` → `EngineFast-0` → container `/health` works locally.
  - Engine pytest passes on the synthetic fixtures.
  - A private real PDF parses through `/parse` with no file written (check `/tmp` is empty).
  - **Measured and written into §3.3:** `/parse` CPU time and peak RSS for the largest private CDSL **and** a CAMS/KFintech
    statement, and `/build` for the largest household, on `standard-2` and `basic`. Confirm or change the instance
    types in §14.
  - ✅ **pdf.js runs in workerd** (`wrangler dev`): the pre-check works on every private PDF, with its CPU time and memory
    recorded in §3.3 (M3). No fallback needed.

### Phase 1: Auth
- Better Auth with Google, magic link (Cloudflare Email Service through the `pf-email` queue), Turnstile, session middleware with the
  cookie cache and `householdId` in the session, the narrowed rate-limit rules, `/api/me`, `/login` page (Google
  primary), avatar menu, sign out, 401 handling.
- Household (and its empty `snapshot` row) created on first sign-in.
- **Accept:** a user can sign in with Google or a magic link on staging, auth tests pass, and a warm-cache request
  makes no D1 session query.

### Phase 2: Tenant data, encryption, upload, snapshots
- `crypto.ts`, `blob.ts` (compress-then-encrypt) and `pdfcheck.ts` (pdf.js pre-check, §10.1 A5), the tenant guard,
  members and statements routes, the **two-path upload pipeline** with `parse_job`, the `pf-parse` consumer, `tmp-sweep` and the R2 lifecycle rule (§10.1), the
  debounced single-flight rebuild with versioned snapshots (§10.2), and the streamed snapshot read.
- Frontend: onboarding, the new add-statement dialog (file + optional password only, D19), the queued state with ETA, the
  Processing list with password entry, backoff polling, member management.
- **Accept:**
  - The isolation, crypto, upload, pre-check, queued-upload and rebuild-race tests pass.
  - A missing or wrong password, an unrecognised PDF or a full household never creates an R2 object or a `parse_job` row.
  - Uploads ask for no PAN; members are created from the statement (D19).
  - Two test accounts see only their own data.
  - Nothing unencrypted for users exists in R2 or D1 (spot-check by reading raw blobs, including `tmp/`).
  - After a forced-queue test run, `tmp/` is empty.

### Phase 3: Market data
- The NAV store (§10.4) in `pocketfolio-market`: the `scheme`, `nav`, `market_day` and `nav_backfill` tables (INTEGER
  codes and dates); `nav-ingest` (AMFI) 4 times a night; `nav-backfill` (mfapi, then the AMFI history fallback) on
  `pf-market`; `nav-repair`; R2 series for tracked schemes. Read replication on.
- Then the stale/lazy rebuild, prebuild on a final market day, and the BharatStock fallback as a job (no threads).
- **Accept:** the dashboard shows NAV history, returns and the Nifty comparison exactly as the local app does, for the
  same statements. Compare snapshot JSON with today's `/api/portfolio` output, ignoring member IDs.

### Phase 3b: Daily returns
- Needs Phase 3's NAV store.
- Engine: `amfi_code`, `units_timeline` and `units_exact` in the snapshot.
- Worker: `dailySeries()` and `GET /api/portfolio/daily`, with the per-(inputs, NAV date) cache (§10.5.3).
- UI: the "Today" bento tile, the 1D column in holdings, and the Daily returns panel.
- **Accept:**
  - After one night of ingest, every held mutual fund has a NAV row for the latest business day.
  - Day change for a test household matches a hand calculation from AMFI NAVs.
  - A purchase in the window is not counted as a gain.
  - Partial coverage shows "x of y funds updated".

### Phase 4: QR device login
- Device authorization plugin, `/login` QR tab, the `/link` approval page, the in-app scanner, the cookie bridge if
  needed, the Devices list, the in-app "New device linked" notice (no email). The linked device shares the
  approver's account.
- **Accept:** all the QR auth tests pass, and linking from a phone to a desktop works on staging.

### Phase 5: Privacy and compliance
- Consent screen and gating, `/privacy`, `/terms`, `/security`, export, delete account, inactivity job,
  `audit_event`, `docs/INCIDENT_RESPONSE.md`, README privacy rewrite.
- **Accept:** a deleted account leaves no rows and no R2 objects, and its DEK is gone. Export contains all the user's
  data and nothing else.

### Phase 5b: Installable app (PWA)
- Manifest, icons, the `vite-plugin-pwa` service worker (app shell only), the install-eligibility logic, platform
  sheets (Chromium, iOS, macOS Safari), the Settings entry, the update toast, safe areas, and the email-code sign-in
  path for standalone iOS.
- **Accept:** everything in §13A.7.

### Phase 6: Hardening and launch
- **Hardening (M16) and launch (M17) wait until Phases 7 and 8 are built** (owner, 2026-11-26), so the load tests
  cover everything that ships.
- Rate limits and quotas (§11), the "Coming soon" states (D8, D9), security headers (CSP: `default-src 'self'`; `manifest-src 'self'`; `worker-src 'self'`;
  allow Google and Turnstile origins; `frame-ancestors 'none'`; HSTS), dependency audit, **the burst, nightly and polling
  load tests (§16)**, staging soak.
- Launch checklist:
  - Google in production
  - domain email authenticated (SPF/DKIM/DMARC), the **Email Service daily quota raised** (Limit Increase Request), and sending
    limits confirmed under the burst load test
  - legal review, including the PDF-handling text (§12)
  - Cloudflare usage alerts (container GiB-hours, D1 rows read, R2 Class A)
  - error alerts on DLQ messages, engine 5xx, D1 "overloaded", and any `queued` parse job older than 1 h (means the queue is stuck)
  - pool caps and queue `max_concurrency` set from the load-test results
- **Accept:** everything in §16 is green, and the launch checklist is done.

### Phase 7: AMC disclosure scraper (before launch)
- The adapter framework, the top 10 AMC adapters, `scrape_run` monitoring, and BharatStock limited to gaps.
- **Accept:**
  - At least 80% of tracked equity schemes have `source='amc'` holdings for the latest month by day 15.
  - The rest are covered by the fallback.

---

## 18. Cost estimate (rough, Workers Paid)

Assumptions (from §3.3 and §3.6): 2 uploads per user per month; ~50% of households active in a 7-day window, so they
get a nightly rebuild; parse ~1.5 vCPU-s on average; build ~0.5 vCPU-s.

| Item | ~1k MAU | ~10k MAU |
|---|---|---|
| Workers Paid base | $5 | $5 |
| Worker requests and CPU | included | included (~3M requests, ~25M CPU-ms) |
| D1 ×2 / Queues ×4 / Cron / Durable Objects | included | included |
| R2 (~40 KB compressed per household, D18; `tmp/` held only briefly) | free tier | free tier (~0.4 GB) |
| Container CPU (billed only while working) | included (~150 of 375 vCPU-min) | ~$1.50 (~1,500 vCPU-min, mostly nightly builds) |
| `EngineFast` awake time (`standard-2`, $0.057/h) | ~$2 | ~$20–25 (slot 0 awake ~12 h a day, plus burst slots) |
| `EngineBatch` awake time (`basic`, $0.010/h) | < $1 | ~$1–2 |
| NAV store (market D1, ~100–150 MB/year) | included | included |
| Cloudflare Email Service | included (3,000/month) | ~$1–3 (~5–10k emails, mostly magic links; Google sends none) |
| Better Auth, Turnstile, mfapi, AMC sites | $0 | $0 |
| BharatStock | free plan | free plan (the scraper takes most of the load) |
| **Total** | **≈ $7–10 / month** | **≈ $32–38 / month** |

- **What drives the bill:** awake memory of `EngineFast`, not the amount of parsing (§3.6). The biggest lever: if the
  Phase 0 measurements let `EngineFast` run on `basic` at an acceptable p95, the 10k-MAU container line drops from ~$25
  to ~$5, for a total of ≈ $13–18.
- **A 10,000-user burst costs ≈ $0.65–2 extra** (§3.5).
- The container estimate is still the least certain. Measure it in the Phase 6 load test and the first month, with
  Cloudflare's usage dashboard.
- **M31 replaces these estimates** with measured cost per user per year (1k / 10k / 100k users), after the M16 load
  test, and adds the AI analysis cost (§21.8) and pricing options (`docs/research/COST_AND_PRICING.md`).

---

## 19. Inputs needed from the owner (not decisions, just values)
- App name is **PocketFolio** (decided). `<APP_DOMAIN>` = **`pocketfolio.in`** (2026-11-25, DNS on Cloudflare). Still needed: an IP India trademark check.
- Legal entity name, grievance officer name and email (privacy page, DPDP).
- Cloudflare account on Workers Paid (✅ 2026-11-25); `pocketfolio.in` onboarded in Cloudflare Email Sending (✅ 2026-11-25; quota increase before launch); Google Cloud project owner account.
- Sign-off on the revised D6 wording (PDFs held encrypted ≤ 24 h only when queued), for the privacy page and consent notice.
- A large multi-year **detailed** CAMS statement (kept in the git-ignored `engine/tests/private/`), for the Phase 0
  measurements in §3.3. Short KFintech statements were measured on 2026-11-25.
- Logo and favicon for the Google consent screen (the existing `favicon.svg` can be the starting point).

## 20. Later (explicitly out of scope now)
- CDSL OTP fetch (CASParser API) and automatic KFintech requests. Both are shown as "Coming soon".
- Phone OTP login (needs an SMS provider and TRAI DLT registration in India) and Sign in with Apple (paid developer account).
- Shared households (invite a spouse with roles), billing and plans, an NSDL CAS parser, and a native mobile app.
- Daily web push ("PocketFolio today: +₹2,340") after the market day is final. Needs the installed PWA on iOS
  (16.4+), the user's opt-in and VAPID keys. It builds on §10.5 and §13A.
- Exchange prices for ETFs and stocks held in CDSL, so they're included in daily returns. Scheduled as M20 (before launch).
- Manually entered FD, PPF and EPF with approximate returns (M19), and stock gains from broker tradebooks or manual buy
  prices (M21). Owner request, 2026-11-26; see `docs/MILESTONES.md` Phase 8. Design to be written before each starts.
- AI portfolio analysis (M32) and the admin panel (M33) are scheduled after launch (§21.8, §21.9).
- Digital gold (app-bought grams) isn't tracked (D24). The IBJA paid API as the gold/silver rate source (§21.5). Mergers and demergers aren't computed (D25).
- A Python Worker for the engine, if Pyodide memory limits and the `pillow`/`rapidfuzz` gaps change (re-run the §3.1 test).
- **A per-household Durable Object** for live status over WebSocket (hibernating), instead of polling. It would also
  serialise that household's rebuilds natively. Worth it only if polling shows up in D1 load after launch.
- **Splitting the snapshot** into a structural part (holdings, lots, tax analysis, rebuilt by the engine only on upload)
  and a valuation part computed in the Worker from the NAV store. That would remove the nightly rebuilds, at the cost of
  porting valuation logic to TypeScript. Revisit if `EngineBatch` becomes a noticeable cost.
- Autoscaling containers, if Cloudflare adds it. `EnginePool` would then shrink to a thin wrapper.

---

## 21. Design, growth and extra features (owner's todo, 2026-11-27)

The owner's todo added these features, and the owner answered Claude's questions on each (D20–D27). The order is in
[MILESTONES.md](MILESTONES.md). Where a milestone says "OK on the plan section", its first session expands the
subsection here and gets the owner's OK before building. The §0 rules apply to all of it: privacy first, tenant guard,
encryption, and demo data only in every screenshot, image and post.

### 21.1 Premium design system v2 and logo (D21, M24)
- **Why:** the owner finds the current look generic ("vibe coded") and wants a premium feel.
- **Direction:** a gold accent on the existing dark-first base, with glass-like surfaces and refined type and spacing.
  M23's research on competitors' dashboards feeds it. Gold must pass AA contrast in dark and light. Gain/loss colours
  stay clearly distinct from the gold.
- **Logo:** a two-part wordmark, "Pocket" in plain text and "folio" on a gold, glass-like rounded block. Made in SVG
  by Claude, with light/dark versions, a square mark, the favicon, PWA icons and maskable icons.
- **Scope:** every existing screen, plus a redesigned dashboard (same data, new hierarchy). The M15 icons and store
  screenshots are regenerated. M24 rewrites §13 as the v2 reference and updates the `CLAUDE.md` hard rule.

### 21.2 Public pages: landing, SEO, blog (D22, M25, M26)
- **Prerendered:** public routes (`/`, `/blog/*`, `/fire`, legal pages) are built as real HTML at build time and served
  by Workers Static Assets. App routes stay SPA and `noindex`. A signed-in visitor on `/` goes to the dashboard.
- **Metadata:** title, description, canonical, Open Graph/Twitter images, structured data (`Organization`, `WebSite`,
  `SoftwareApplication`, `FAQPage`, `Article`), `sitemap.xml`, `robots.txt`, `llms.txt` for AI search. Staging is
  always `noindex`.
- **SEO skill:** github.com/AgricIDaniel/claude-seo is third-party code. Claude reads it in full first and installs it
  as a project skill only with the owner's OK (review in `docs/research/SEO.md`).
- **Blog:** Markdown in the repo with a `draft` flag. Claude drafts 6–8 posts from M23's keyword research; **each goes
  live only after the owner's OK**. Every post cites sources and says "not investment advice".
- **Landing content:** from M23 (positioning, sections, FAQ). Its main point: one private place for the whole
  family's investments, from the statements they already have.

### 21.3 FIRE calculator (D22, M27)
- **Public `/fire`:** runs entirely in the browser; the inputs are never sent or stored. An SEO page.
- **Signed in:** reads the corpus, SIPs and allocation from the snapshot (and manual assets) for a personal gap
  analysis, the required SIP, a projected FI date and scenarios. Saved goal inputs are sealed with the household DEK
  (§8) and included in export and deletion (§12).
- **References** (owner): velthian.com/fire.php, portfolio360.co.in/fire. M23 compares them with others and picks
  the best inputs and outputs. India-specific: inflation, step-up SIPs, the tax on withdrawals, EPF/PPF.

### 21.4 Benchmark score (D23, M28)
- **0–100 per fund and stock**, against the category's index (map in M28). Combines rolling 1/3/5-year excess
  return, how often it beat the index, and downside capture. Less than 1 year of history: no score.
- **Index data:** TRI from niftyindices.com (⚠️ VERIFY access and terms). Fallback: a direct-plan index fund's NAV
  from our NAV store, as `market.py` already does for Nifty 50.
- **Market data, not user data:** computed nightly once per scheme in the market DB. Labelled "not investment advice".

### 21.5 Gold and silver (D24, M29)
Drafted in M29's first session; the owner's decisions of 2026-11-27 are in bold. Built on M19 (§21.12): same table,
sealed inputs, member model, limits, API, live shared calculator and dialogs. Values are labelled "approximate".

**Owner's decisions (2026-11-27):**
- **Rate source: gold and silver ETF NAVs from AMFI, anchored to IBJA through public RBI SGB prices** (not IBJA itself).
  ⚠️ VERIFY result: ✅ IBJA (ibjarates.com) publishes 999/995/916/750/585 gold (₹/10 g) and silver 999 (₹/kg), AM and
  PM, no weekends or holidays, but **its API is paid** (price on request, nagaraj.iyer@ibja.in) and its site asks anyone
  using the rate "for valuation and pricing activities" to subscribe through the official API. Scraping it is ruled out.
  RBI's SGB issue and redemption notices are public and quote IBJA 999 averages, so they serve as anchors. The IBJA API
  can replace the ETF route later without changing the calculator (the served series is the same shape).
- **SGBs in a CDSL statement are detected and valued at the gold rate** (by ISIN from the series table, falling back to
  the name), and move from "Stocks & bonds" to Gold & silver. Typing in an SGB is only for bonds held outside demat
  (RBI Retail Direct, bank or post office certificates), so nothing is counted twice.
- **SGB: pick the series from a list** (all tranches 2015-16 Series I to 2023-24 Series IV, in code), then grams.
- **Gold ETFs and gold funds stay under ETFs and Mutual funds.** The Assets tab's new Gold & silver kind holds physical
  gold, physical silver and SGBs (statement and manual). The asset-class split already counts gold funds as
  "Gold & silver".

**What the forms ask** (an "Add gold or silver" dialog, `Segmented` Gold / Silver / SGB; same copy line as M19):
| Type | Fields | Defaults and notes |
|---|---|---|
| Gold | weight (grams, up to 3 decimals); purity chips **24K (999), 22K (916), 18K (750)** | More options: what you paid (₹, total) and when. Without them the value shows but no gain, and it stays out of invested, gain and Overall XIRR |
| Silver | weight (grams) | Purity 999. More options as for gold |
| SGB | series (a list, newest first, with its issue date and price); units (1 unit = 1 g) | More options: "Bought later on the exchange": date and price per gram (default: the issue date and price). **Redeemed early?** is an action on a saved SGB (allowed from year 5) |
- Names are generated: "Gold · 22K · 20 g", "Silver · 1 kg", "SGB 2018-19 Series IV · 10 g".

**Calculations** (in the shared `lib/manual-assets.ts`, with the series and rate lookups in `lib/metals.ts`):
- **Rate lookup:** the rate on a date is the latest one on or before it (weekends, holidays and a missed night fall back
  to the last day). A rate more than 7 days old today shows "Rate from {date}". No rate at all (a new install before the
  first ingest, or silver before 2022): the value is what was paid, or nothing, with "Rate unavailable".
- **Physical:** `grams × rate999 × purity` with purity 1 (999), 0.916 or 0.75, which is how IBJA's 916/750 rates relate
  to its 999 rate (checked on its table: 916 = 999 × 0.916). Bullion value, before GST and making charges: about what a
  sale would fetch, not a jeweller's buying price.
- **SGB:** `units × rate999` today, or frozen at the maturity (8 years) or early-redemption date with a "Matured" or
  "Redeemed" badge. Interest is `units × issue price × coupon / 2` every six months from the issue date (coupon 2.75 %
  for the 2015-16 tranches that carried it, else 2.5 %), counted for the dates after the buy date and up to the end, as
  "interest received" in the gain. Invested = units × (price paid or issue price). XIRR flows: the purchase, each
  interest payment, and the value on the end date (today, maturity or redemption).
- **Statement SGBs:** units × today's rate replaces the statement's exchange price; the coupon is shown from the series
  table. Invested stays unknown (CDSL has no cost), as for other demat holdings until M21.

**Rate ingest** (`worker/src/market/metals.ts`, table `metal_rate` in `pocketfolio-market`, migration
`migrations/market/0007_metal_rate.sql`):
- Reference ETFs: a few large, long-lived gold ETFs and silver ETFs (AMFI codes in code). Their daily NAVs already
  arrive with every nav-ingest run (all of NAVAll is stored); their history is backfilled once like any tracked scheme.
- Anchors in code: RBI SGB redemption prices (₹/g, the simple average of three IBJA 999 closes, with the dates) for gold;
  dated IBJA silver 999 closes for silver. For each ETF, `k = anchor price ÷ mean NAV on the anchor dates` (grams of
  metal per unit, inverted). Between anchors `k` is interpolated (log-linear: the expense ratio slowly shrinks the
  grams per unit); outside them the nearest segment's slope is extended, clamped to 0–2 % a year.
- Rate on a date = median over the reference ETFs with a NAV that day of `NAV × k`. Stored as `(metal, date, rate,
  etfs)`, upserted only when it changes, so a re-run writes 0 rows. Runs after each nav-ingest and after a reference
  ETF's backfill. A new anchor is a code change; the next run recomputes the history.
- Served to the SPA inside `GET /api/assets` → `rates.metals` (month-end points since 2015 plus the last 31 days, ~350
  points), read through the edge cache (1 h) so household requests don't hit the market DB.

**Storage:** `migrations/app/0012_gold.sql` widens `manual_asset.type` to `fd, ppf, epf, gold, silver, sgb` (SQLite
can't alter a CHECK, so the table is rebuilt and the rows copied). Same sealing, limits (50 assets in all), export
(`manual_assets` with today's values) and deletion.

**Screens:** a **Gold & silver** panel on the dashboard (like Fixed income) and a kind on the Assets tab; allocation
categories "Gold", "Silver" and "SGB" (existing tokens) inside the "Gold & silver" asset class; Members lists them with
the other manual assets. The details dialog shows value today, put in, gain, interest received (SGB), and a value
history chart from the buy date (or the last 5 years) to today at month-end rates, with the money put in.

**Golden tests:** purity factors; a missing rate day falling back; no rate; SGB interest schedule (2.5 % and 2.75 %,
bought on the exchange mid-life, matured, redeemed early); XIRR flows; the derivation (anchors, interpolation, median,
an ETF missing a day). Ingest: saved AMFI NAV fixtures for the reference ETFs, re-runs write 0 rows. API isolation
and the D1 plaintext scan cover the new types.

**As built (M29, 2026-11-27).** The spec above holds; choices where it left room:
- ✅ Code: `worker/src/lib/metals.ts` (rate lookup, purity, SGB helpers) and `lib/sgb-series.ts` (67 tranches), both
  shared with the SPA through `@manual-assets`; gold/silver/SGB valuation and validation in `lib/manual-assets.ts`;
  `worker/src/market/metals.ts` (derivation, job, serving) and `market/metal-anchors.ts` (reference ETFs, anchors);
  migrations `app/0012_manual_asset_gold.sql` and `market/0007_metal_rate.sql`. Web: `lib/assets.ts` (groups, totals,
  statement SGBs), `components/asset-dialogs.tsx`, `asset-details.tsx`, `fixed-income.tsx` (`GoldSilver`),
  `assets-view.tsx`. Tests: `worker/test/metals.test.ts`, `metal-ingest.test.ts`, `assets.test.ts`;
  `web/src/lib/assets.test.ts`.
- ✅ **Series table:** RBI's tranche table, every issue price against its RBI release, ISINs from NSE bhavcopies (all
  67 have one). RBI names the first three tranches "2015-I", "2016-I", "2016-II"; ids are the names with "Series"
  dropped ("2017-18-IV"). Coupon 2.75 % for the first five tranches, 2.5 % from 2016-17 Series III. Maturity is
  issue + 8 years (NSE shows 2018-19 Series IV maturing in December 2026, not 1 January 2027: unconfirmed, left as is).
- ✅ **Reference ETFs:** gold: Nippon India ETF Gold BeES, HDFC, SBI, ICICI Prudential, Kotak; silver: Nippon India,
  ICICI Prudential, Aditya Birla Sun Life, HDFC, Axis (since 2022). **Anchors:** 61 RBI redemption prices, one a month
  from February 2021 to November 2026 (early tranches average the Monday–Friday week); 12 IBJA silver 999 PM closes
  from May 2025 to November 2026. Splits in an ETF's history (a day-on-day move beyond ±30 %) are undone first.
- ✅ **Accuracy, measured** against 291 days of IBJA's published 999 PM closes (May 2025 – November 2026): gold median
  0.10 % off (90 % of days within 0.32 %), silver 0.18 % (within 0.68 %). The one large miss is Sunday 1 February 2026
  (a Budget-day session with a 10 % fall that IBJA priced and the ETFs hadn't). Before the first anchor (2015–2020,
  history charts only) `k` is extended at the clamped slope, so those years are rougher.
- **Missing days:** the served series has month-end points plus the last 31 days; a lookup takes the latest point on or
  before the day. "Older rate" shows when today's rate is over 7 days old.
- **Statement SGBs** are detected in the SPA (`revalueSgbs`), not the engine: units × gold rate, category "SGB",
  asset class "Gold & silver", Assets kind Gold & silver ("SGBs in demat"). Daily returns don't revalue them yet.
- **No price paid** (`cost_unknown`): the value counts in totals, but not invested, gain or Overall XIRR; the dashboard's
  "current" for returns adds only the assets with a known cost, so current − invested = gain.
- **Ops:** the anchors are updated by hand with the PPF/EPF table each quarter (M16 checklist): add the latest RBI
  redemption price and an IBJA silver close. First deploy: nav-ingest queues the 10 reference ETFs' backfills; each one
  finishing recomputes the history.
- Colours (§13, existing tokens): Gold `--cat-gold`, SGB `--cat-sector`, Silver `--cat-other`.

**Later:** the IBJA paid API as the source; statement SGBs in daily returns; SGB interest in the activity list.

### 21.6 Corporate actions (D25, M21)
- **Today:** not handled. CDSL holdings are as of the statement date, and nothing adjusts them afterwards.
- **Automatic:** splits and bonuses with an ex-date after the statement date, from NSE's public corporate-action file
  (⚠️ VERIFY), adjust units and cost. Dividends are shown as income.
- **Ask for a statement:** mergers, demergers and MF scheme mergers show "X merged into Y. Upload a newer statement to
  update it." No guessed units.

### 21.7 Disposable emails (D20, M22)
- An open-source disposable-domain list is bundled at build time. The check runs in `POST /api/login/email` before
  Turnstile and before an email is queued: `400 disposable_email`. Existing users on a listed domain still sign in.
  Logs carry the outcome code only, never the address or the domain.
- ✅ M22 (2026-11-27): the list is npm `disposable-email-domains-js` (2.4.0, **CC0**, no dependencies, ~200 KB,
  10,455 domains). It is a packaging of the main upstream list `disposable-email-domains/disposable-email-domains`
  (CC0, ~5.8k stars, updated within the last day), released several times a month (2.0–2.4 in Nov 2026). Its
  `isDisposableEmailDomain` is case-insensitive and checks every parent domain, so subdomains count. The older
  `disposable-email-domains` package (ivolo, MIT) hasn't been published since 2022, so it wasn't used.
- **As built** (`worker/src/lib/disposable.ts`): the check runs after the address format check and before Turnstile.
  Only a listed domain costs a D1 read (`SELECT 1 FROM "user" WHERE email = ?`). A refusal doesn't count against the
  per-address or per-IP limits, and the log line is `login_email_refused disposable_email`. Trade-off: because the
  check runs before Turnstile, someone could find out without a token whether an account exists for a
  *disposable* address (only those). That's accepted, since those accounts are the ones we don't want anyway.

### 21.8 AI portfolio analysis (D26, M31, M32)
- **Model:** chosen in M31 from the measured cost per analysis: Workers AI (stays inside Cloudflare, no new
  processor), the Claude API (better quality, a new processor in the privacy notice), or none.
- **Data minimisation:** holdings, weights, returns, categories and costs only. Never names, PANs, folios, emails or
  statement text. Prompts and answers aren't logged.
- **Legal:** ⚠️ VERIFY SEBI investment-adviser rules for automated suggestions. The wording stays educational, with no
  buy/sell calls. A new processor means a privacy-notice update and a `consentVersion` bump (M14).
- A per-user quota (§11) and one cached result per snapshot.

### 21.9 Admin panel (D27, M33)
- **Access:** signed-in users whose email is in the `ADMIN_EMAILS` secret. Everyone else gets 404.
- **Shows:** system health (queues, DLQ, jobs, engine, NAV ingest, scraper, BharatStock budget, email); aggregate usage
  (signups, active users, uploads, failure rate, retention); support lookup by email with counts only; suspend, reset
  quotas, delete account; fair-use limits and feature flags (D1, cached).
- **Never shows** names, PANs, amounts, holdings or folios. Every action writes an `audit_event`. More features will
  be decided by the owner before M33.

### 21.10 Competitor research (M23)
- A public-sources-only study in `docs/research/COMPETITORS.md`: features, pricing, privacy stance, landing pages and
  dashboards, and user complaints for the main Indian trackers. It covers PocketFolio's value, the landing content,
  dashboard input for M24, FIRE calculator input for M27, and keywords and communities for M25, M26 and M30.

### 21.11 Social marketing (M30)
- `docs/marketing/SOCIAL_PLAYBOOK.md`: Reddit (subreddits, each one's self-promotion rules with links, comment-first,
  cadence), LinkedIn and X (profiles, content pillars, cadence), and ready drafts. **The owner creates the accounts
  and posts; Claude never does.** Images use demo data only.

### 21.12 Manual assets: FD, PPF, EPF (D28, M19)
Drafted in M19's first session and OK'd by the owner on 2026-11-27, with the choices below. Values are always labelled
"approximate": we model the rules, not the bank's or EPFO's ledger.

**Owner's decisions (2026-11-27):**
- **Assets belong to the household, with a member picked from the existing ones** (option B). No change to `member`,
  no PAN and no new kind of member. The form shows a member picker, preselected when there is only one member. If the
  household has no members yet (no statement uploaded), the asset is saved without one.
- **A separate `GET /api/assets`.** `GET /api/portfolio` keeps streaming the sealed snapshot unparsed (§10.2). The SPA
  fetches both in parallel and merges them.
- **Two XIRRs, like Groww's "active" and "overall".** The default is **Funds & stocks XIRR** (from M20, stocks join
  it). Next to it is **Overall XIRR**, which also includes FD, PPF and EPF (and gold from M29).
- **Ask only what the maths needs.** No bank name, account number, PAN, label or any other identifying detail. The
  flow should never feel like we're collecting private data.
- **Calculate live.** Only the inputs are stored. The current value is computed from them every time, so an edit
  shows straight away.

**What the forms ask** (everything else has a default; amounts in whole rupees, ≤ ₹100 crore; rates 0–20 %):
| Type | Fields | Defaults and notes |
|---|---|---|
| FD | amount; interest rate % p.a.; tenure as chips, the way banks offer it: **7 days, 1 month, 3 months, 6 months, 1 year, 2 years, 3 years, 5 years, Custom** (Custom: years + months + days); start date (default today) | Cumulative with quarterly compounding (the usual Indian FD). The maturity date and amount are shown live under the form. A collapsed **More options** has one switch: "Interest is paid out to me" (monthly or quarterly). **Closed early?** is an action on a saved FD, not a form field (date, default today; penalty 1 %, editable) |
| PPF | current balance; balance as on (default today); year the account was opened (for the 15-year maturity); yearly deposit | Each future yearly deposit is assumed to be made by 5 April (it then earns for the whole year). **Adjust a year** changes or skips one financial year's deposit (a list of `{fy, amount}` overrides) |
| EPF | current balance; balance as on (default today); monthly PF contribution (yours + employer's, hint: "On your payslip or EPFO passbook") | A saved EPF can be marked **Contributions stopped** on a date (changed job, retired) |
- Assets are shown with a generated name, e.g. "FD · 1 year · 7.25 %" or "PPF · opened 2018", never a typed label.
- Rates can be changed per asset (PPF and EPF default to the government rate table below; an edited rate wins).

**Calculations** (one pure TypeScript module, `worker/src/lib/manual-assets.ts`, golden-tested, **also imported by
the SPA** through a path alias, so the browser computes values live as you type and on every load. The Worker uses
the same code for export and for checks; the logic exists in one place only):
- **FD, cumulative:** `P·(1 + r/4)^k` for the `k` whole quarters held, then simple interest for the days left
  (Actual/365), which is how Indian bank calculators value a broken period. A tenure under 6 months uses simple
  interest. **Payout:** the value stays at the principal, and the interest paid so far shows as "interest received"
  (in the gain). After maturity the value freezes at the maturity amount, with a "Matured" badge (we don't guess a
  renewal). **Closed early:** valued at `rate − penalty` for the time actually held. Banks use the card rate for that
  shorter tenure, which we don't know, so this is approximate by design.
- **PPF:** from the balance date, interest for each month on the lowest balance between the 5th and the month end, at
  that quarter's government rate / 12, credited on 31 March. Yearly deposits start from the next 5 April after the
  balance date, unless a "this year" override is added. The current value includes this year's accrued interest
  (shown as "includes ₹x interest not yet credited"). A year over ₹1.5 lakh shows a warning, not an error. After the
  15 years it keeps earning (the extension rules).
- **EPF:** from the balance date, interest each month on the closing balance at that financial year's EPFO rate / 12,
  credited on 31 March. A contribution counts from the month after it's made. The current value includes interest
  accrued but not yet credited (labelled). Invested = the balance on that date plus contributions; the gain is the
  interest since then.
- **Rates** (`worker/src/lib/rates.ts`, a small table in code, `checked: '2026-11-27'`):
  PPF 7.1 % for every quarter from April 2020 to December 2026 ✅ (Finance Ministry notification of 30 Sep 2026; also
  Business Standard, Upstox). EPF 8.50 % FY 2019-20 and 2020-21, 8.10 % 2021-22, 8.15 % 2022-23, 8.25 % 2023-24,
  2024-25 and 2025-26 ✅ (FY 2025-26 notified by EPFO in July 2026). After the table ends, the last rate is used and
  marked **provisional** (e.g. EPF for FY 2026-27, declared next year). The table is updated by hand each quarter (an
  M16 ops checklist item). Rates fetched automatically are "Later".
- **XIRR cashflows** for Overall XIRR: an FD's principal on its start date (and payouts as inflows); PPF and EPF use
  the balance on the balance date as one outflow, then each deposit or contribution; every asset's current value is
  the terminal inflow today.
- Pre-tax everywhere (no TDS, no 80C), said in a footnote.

**Storage** (`migrations/app/0011_manual_asset.sql`, the `DB` database):
```sql
CREATE TABLE manual_asset (
  id           TEXT PRIMARY KEY,               -- uuid
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id    TEXT REFERENCES member(id) ON DELETE CASCADE,   -- optional (D28); checked with assertMember
  type         TEXT NOT NULL CHECK (type IN ('fd','ppf','epf')),
  inputs_enc   BLOB NOT NULL,                  -- sealed JSON of the inputs above (§8)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX manual_asset_household ON manual_asset(household_id, created_at);
CREATE INDEX manual_asset_member ON manual_asset(member_id);          -- member delete cascades through this
```
- Inputs are sealed with the household DEK under the field key `asset/{id}/inputs` (the §8 format). Only the type is
  in the clear, so D1 holds no amounts, rates or dates. A test scans every D1 column for the plaintext.
- Limits (§11): 50 assets per household, 60 yearly overrides per PPF, 30 writes a day per household.
- Deleting a member deletes their assets (cascade; the confirm dialog says how many). Account deletion needs nothing
  new: the rows cascade with the household and the DEK is shredded first (§8). Export (M14) adds `manual_assets`
  with the decrypted inputs and today's computed values.

**API** (all behind `requireSession()` and the tenant guard, §9.1; another household's asset id or member id is a 404):
| Method & path | Purpose |
|---|---|
| `GET /api/assets` | `{ assets: [{ id, type, member_id, inputs, created_at, updated_at }], rates }`: inputs only; the SPA computes values. One D1 read |
| `POST /api/assets` | create `{ type, member_id?, inputs }` → `201 { asset }`. `400 bad_input` names the field, never the value |
| `PATCH /api/assets/:id` | replace `inputs` and/or `member_id` (also used for closed early, adjust a year, contributions stopped) |
| `DELETE /api/assets/:id` | delete |

**Screens** (plan §13: the existing tokens, `Panel`, `Dialog`, `Segmented`, `Input`, `Label`, `Badge`; 360 px and
desktop; dark and light):
- **Dashboard:** total value, invested and gain include manual assets. Allocation puts them under **Debt**, with the
  categories "Fixed deposit", "PPF" and "EPF". The XIRR tile shows Funds & stocks XIRR, with Overall XIRR beside or
  under it once manual assets exist. Daily returns (§10.5) leave them out, since they don't move day to day.
- A **"Fixed income"** panel lists each asset: generated name, member, value, gain, the rate used, an "Approximate"
  badge, and "Matured" or "Provisional rate" where they apply. The empty state is a single line with **Add FD, PPF or
  EPF**.
- **Members:** each member's assets below their statements, with **Add**.
- **Add/edit dialog:** pick FD / PPF / EPF (`Segmented`), then only the fields above, with the computed value and
  maturity updating live under the form. One line of copy: "Only amounts and dates, no account details needed."

**Golden tests** (values worked out by hand in the test file, cross-checked with a bank or EPFO-style calculator): FD
cumulative with a broken period; FD under 6 months; FD payout; FD after maturity; a premature FD with a penalty; each
tenure chip's maturity date (including month-end starts, e.g. 31 Jan + 1 month); PPF with irregular deposits (an
override, a skipped year, a year over ₹1.5 lakh); PPF across a rate change (a synthetic rate table, since the real rate
hasn't changed since 2020); EPF across a financial year whose rate differs from the year before (the "rate change
mid-year" case: the change applies from 1 April); EPF past the end of the rate table (provisional); EPF with
contributions stopped; Overall XIRR with funds plus manual assets.

**As built (M19, 2026-11-27).** The spec above holds; these are the choices made where it left room:
- ✅ Code: `worker/src/lib/manual-assets.ts` (calculator and input validation, shared with the SPA through the
  `@manual-assets` alias in `web/vite.config.ts` and `web/tsconfig*.json`), `lib/rates.ts`, `lib/assets.ts`,
  `routes/assets.ts`, migration `0011_manual_asset.sql`; web `lib/assets.ts`, `components/asset-dialogs.tsx`,
  `components/fixed-income.tsx`. Golden tests in `worker/test/manual-assets.test.ts`, the API, isolation and D1 scan in
  `worker/test/assets.test.ts`, Overall XIRR in `web/src/lib/assets.test.ts`.
- **PPF months:** a month earns once it's over, and only if the balance date is on or before its 5th (we don't know
  the balance before that date). So a balance entered mid-month starts earning the next month: a little low, never
  high. A "this year" override is a deposit on the balance date, on top of the balance.
- **EPF months:** contributions are made at the end of each month after the balance date's month and earn from the next
  month; interest starts the month after the balance date. "Contributions stopped" stops them from that date's month.
- **"Year opened"** is read as the financial year's start (2018 → FY 2018-19; maturity 1 April 2034).
- **XIRR flows:** a matured or closed FD's terminal inflow is on its maturity or closing date, not today (otherwise its
  XIRR would fall every day after maturity). Live assets end today, as specified.
- **FD payout:** each whole period pays `P·r·months/12` (banks discount monthly payouts slightly; not modelled); at
  maturity the days after the last payout are paid as simple interest. A payout FD closed early settles simple
  interest at `rate − penalty` against what was already paid out.
- **Dates:** "today" is the Indian date (UTC+05:30) on both sides; inputs may be dated up to tomorrow, so clocks a few
  hours apart still pass.
- **Limits:** deletes don't count toward the 30 writes a day (removing data is always allowed).
- **Allocation colours** reuse existing tokens (§13: no new colours): Fixed deposit `--cat-debt`, PPF `--cat-hybrid`,
  EPF `--cat-stocks`. They are close in tone (the Debt family); M24's palette can separate them.
- **Overall XIRR** shows only where Funds & stocks XIRR shows (every fund has its full history); invested and total
  returns on the dashboard then include the manual assets. With partial fund history the hero keeps today's notice.
- **Onboarding:** a household with no statement yet can add FD/PPF/EPF from the welcome screen (saved without a
  member); Members lists those under "Not filed under a member" until one is picked in Edit.

**Later:** RD, NSC, SCSS, NPS, bonds; rates fetched automatically; tax views (TDS, 80C).
