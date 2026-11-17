-- Text-to-ride (preview, Nov 17, 2026). Additive only. Do not apply this file to a remote
-- database from this checkout except the isolated preview D1 (nudge-preview-db).
-- Numbered 0012 in this repo's lineage (nudgedispatch/nudgedispatch, after 0011_user_terms_consent).
-- The old nudge-release workspace has its own unrelated 0012_on_my_way_text; it is not this lineage.

-- One inbound texting number per company. A text to this number becomes a draft ride for that
-- company. UNIQUE so one number can never feed two fleets.
CREATE TABLE text_intake_settings (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  inbound_number TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX text_intake_number ON text_intake_settings(inbound_number);

-- Every inbound text the webhook accepted or ignored (audit + retry de-duplication).
-- outcome: draft | merged | duplicate | ignored | rate_limited
CREATE TABLE inbound_texts (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  ride_id TEXT,
  from_number TEXT NOT NULL DEFAULT '',
  to_number TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'bland',
  conversation_id TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX inbound_texts_company ON inbound_texts(company_id, received_at);

-- Draft details for rides that came from a text: original message(s), sender, parse warnings,
-- suggested driver. NULL for every other ride.
ALTER TABLE rides ADD COLUMN intake_json TEXT;
