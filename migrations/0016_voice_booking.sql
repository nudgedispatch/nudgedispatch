-- Voice-to-ride (preview, Nov 19, 2026). Additive only. Stacked on 0012_text_to_ride (text-to-ride branch).
-- Numbered 0016 because main already uses 0013-0015. Apply only to the isolated preview D1 (nudge-preview-db)
-- until Jesse approves a prod rollout.

-- Voice uses the same one-number-per-company routing as text-to-ride (text_intake_settings.inbound_number,
-- UNIQUE). `enabled` stays the text switch; voice_enabled is the separate voice switch. Off by default.
ALTER TABLE text_intake_settings ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0;

-- Every post-call webhook the voice endpoint accepted or ignored (audit + idempotency).
-- dedupe_key: 'call|<call_id>' for the post-call webhook, 'disp|<idempotency key>' for a disposition follow-up.
-- outcome: draft | updated | duplicate | ignored | empty | rate_limited
CREATE TABLE inbound_calls (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  company_id TEXT,
  ride_id TEXT,
  from_number TEXT NOT NULL DEFAULT '',
  to_number TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'bland',
  call_length_min REAL,
  dedupe_key TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX inbound_calls_call ON inbound_calls(call_id);
CREATE INDEX inbound_calls_company ON inbound_calls(company_id, received_at);
