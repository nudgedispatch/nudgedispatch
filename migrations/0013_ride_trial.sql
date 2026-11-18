-- 15-ride free trial for self-serve Solo signups (Nov 17, 2026). Additive only.
-- Prod applied through 0011 on Nov 17, 2026; 0012 is taken by the open text-to-ride PR (#24).
-- trial_billing = 'auto': card on file, converts to paid Solo at the 15th completed ride.
ALTER TABLE companies ADD COLUMN trial_billing TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN trial_converted_at INTEGER;
ALTER TABLE companies ADD COLUMN trial_convert_claimed_at INTEGER;
ALTER TABLE companies ADD COLUMN trial_convert_error TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN trial_canceled_at INTEGER;
ALTER TABLE companies ADD COLUMN trial_notice_dismissed_at INTEGER;

-- Exit survey answers from "Cancel trial". reasons is a JSON array of keys, NULL when skipped.
CREATE TABLE IF NOT EXISTS cancellation_feedback (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT '',
  rides_used INTEGER NOT NULL DEFAULT 0,
  reasons TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cancellation_feedback_created ON cancellation_feedback (created_at);
