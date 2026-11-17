-- Self-serve signup (Jesse, Nov 17, 2026): pending Checkout rows, owner name, terms stamp. Booking slugs are permanent.
-- Additive only. Apply to preview/prod BEFORE deploying the Worker that reads these tables.
-- Do not apply to a remote prod DB from a checkout by hand. Preview is allowed with the preview config.

CREATE TABLE signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  password_kdf TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_phone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  booking_slug TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'solo',
  sms_addon INTEGER NOT NULL DEFAULT 0,
  business_address TEXT NOT NULL DEFAULT '',
  business_phone TEXT NOT NULL DEFAULT '',
  business_website TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT NOT NULL DEFAULT '',
  theme_color TEXT NOT NULL DEFAULT '',
  terms_accepted_at INTEGER NOT NULL,
  terms_version TEXT NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'expired', 'abandoned')),
  company_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX signups_email_open ON signups(email) WHERE status = 'pending';
CREATE UNIQUE INDEX signups_slug_open ON signups(booking_slug) WHERE status = 'pending';
CREATE UNIQUE INDEX signups_checkout ON signups(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

ALTER TABLE companies ADD COLUMN signup_id TEXT;
ALTER TABLE companies ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE companies ADD COLUMN terms_version TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';

-- Branding color for the booking page header and QR page. Empty keeps the default Nudge dark header.
ALTER TABLE invoice_settings ADD COLUMN theme_color TEXT NOT NULL DEFAULT '';
