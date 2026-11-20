-- Driver ride alerts (Web Push, Nov 19, 2026). Additive only.
-- One row per browser/device subscription. Deleted when the push service answers 404/410,
-- when the driver turns alerts off, or when the driver is removed.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_ok INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (company_id, user_id);
