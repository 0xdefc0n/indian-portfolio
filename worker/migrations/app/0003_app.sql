-- Tenant data (plan §6, M6). household and snapshot are in 0002_household.sql. Every row here belongs to one household
-- (or one user) and is read and written only with the session's household_id bound (src/lib/tenant.ts, §9.1).
-- Encrypted columns (*_enc) use the household DEK with the blob format of src/lib/crypto.ts (§8).

CREATE TABLE member (
  id               TEXT PRIMARY KEY,              -- uuid; replaces m0/m1
  household_id     TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  pan_hmac         TEXT NOT NULL,                 -- HMAC-SHA256(PAN_PEPPER, PAN): lookups/dedupe, never reversible
  pan_enc          BLOB NOT NULL,                 -- encrypted PAN (default PDF password)
  pan_masked       TEXT NOT NULL,                 -- "AB••••••4F" for display
  display_name_enc BLOB,                          -- holder name from the statement, or the user's rename (encrypted)
  created_at       INTEGER NOT NULL,
  UNIQUE (household_id, pan_hmac)
);
-- A PAN may exist in many households (two family members each with their own login). That's allowed.
CREATE INDEX member_household ON member(household_id, created_at);

CREATE TABLE statement (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id      TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('CDSL','CAMS','KFINTECH')),
  as_of          TEXT NOT NULL,                   -- YYYY-MM-DD (valuation/period end)
  period_from    TEXT,
  blob_key       TEXT NOT NULL,                   -- R2: h/{household_id}/statements/{id}.bin (gzip, then encrypted)
  content_hash   TEXT NOT NULL,                   -- HMAC of the PDF bytes: rejects exact duplicate uploads
  parser_version TEXT NOT NULL,
  holdings_count INTEGER NOT NULL,
  warnings_count INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (household_id, content_hash)
);
CREATE INDEX statement_member ON statement(member_id, kind, as_of);

CREATE TABLE parse_job (                          -- queued uploads (§10.1 queued path, M8); short-lived
  id              TEXT PRIMARY KEY,               -- uuid
  household_id    TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id       TEXT REFERENCES member(id) ON DELETE CASCADE,  -- set when the pre-check matched an existing member
  pan_hmac        TEXT,                           -- holder PAN found by the pre-check (new member); NULL if unknown (D19)
  blob_key        TEXT,                           -- R2: tmp/{household_id}/{id}.bin (encrypted PDF); NULL once deleted
  content_hash    TEXT NOT NULL,                  -- the duplicate check also covers queued jobs
  kind            TEXT NOT NULL CHECK (kind IN ('CDSL','RTA')),
  password_source TEXT NOT NULL CHECK (password_source IN ('typed','pan','kfintech_pending')),
  password_enc    BLOB,                           -- the verified password, only when typed; deleted with the PDF
  status          TEXT NOT NULL CHECK (status IN ('queued','parsing','done','failed','expired')),
  error_code      TEXT,                           -- parse_error | multi_pan | member_limit | precheck_disagree | parse_timeout | password_unavailable
  attempts        INTEGER NOT NULL DEFAULT 0,
  seq             INTEGER NOT NULL,               -- position ticket from EnginePool
  statement_id    TEXT,                           -- set when done
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,               -- created_at + 24 h
  UNIQUE (household_id, content_hash)
);
CREATE INDEX parse_job_status ON parse_job(status, expires_at);
CREATE INDEX parse_job_member ON parse_job(member_id);   -- member delete cascades through this

CREATE TABLE pending_statement_password (         -- KFintech guided request (D9)
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  pan_hmac     TEXT NOT NULL,                     -- keyed by PAN, not member: the person may not be a member yet (D19)
  password_enc BLOB NOT NULL,
  expires_at   INTEGER NOT NULL,                  -- 30 days
  PRIMARY KEY (household_id, pan_hmac)
);

CREATE TABLE quota (                              -- fair-use counters (§11, src/lib/quota.ts)
  subject TEXT NOT NULL,                          -- 'user:{id}' | 'household:{id}' | 'global'
  metric  TEXT NOT NULL,                          -- 'upload' | 'parse_fail' | 'export' | 'device_link' ...
  window  TEXT NOT NULL,                          -- '2026-11-24' (IST day), '2026-11' (IST month), '2026-11-24T13' (IST hour)
  count   INTEGER NOT NULL DEFAULT 0,             -- NOT NULL is load-bearing: quota.ts aborts a batch by writing NULL
  PRIMARY KEY (subject, metric, window)
);

CREATE TABLE audit_event (                        -- security log, no PII; keep ≥ 1 year (DPDP Rule 6)
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT,
  household_id TEXT,
  event        TEXT NOT NULL,                     -- 'login','member_deleted','statement_added','statement_deleted',...
  ip_country   TEXT,
  ua_hash      TEXT,
  at           INTEGER NOT NULL
);
CREATE INDEX audit_event_household ON audit_event(household_id, at);

CREATE TABLE consent (                            -- DPDP consent records (gating arrives in M14)
  user_id        TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  notice_version TEXT NOT NULL,
  accepted_at    INTEGER NOT NULL,
  withdrawn_at   INTEGER,
  PRIMARY KEY (user_id, notice_version)
);
