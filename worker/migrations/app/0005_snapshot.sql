-- Snapshot builds (plan §10.2, M10). The snapshot row itself is in 0002_household.sql.
--   requested_at: last time anything asked for a rebuild (upload, delete, rename, stale read, prebuild).
--   checked_at:   when the inputs behind the current snapshot were read (a build, or a check that found nothing new).
--   A rebuild is still due while requested_at > checked_at: that's GET /api/portfolio/status's `pending`.
--   failed_at:    the last failed build; a stale read doesn't ask again for 10 minutes after one.
ALTER TABLE snapshot ADD COLUMN requested_at INTEGER;
ALTER TABLE snapshot ADD COLUMN checked_at INTEGER;
ALTER TABLE snapshot ADD COLUMN failed_at INTEGER;

-- snapshot-prebuild runs once per market date: when the date becomes final, or at the 05:00 UTC fallback (§10.3).
CREATE TABLE prebuild_run (
  market_date TEXT PRIMARY KEY,                   -- YYYY-MM-DD
  at          INTEGER NOT NULL,
  households  INTEGER NOT NULL DEFAULT 0
);
