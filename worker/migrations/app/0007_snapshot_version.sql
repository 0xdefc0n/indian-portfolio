-- The SNAPSHOT_VERSION a snapshot was built with (M12). A snapshot from an older version counts as stale, so the
-- first read after a deploy that changes what a build produces rebuilds it. Rows from before this column are NULL:
-- stale too.
ALTER TABLE snapshot ADD COLUMN version INTEGER;
