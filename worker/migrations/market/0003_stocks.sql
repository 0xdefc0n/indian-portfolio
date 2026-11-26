-- Stocks inside funds: the BharatStock fallback job (plan §10.3.1, D10, M11). Public market data only: scheme ISINs,
-- scheme names and portfolio names. Nothing here links to a user, household or statement.

CREATE TABLE stock_match (                  -- every fund the stocks view needs: held equity funds, and funds inside them
  isin          TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',   -- the engine's display name for it: what the portfolio search matches
  wanted_at     INTEGER NOT NULL,           -- ms; a build last asked for it (refreshed daily). Unseen 90 days: skipped
  provider_name TEXT,                       -- BharatStock's portfolio name; NULL = not matched (yet)
  fund_house    TEXT,                       -- BharatStock's fund house, for its coverage month
  score         REAL,                       -- name match score (≥ 0.6 counts)
  checked_at    INTEGER,                    -- ms; the search ran. NULL = never. Unmatched ones are searched again after 30 days
  month         TEXT,                       -- YYYY-MM fetched up to (the fund house's latest month, even when empty)
  fetched_at    INTEGER,                    -- ms
  failed_at     INTEGER                     -- ms; the last fetch failed: not tried again for a day
);

CREATE TABLE stock_coverage (               -- BharatStock's free /v1/mf-coverage: latest month per fund house (daily)
  fund_house    TEXT PRIMARY KEY,
  latest_month  TEXT,
  fetched_at    INTEGER NOT NULL
);

CREATE TABLE job_lock (                     -- single-flight jobs on pf-market
  name          TEXT PRIMARY KEY,
  until         INTEGER NOT NULL DEFAULT 0, -- ms; a run holds the lock until then
  started_at    INTEGER NOT NULL DEFAULT 0, -- ms; when the current (or last) pass started
  requested_at  INTEGER NOT NULL DEFAULT 0  -- ms; the last time a message was sent. Newer than started_at: run again
);
INSERT INTO job_lock (name) VALUES ('stocks');

CREATE TABLE stock_state (                  -- bumped on every write of stock data; part of each snapshot's inputs hash
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  version       INTEGER NOT NULL
);
INSERT INTO stock_state (id, version) VALUES (1, 0);
