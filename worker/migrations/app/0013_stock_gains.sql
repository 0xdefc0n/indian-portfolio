-- Stock gains (plan §21.6, M21): broker tradebooks and manual average buy prices. The tradebook file itself is never
-- kept: only its parsed trades, compressed and sealed in R2 (h/{household}/tradebooks/{id}.bin), like a statement.
-- Rows cascade with the member and the household; account deletion's DEK shred and prefix sweep cover the blobs.

CREATE TABLE tradebook (
  id             TEXT PRIMARY KEY,               -- uuid
  household_id   TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id      TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,  -- picked by the user (tradebooks rarely carry a PAN)
  broker         TEXT NOT NULL,                  -- parser slug: zerodha, groww, angel_one, upstox, icici_direct, paytm_money, dhan
  period_from    TEXT,                           -- first and last trade date (YYYY-MM-DD)
  period_to      TEXT,
  trades_count   INTEGER NOT NULL,
  blob_key       TEXT NOT NULL,
  content_hash   TEXT NOT NULL,                  -- HMAC of the file's bytes: refuses the same file twice
  parser_version TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (household_id, content_hash)
);
CREATE INDEX tradebook_member ON tradebook(member_id, created_at);
CREATE INDEX tradebook_household ON tradebook(household_id);

CREATE TABLE stock_cost (                        -- a manual average buy price for one share of one member
  id           TEXT PRIMARY KEY,                 -- uuid
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  isin_key     TEXT NOT NULL,                    -- HMAC(PAN_PEPPER, household|member|isin): finds the row, says nothing
  cost_enc     BLOB NOT NULL,                    -- sealed {isin, avg_price, since?} (household DEK, AAD stockcost/{id})
  updated_at   INTEGER NOT NULL,
  UNIQUE (household_id, isin_key)
);
CREATE INDEX stock_cost_member ON stock_cost(member_id);
