# Family portfolio

Track mutual fund holdings across family members' demat accounts in one dashboard.
Add each member's CDSL statement (upload, or fetch with an OTP via CASParser) and/or their CAMS / KFintech
consolidated statement. Both are parsed locally and shown on the dashboard right away. A fund that appears in
both is counted once: units and NAV come from the newer statement, pledges from CDSL, invested amount from CAMS/KFintech.

## Run
```bash
# backend
uv venv .venv && uv pip install -p .venv -r requirements.txt
cp .env.example .env                       # optional: real CASPARSER_API_KEY for OTP fetch (Pro plan)

# frontend (React + shadcn/ui), build once
cd web && npm install && npm run build && cd ..

.venv/bin/uvicorn app.main:app --reload --port 8000
```
Open http://localhost:8000

Frontend development with hot reload: run `npm run dev` in `web/` (proxies `/api` to :8000) and open http://localhost:5173.

## Where things are
- `app/main.py`: API (upload, OTP fetch, `/api/portfolio`), serves `web/dist`
- `app/parsers/cdsl.py`: CDSL eCAS PDF parser (password = PAN)
- `app/parsers/rta.py`: CAMS / KFintech statement, via the open-source `casparser` library (runs locally)
- `app/kfintech.py`: request a KFintech statement by email (RapidAPI "KFintech CAS Mailback Automation", free 25/month with `RAPIDAPI_KEY` in `.env`; otherwise a guided manual request)
- `app/portfolio.py`: combines the latest statement per member, fund categories, display names
- `web/src/`: dashboard (`App.tsx`, `components/`)
- `parse.py`: re-parse PDFs in `data/` from the command line (output redacted; `--show` for details, `--password=` for CAMS/KFintech)

## Privacy
Everything stays on this machine. `data/` (PDFs and parsed JSON) and `.env` are git-ignored.
Logs don't contain PAN, account IDs or holdings. PDF passwords you type are used once and never stored. A password generated for a statement request is kept in `data/.statement-requests.json` (owner-only) until that PDF is uploaded, then deleted; address, email and mobile from statements are not kept. The dashboard shows PANs masked.

The one outside call made automatically is for fund NAV history: AMFI scheme codes (no PAN, units or amounts) go to `api.mfapi.in` for daily NAVs (the monthly value chart, fund 1/3/5-year returns and the Nifty 50 comparison) and its public scheme list (to find codes for demat-only funds). NAVs are cached in `data/.nav-cache/` for a day. Set `NAV_HISTORY=0` in `.env` to turn it off.

Stock-level holdings come from BharatStock (`BHARATSTOCK_API_KEY`): only fund scheme names are sent. Matches and portfolios are cached in `data/.stock-cache/` with timestamps. A fund is fetched again only when its fund house publishes a newer month (checked once a day via the free coverage endpoint), and paid requests stop at `BHARATSTOCK_DAILY_LIMIT` per day.
