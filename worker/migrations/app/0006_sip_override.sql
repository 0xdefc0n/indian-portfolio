-- The user's SIP changes the statements can't show yet (M12, owner request 2026-11-26): skip one instalment, or
-- cancel. PocketFolio doesn't place or stop SIPs; these only correct its estimates until a newer statement shows
-- what really happened.

CREATE TABLE sip_override (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  sip_key      TEXT NOT NULL,                -- HMAC(PAN_PEPPER, household|member|folio|isin): finds one SIP, says nothing
  kind         TEXT NOT NULL CHECK (kind IN ('skip','cancel')),
  due          TEXT NOT NULL,                -- skip: the instalment's due date; cancel: the day it was cancelled (IST)
  sip_enc      BLOB NOT NULL,                -- sealed {isin, folio} (household DEK, AAD sip/{id})
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX sip_override_one ON sip_override(household_id, sip_key, kind, due);
CREATE INDEX sip_override_household ON sip_override(household_id);
