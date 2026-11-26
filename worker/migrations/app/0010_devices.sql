-- M13: QR device login (plan §7.4, D2) and Settings → Devices.

-- Better Auth 1.7.28 device-authorization plugin table. Generated with:
--   npx auth generate --config scripts/auth-schema.config.ts --output <file>
-- A row lives at most 5 minutes plus cleanup's hour; the device code is single use (consumed on redemption).
create table "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" date not null, "status" text not null, "lastPolledAt" date, "pollingInterval" integer, "clientId" text, "scope" text);
create unique index "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");
create unique index "deviceCode_userCode_uidx" on "deviceCode" ("userCode");
create index "deviceCode_userId_idx" on "deviceCode" ("userId");

-- What the approval page shows about the requesting device (plan §7.4 ⚠️ VERIFY → the side-table fallback: the
-- plugin's extra fields need its internal `grant` API). A short label, never the raw user agent. Same lifetime as the code.
CREATE TABLE device_code_meta (
  user_code  TEXT PRIMARY KEY,
  label      TEXT NOT NULL,          -- "Chrome · macOS"
  city       TEXT,                   -- request.cf, approximate
  country    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX device_code_meta_created ON device_code_meta(created_at);

-- Plain columns, not Better Auth fields, so they stay out of the cookie cache.
ALTER TABLE session ADD COLUMN city TEXT;          -- approximate place at sign-in (request.cf)
ALTER TABLE session ADD COLUMN country TEXT;
ALTER TABLE session ADD COLUMN "linkedAt" INTEGER;  -- ms; set when this session came from a QR link
ALTER TABLE session ADD COLUMN "noticeAt" INTEGER;  -- ms; when this session last showed "New device linked"
