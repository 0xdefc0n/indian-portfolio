-- Exchange prices for shares and bonds held in demat (plan §10.4.5, M20). Daily closes by ISIN from Upstox's public
-- candle API (src/market/prices.ts). Public market data only: the upload handler adds the ISINs it saw, with no link
-- to a user, household or statement.

CREATE TABLE tracked_equity (                -- INE/IN9 ISINs anyone holds in demat; drives the price job
  isin          TEXT PRIMARY KEY,
  exchange      TEXT CHECK (exchange IN ('NSE', 'BSE', 'none')), -- NULL: not looked up yet; 'none': neither lists it
  last_seen_at  INTEGER NOT NULL,            -- ms; dropped from the job after 90 days unseen (cleanup deletes it)
  latest_date   INTEGER,                     -- YYYYMMDD of the newest stored close
  backfilled_at INTEGER,                     -- ms; the full history was stored. NULL: still to do (builds follow up)
  checked_at    INTEGER,                     -- ms; the last fetch (a 'none' is looked up again after 30 days)
  failed_at     INTEGER                      -- ms; the last fetch failed (network, 5xx, bad answer)
);

CREATE TABLE stock_price (
  isin  TEXT NOT NULL,
  date  INTEGER NOT NULL,                    -- YYYYMMDD
  close REAL NOT NULL,                       -- ₹, adjusted for splits and bonuses as the source serves it
  PRIMARY KEY (isin, date)
) WITHOUT ROWID;

CREATE TABLE price_state (                   -- bumped whenever stored closes change; part of each snapshot's inputs
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT INTO price_state (id, version) VALUES (1, 0);
