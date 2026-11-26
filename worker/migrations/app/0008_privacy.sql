-- Privacy and compliance (plan §12, M14).
--   inactivity_notice_at: when the DPDP inactivity notice was emailed (Rule 8(2): at least 48 h before erasure).
--   Signing in, or any use that refreshes the session (once a day), moves last_active_at and clears it again.
ALTER TABLE household ADD COLUMN inactivity_notice_at INTEGER;
CREATE INDEX household_last_active ON household(last_active_at);

-- The nightly cleanup deletes security-log rows past their retention by time (src/lib/cleanup.ts).
CREATE INDEX audit_event_at ON audit_event(at);
