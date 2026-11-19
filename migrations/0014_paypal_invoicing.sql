-- PayPal Invoicing: each fleet connects its OWN PayPal REST app (sandbox or live).
-- The client secret is AES-GCM encrypted with the Worker secret PAYPAL_CREDENTIALS_KEY; D1 never holds it in
-- plain text, and the API only ever returns its last 4 characters. The cached OAuth token is encrypted the same way.
-- Numbered 0014 because open branches already use 0012 (text-to-ride) and 0013 (ride trial).
-- Additive only. Apply BEFORE deploying the Worker that reads it.
CREATE TABLE paypal_credentials (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  client_id TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  secret_last4 TEXT NOT NULL,
  webhook_id TEXT NOT NULL DEFAULT '',
  token_enc TEXT,
  token_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The PayPal invoice made from a Nudge invoice (one at most). All nullable / defaulted for existing rows.
ALTER TABLE invoices ADD COLUMN paypal_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN paypal_mode TEXT;
ALTER TABLE invoices ADD COLUMN paypal_status TEXT;
ALTER TABLE invoices ADD COLUMN paypal_payer_url TEXT;
ALTER TABLE invoices ADD COLUMN paypal_sent_at INTEGER;
ALTER TABLE invoices ADD COLUMN paypal_checked_at INTEGER;
ALTER TABLE invoices ADD COLUMN paypal_refunded INTEGER NOT NULL DEFAULT 0;
CREATE INDEX invoices_paypal ON invoices(paypal_invoice_id);

-- Verified PayPal webhook events, recorded once by PayPal event id (idempotent re-deliveries).
CREATE TABLE paypal_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  company_id TEXT,
  result TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL
);
