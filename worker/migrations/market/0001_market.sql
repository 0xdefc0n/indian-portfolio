-- Shared public market data (plan §6, M7). D1 `pocketfolio-market` (binding MARKET). Nothing here links to a user,
-- household or statement: the upload handler only adds the public scheme ids it saw (§10.1 C7).

CREATE TABLE tracked_scheme (                    -- union of schemes anyone holds; drives the NAV and stock jobs
  isin          TEXT PRIMARY KEY,
  amfi_code     INTEGER,                         -- from CAMS/KFintech statements; CDSL ones carry only the ISIN
  amc           TEXT,
  last_seen_at  INTEGER NOT NULL                 -- ms; dropped from jobs after 90 days unseen
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
  status        TEXT NOT NULL CHECK (status IN ('ok','not_published','failed','blocked')),
  schemes_found INTEGER,
  error_class   TEXT,
  at            INTEGER NOT NULL,
  PRIMARY KEY (amc, month, at)
);
