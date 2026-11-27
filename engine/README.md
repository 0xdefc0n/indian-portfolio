# engine

PocketFolio's Python engine: CAS PDF parsing and portfolio builds, as a stateless HTTP service in a container.
It's reached only through the Worker's `EngineFast` / `EngineBatch` Durable Objects (plan §14). It never writes to
disk and never sees encryption keys. Its container has no internet (AMC disclosure files are downloaded by the Worker and sent in, M18): the one outbound call is `/build` reading public
NAV series from `NAV_STORE_URL` (`http://market.internal/nav/`), which EngineBatch routes to the Worker's
`MarketGateway` (R2 `market/nav/*`, read-only).

## API
All routes except `/health` need `X-Engine-Key: $ENGINE_SHARED_SECRET`. An engine with no secret set refuses everything.

| Route | Request | Response |
|---|---|---|
| `POST /parse` | body: raw PDF bytes (≤ 10 MB). Headers: `X-Pdf-Password` (base64url of the UTF-8 password; empty for none), optional `X-Statement-Kind: CDSL\|RTA` (set by the Worker after its pre-check) | `{ok, kind, source, pan, statement, metrics}` or `{ok: false, code, message, metrics}` |
| `POST /build` | JSON `{statements: [{member_id, pan?, name?, data}], market?: {navs?, market_date?, nav_key?, refresh?, isin_to_code, stocks}, today?, format?}`. Without `navs` but with `market_date`, the needed series come from the NAV store (LRU cache by `(code, nav_key)`; `refresh` codes always read fresh) | `{ok, snapshot, metrics}`, or with `format: "gzip"` the gzip snapshot JSON itself (`application/x-snapshot+gzip`, metrics in `X-Engine-*` headers) |
| `POST /stocks/parse` | one AMC monthly portfolio disclosure (M18): body = the want JSON `[[isin, name, amfi_name], …]` followed by the file's raw bytes (≤ 48 MB; xls, xlsx, xlsb or a zip of them). Headers: `X-Want-Bytes` (the JSON's length), `X-Amc` (adapter slug), `X-Filename` | `{ok, schemes, months, matched: {isin: {scheme_name, score, as_of, rows}}}`, or 422 `unreadable` |
| `GET /health` | – | `{ok, version, isin_db, busy}` |

- **Error codes:** `wrong_password`, `unrecognised`, `multi_pan`, `too_large` (over 300 pages), `parse_error`, and
  `precheck_disagree` (the caller said it verified the password and type, but the engine disagrees: a bug). `/build`:
  `build_error`, and `nav_store_error` (502) when the NAV store can't be read (a missing series is not an error).
- **No multipart:** Starlette spools multipart uploads over 1 MB to a temporary file. A raw body stays in memory.
- **One job per process:** a second concurrent request gets `503 busy` immediately.
- **Recycling:** the process restarts every `ENGINE_MAX_REQUESTS` (default 200) requests.

## Develop
```bash
cd engine
uv sync
uv run pytest -q                       # synthetic tests (CI); real-PDF tests skip without statements
PRIVATE_DATA_DIR=../data TEST_PDF_PASSWORD=… uv run pytest -q tests/test_private.py --tb=line
uv run python -m engine.cli ../data/*.pdf --bench      # redacted: counts, CPU, memory
UPDATE_GOLDEN=1 uv run pytest tests/test_build.py::test_golden_snapshot   # after an intended output change
uv run python -m engine.amc.cli <slug> <files…> [--rows]   # parse downloaded AMC disclosures (public data): counts per scheme
```
Real statements go only in git-ignored folders (`engine/tests/private/`, `data/`). Tests and the CLI print counts,
timings and ok/fail, never statement data. Passwords come from the PAN in the file name or `$TEST_PDF_PASSWORD`,
never from the command line.

## Container
```bash
docker build -t pocketfolio-engine:dev .
docker run --rm --read-only --tmpfs /tmp -e ENGINE_SHARED_SECRET=dev-key -p 8080:8080 pocketfolio-engine:dev
```
linux/amd64, non-root (uid 10001), read-only root filesystem. ~390 MB, of which `isin.db` is 49 MB.

The original local app (`/app`) was the reference until M10: the parity tests compared the engine's and the Worker's
output with it, then it was deleted. Its parity tests now skip.
