-- NAV store (plan §10.4, M9). D1 `pocketfolio-market` (binding MARKET). Public market data only: nothing here links
-- to a user, household or statement. Codes and dates are INTEGERs: `amfi_code` as a number, dates as YYYYMMDD.

CREATE TABLE scheme (                      -- every scheme in AMFI's daily file; refreshed by every nav-ingest run
  amfi_code     INTEGER PRIMARY KEY,
  isin_growth   TEXT,                      -- "ISIN Div Payout/ ISIN Growth"; NULL when "-" or empty
  isin_reinvest TEXT,                      -- "ISIN Div Reinvestment"
  name          TEXT NOT NULL,
  amc           TEXT,                      -- the AMC header line above the row
  category      TEXT,                      -- the "Open Ended Schemes(...)" header line
  plan          TEXT,
  option        TEXT,
  latest_nav    REAL,                      -- NULL while AMFI shows N.A.
  latest_date   INTEGER,                   -- YYYYMMDD
  updated_at    INTEGER NOT NULL           -- ms
);
CREATE INDEX scheme_isin_growth   ON scheme(isin_growth);
CREATE INDEX scheme_isin_reinvest ON scheme(isin_reinvest);

CREATE TABLE nav (
  amfi_code INTEGER NOT NULL,
  date      INTEGER NOT NULL,              -- YYYYMMDD
  nav       REAL NOT NULL,
  PRIMARY KEY (amfi_code, date)
) WITHOUT ROWID;

CREATE TABLE market_day (                  -- one row per recent NAV date: how complete it is
  date            INTEGER PRIMARY KEY,     -- YYYYMMDD
  schemes_updated INTEGER NOT NULL,        -- NAV rows stored for this date by nav-ingest and nav-repair
  tracked_total   INTEGER NOT NULL,        -- live schemes anyone holds (tracked_scheme) plus the benchmark
  tracked_updated INTEGER NOT NULL,        -- of those, how many have a NAV for this date
  final           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE nav_backfill (                -- full history, once per tracked scheme
  amfi_code INTEGER PRIMARY KEY,
  status    TEXT NOT NULL CHECK (status IN ('pending','done','failed')),
  source    TEXT CHECK (source IN ('mfapi','amfi_history')),
  rows      INTEGER,                       -- NAV rows stored for the scheme once done
  from_date INTEGER,                       -- earliest NAV date stored (YYYYMMDD)
  at        INTEGER NOT NULL               -- ms; last change
);

CREATE TABLE nav_anomaly (                 -- day-on-day moves over ±20%: stored, but flagged (split, merger, IDCW, typo)
  amfi_code INTEGER NOT NULL,
  date      INTEGER NOT NULL,
  prev_date INTEGER NOT NULL,
  prev_nav  REAL NOT NULL,
  nav       REAL NOT NULL,
  PRIMARY KEY (amfi_code, date)
) WITHOUT ROWID;

CREATE TABLE nav_run (                     -- one row per scheduled fetch, for the "fetched nothing twice" alert
  job        TEXT NOT NULL CHECK (job IN ('nav-ingest','nav-repair')),
  at         INTEGER NOT NULL,             -- ms
  ok         INTEGER NOT NULL,             -- 1 when the fetch gave rows
  parsed     INTEGER NOT NULL,
  inserted   INTEGER NOT NULL,
  error_class TEXT,
  PRIMARY KEY (job, at)
);
