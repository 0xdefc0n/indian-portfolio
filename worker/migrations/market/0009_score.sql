-- Benchmark score for funds and stocks (plan §21.4, M28): index total-return levels from niftyindices.com, each held
-- fund's and share's 0–100 score against its index, and a stock → sector lookup for the sector line. Public market
-- data only: a score is keyed by scheme code or ISIN and never says who holds it.

CREATE TABLE index_level (                   -- daily total-return (TRI) level per index
  index_id TEXT NOT NULL,                    -- our id, e.g. 'nifty50' (src/market/score.ts INDICES)
  date     INTEGER NOT NULL,                 -- YYYYMMDD
  tri      REAL NOT NULL,
  PRIMARY KEY (index_id, date)
) WITHOUT ROWID;

CREATE TABLE score (
  key         TEXT PRIMARY KEY,              -- 'mf:{amfi_code}' or 'eq:{isin}'
  as_of       INTEGER NOT NULL,              -- YYYYMMDD month-end the windows end on
  score       INTEGER,                       -- 0–100; NULL: not scored (reason says why)
  reason      TEXT,                          -- 'young' | 'unmapped' | 'index_fund' | 'not_equity' | 'no_data' | 'waiting' | 'idcw_no_twin'
  data        TEXT NOT NULL,                 -- JSON shown in the app (index, parts, line numbers)
  computed_at INTEGER NOT NULL               -- ms
);

CREATE TABLE stock_sector (                  -- a share's industry, from fund portfolio disclosures (M11, M18)
  isin       TEXT PRIMARY KEY,
  sector     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE score_state (                   -- bumped whenever a score changes; part of each snapshot's inputs
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT INTO score_state (id, version) VALUES (1, 0);

-- Stock history from 5 to 10 years (owner, 2026-11-27): shares already stored are fetched again in full once.
UPDATE tracked_equity SET backfilled_at = NULL WHERE exchange IN ('NSE', 'BSE');
