-- mfforecast (RapidAPI) as the last fallback for stocks inside funds (plan §10.3.1, M18 follow-up). Public market
-- data only. fund_portfolio.source gains 'mfforecast': SQLite can't change a CHECK, so the table is rebuilt.

CREATE TABLE fund_portfolio_new (
  scheme_isin   TEXT NOT NULL,
  month         TEXT NOT NULL,                   -- YYYY-MM
  source        TEXT NOT NULL CHECK (source IN ('amc','bharatstock','mfforecast')),
  blob_key      TEXT NOT NULL,                   -- R2: market/holdings/{isin}/{month}.json
  fetched_at    INTEGER NOT NULL,
  PRIMARY KEY (scheme_isin, month)
);
INSERT INTO fund_portfolio_new (scheme_isin, month, source, blob_key, fetched_at)
  SELECT scheme_isin, month, source, blob_key, fetched_at FROM fund_portfolio;
DROP TABLE fund_portfolio;
ALTER TABLE fund_portfolio_new RENAME TO fund_portfolio;
CREATE INDEX fund_portfolio_source ON fund_portfolio(scheme_isin, source, month);

ALTER TABLE stock_match ADD COLUMN mff_at INTEGER;  -- ms; mfforecast was last asked for it (any outcome)
