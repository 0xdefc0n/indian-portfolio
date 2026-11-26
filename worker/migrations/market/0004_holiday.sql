-- Exchange trading holidays (M12, owner request 2026-11-26): SIP instalments due on one run the next business day.
-- Filled weekly from Upstox's public market-holidays API (NSE closures). Public market data only.

CREATE TABLE market_holiday (
  date       INTEGER PRIMARY KEY,            -- YYYYMMDD
  name       TEXT NOT NULL,
  source     TEXT NOT NULL,                  -- 'upstox'
  fetched_at INTEGER NOT NULL                -- ms
);

CREATE TABLE holiday_run (                   -- the last fetch, so the daily cron fetches at most weekly
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  at    INTEGER NOT NULL,                    -- ms
  ok    INTEGER NOT NULL,
  rows  INTEGER NOT NULL
);
