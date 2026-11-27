-- Gold and silver rates (plan §21.5, M29): ₹ per gram of 999 metal per market day, derived from reference gold and
-- silver ETF NAVs (the nav table) and anchored to IBJA through RBI's SGB prices (src/market/metals.ts). Public market
-- data only. Upserted only when a value changes, so a re-run writes nothing.
CREATE TABLE metal_rate (
  metal TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  date  INTEGER NOT NULL,                  -- YYYYMMDD
  rate  REAL NOT NULL,                     -- ₹ per gram, 999
  etfs  INTEGER NOT NULL,                  -- reference ETFs the median is over
  PRIMARY KEY (metal, date)
) WITHOUT ROWID;
