# engine

PocketFolio's Python engine: CAS PDF parsing and portfolio builds, as a stateless HTTP service in a container.
It's reached only through the Worker's `EngineFast` / `EngineBatch` Durable Objects (plan §14). It never writes to
disk, never calls the network, and never sees encryption keys.

## API
All routes except `/health` need `X-Engine-Key: $ENGINE_SHARED_SECRET`. An engine with no secret set refuses everything.

| Route | Request | Response |
|---|---|---|
| `POST /parse` | body: raw PDF bytes (≤ 10 MB). Headers: `X-Pdf-Password` (base64url of the UTF-8 password; empty for none), optional `X-Statement-Kind: CDSL\|RTA` (set by the Worker after its pre-check) | `{ok, kind, source, pan, statement, metrics}` or `{ok: false, code, message, metrics}` |
| `POST /build` | JSON `{statements: [{member_id, pan, name?, data}], market?: {navs, isin_to_code, stocks}, today?}` | `{ok, snapshot, metrics}` |
| `GET /health` | – | `{ok, version, isin_db, busy}` |

- **Error codes:** `wrong_password`, `unrecognised`, `multi_pan`, `too_large` (over 300 pages), `parse_error`, and
  `precheck_disagree` (the caller said it verified the password and type, but the engine disagrees: a bug).
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

Until M10, the original app in `/app` stays as the reference: the parity tests compare the engine's output with it.
