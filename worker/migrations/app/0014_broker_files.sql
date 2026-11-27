-- Broker files as a source (plan §21.13, D29, M34): broker holdings statements, and members without a PAN.
--
-- A member created from a broker file has no PAN. member.pan_hmac / pan_enc / pan_masked are NOT NULL and SQLite can't
-- relax that without rebuilding a table that many others point at (a DROP would cascade-delete them), so such a member
-- gets pan_hmac 'nopan:{member id}' (unique, matches no PAN's HMAC), pan_enc sealed '' and pan_masked ''. no_pan = 1
-- marks it. "Is this the same person?" (a later CDSL/CAMS statement with a matching name) merges it into the PAN
-- member: its rows move there and it is deleted (src/lib/broker-files.ts mergeMembers).
ALTER TABLE member ADD COLUMN no_pan INTEGER NOT NULL DEFAULT 0;

-- The holdings statement itself is never kept: only {broker, as_of, holdings: [{isin, name, qty, avg_price, close}]},
-- compressed and sealed in R2 (h/{household}/holdings/{id}.bin), like a tradebook. One row per broker account: a newer
-- file from the same account replaces the older one.
CREATE TABLE broker_holding (
  id             TEXT PRIMARY KEY,               -- uuid
  household_id   TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id      TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  broker         TEXT NOT NULL,                  -- parser slug: groww, zerodha, dhan
  account_key    TEXT NOT NULL,                  -- HMAC(PAN_PEPPER, household|broker|client code): "same account"; the code is never stored
  as_of          TEXT NOT NULL,                  -- the statement's "as on" date (YYYY-MM-DD)
  holdings_count INTEGER NOT NULL,
  blob_key       TEXT NOT NULL,
  content_hash   TEXT NOT NULL,                  -- HMAC of the file's bytes: refuses the same file twice
  parser_version TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (household_id, content_hash),
  UNIQUE (household_id, account_key)
);
CREATE INDEX broker_holding_member ON broker_holding(member_id);

-- "Is this the same person?" answered no: never asked again for this pair.
CREATE TABLE member_distinct (
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_a     TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,  -- the member without a PAN
  member_b     TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  PRIMARY KEY (member_a, member_b)
);
CREATE INDEX member_distinct_b ON member_distinct(member_b);
