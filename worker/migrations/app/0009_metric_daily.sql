-- Product counters (plan §13A.6, M15): how often the install prompt is shown, accepted or dismissed, and how often
-- the installed app is launched. One row per metric per IST day. No user ID, no household ID: counts only.
CREATE TABLE metric_daily (
  metric TEXT NOT NULL,
  date TEXT NOT NULL, -- IST day, 'YYYY-MM-DD'
  count INTEGER NOT NULL,
  PRIMARY KEY (metric, date)
) WITHOUT ROWID;
