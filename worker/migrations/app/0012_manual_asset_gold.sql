-- Gold, silver and Sovereign Gold Bonds as manual assets (plan §21.5, D24, M29). SQLite can't change a CHECK, so the
-- table is rebuilt with the wider type list and the rows copied. Nothing references manual_asset, so dropping it is
-- safe; foreign-key checks are deferred to the end of the migration.
PRAGMA defer_foreign_keys = true;

CREATE TABLE manual_asset_v2 (
  id           TEXT PRIMARY KEY,               -- uuid
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id    TEXT REFERENCES member(id) ON DELETE CASCADE,   -- optional (D28); checked with assertMember
  type         TEXT NOT NULL CHECK (type IN ('fd','ppf','epf','gold','silver','sgb')),
  inputs_enc   BLOB NOT NULL,                  -- sealed JSON of the inputs (household DEK, AAD asset/{id}/inputs)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
INSERT INTO manual_asset_v2 (id, household_id, member_id, type, inputs_enc, created_at, updated_at)
  SELECT id, household_id, member_id, type, inputs_enc, created_at, updated_at FROM manual_asset;
DROP TABLE manual_asset;
ALTER TABLE manual_asset_v2 RENAME TO manual_asset;
CREATE INDEX manual_asset_household ON manual_asset(household_id, created_at);
CREATE INDEX manual_asset_member ON manual_asset(member_id);          -- member delete cascades through this
