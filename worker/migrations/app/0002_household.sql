-- Household and its snapshot pointer, created at signup (plan §6, M5). The other app tables come in 0003_app.sql (M6).

CREATE TABLE household (
  id             TEXT PRIMARY KEY,                -- uuid
  owner_user_id  TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  dek_wrapped    BLOB NOT NULL,                   -- per-household data key, wrapped by the KEK (§8, src/lib/crypto.ts)
  kek_version    INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL                 -- drives prebuild + DPDP inactivity handling
);

CREATE TABLE snapshot (                           -- one current built portfolio per household
  household_id   TEXT PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  blob_key       TEXT,                            -- R2: h/{household_id}/snapshot/{inputs_hash}.bin; NULL until first build
  inputs_hash    TEXT,
  market_date    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('ready','building','failed')),
  building_hash  TEXT,
  building_until INTEGER,
  built_at       INTEGER
);

-- Fixed-window rate limits (src/lib/rate-limit.ts). key = HMAC of the bucket name, so no IP or email is stored.
-- Rows are tiny; the cleanup cron (M14) deletes rows whose reset_at has passed.
CREATE TABLE rate_limit (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL                       -- epoch ms
);
