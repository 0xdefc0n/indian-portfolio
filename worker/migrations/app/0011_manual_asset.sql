-- Manual assets: fixed deposits, PPF and EPF entered by hand (plan §21.12, D28, M19). They belong to the household,
-- with an existing member picked (optional: a household without statements has none). Only the type is in the
-- clear: the inputs (amounts, rates, dates) are sealed with the household DEK, and values are computed from them on
-- every read, by the SPA and the Worker (lib/manual-assets.ts). Account deletion needs nothing new: the rows cascade
-- with the household, whose DEK is shredded first.

CREATE TABLE manual_asset (
  id           TEXT PRIMARY KEY,               -- uuid
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id    TEXT REFERENCES member(id) ON DELETE CASCADE,   -- optional (D28); checked with assertMember
  type         TEXT NOT NULL CHECK (type IN ('fd','ppf','epf')),
  inputs_enc   BLOB NOT NULL,                  -- sealed JSON of the inputs (household DEK, AAD asset/{id}/inputs)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX manual_asset_household ON manual_asset(household_id, created_at);
CREATE INDEX manual_asset_member ON manual_asset(member_id);          -- member delete cascades through this
