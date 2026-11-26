-- Queued uploads (plan §10.1 D, M8). parse_job is rebuilt rather than altered, because SQLite can't change a CHECK:
-- - password_source gains 'none' (an unencrypted PDF has no password; M7 note);
-- - user_id: who uploaded it (the statement_added audit row is written when the job is stored);
-- - pending_pan_hmac: the pending KFintech password that opened it (password_source = 'kfintech_pending');
-- - pdf_bytes: size of the parked PDF, so tmp-sweep can recount the global parked-PDF cap (§11);
-- - updated_at: last change or slot wait; a queued job untouched for 15 min lost its message (tmp-sweep re-enqueues).
-- The table only holds short-lived rows (none exist before M8), so nothing is copied.

DROP TABLE parse_job;

CREATE TABLE parse_job (                          -- queued uploads (§10.1 D); short-lived
  id               TEXT PRIMARY KEY,              -- uuid
  household_id     TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id          TEXT,                          -- the uploader (no FK: the household cascade removes the row)
  member_id        TEXT REFERENCES member(id) ON DELETE CASCADE,  -- set when the pre-check matched an existing member
  pan_hmac         TEXT,                          -- holder PAN found by the pre-check; NULL if not identified (D19)
  pending_pan_hmac TEXT,                          -- the pending KFintech password used (password_source = 'kfintech_pending')
  blob_key         TEXT,                          -- R2: tmp/{household_id}/{id}.bin (encrypted PDF); NULL once deleted
  pdf_bytes        INTEGER NOT NULL DEFAULT 0,
  content_hash     TEXT NOT NULL,                 -- the duplicate check also covers queued jobs
  kind             TEXT NOT NULL CHECK (kind IN ('CDSL','RTA')),
  password_source  TEXT NOT NULL CHECK (password_source IN ('typed','pan','kfintech_pending','none')),
  password_enc     BLOB,                          -- the verified password, only when typed; cleared with the PDF
  -- No "needs_password" state: wrong passwords and unknown types are refused before a job exists.
  -- status is NOT NULL on purpose: the park INSERT writes NULL to refuse a household over its open-jobs cap.
  status           TEXT NOT NULL CHECK (status IN ('queued','parsing','done','failed','expired')),
  error_code       TEXT,                          -- parse_error | multi_pan | member_limit | precheck_disagree | parse_timeout | password_unavailable
  attempts         INTEGER NOT NULL DEFAULT 0,    -- engine attempts; slot waits don't count
  seq              INTEGER NOT NULL,              -- the EnginePool waiter ticket (queue position)
  statement_id     TEXT,                          -- set when done
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,              -- created_at + 24 h; tmp-sweep deletes the PDF and marks 'expired'
  UNIQUE (household_id, content_hash)
);
CREATE INDEX parse_job_status ON parse_job(status, expires_at);
CREATE INDEX parse_job_member ON parse_job(member_id);   -- member delete cascades through this
CREATE INDEX parse_job_household ON parse_job(household_id, created_at);
