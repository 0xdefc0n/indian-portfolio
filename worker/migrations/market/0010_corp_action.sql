-- Corporate actions and NSE symbols (plan §21.6, M21). Public market data from NSE (src/market/corp.ts): nothing here
-- links to a user. Splits and bonuses adjust units after a statement; dividends are estimated income; mergers and
-- demergers show a banner (D25).

CREATE TABLE corp_action (
  symbol  TEXT NOT NULL,                     -- NSE symbol (stable across the ISIN change a split often brings)
  ex_date TEXT NOT NULL,                     -- YYYY-MM-DD
  kind    TEXT NOT NULL CHECK (kind IN ('split','bonus','dividend','merger','demerger','other')),
  subject TEXT NOT NULL,                     -- NSE's text, one part of it when it lists several actions
  isin    TEXT,                              -- the ISIN NSE gave (current or old)
  num     REAL,                              -- split: new shares per old share is num/den; bonus: num new for every den held
  den     REAL,
  amount  REAL,                              -- dividend per share, ₹
  PRIMARY KEY (symbol, ex_date, kind, subject)
) WITHOUT ROWID;
CREATE INDEX corp_action_isin ON corp_action(isin);

CREATE TABLE nse_symbol (                    -- NSE's EQUITY_L.csv: the current ISIN of each symbol
  symbol  TEXT PRIMARY KEY,
  isin    TEXT NOT NULL,
  name    TEXT NOT NULL,
  seen_at INTEGER NOT NULL                   -- ms; the last list that had it
) WITHOUT ROWID;
CREATE INDEX nse_symbol_isin ON nse_symbol(isin);

CREATE TABLE stock_fmv_2018 (                -- 31 Jan 2018's highest price (adjusted, as the price source serves it),
  isin TEXT PRIMARY KEY,                     -- the grandfathered cost of shares bought before then (s.55(2)(ac))
  high REAL NOT NULL
) WITHOUT ROWID;

CREATE TABLE corp_state (                    -- version: bumped whenever actions or symbols change (snapshot inputs)
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  version             INTEGER NOT NULL,
  backfill_asked_at   INTEGER,               -- ms; the one-time 2010-to-today backfill was sent
  symbols_at          INTEGER                -- ms; the last EQUITY_L.csv refresh
);
INSERT INTO corp_state (id, version) VALUES (1, 0);
