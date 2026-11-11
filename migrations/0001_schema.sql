-- Local schema matching the production nudge-app database structure.
-- No production rows are included.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'individual',
  status TEXT NOT NULL DEFAULT 'active',
  booking_slug TEXT,
  trial_status TEXT NOT NULL DEFAULT 'trial',
  trial_started_at INTEGER,
  trial_ride_limit INTEGER NOT NULL DEFAULT 15,
  trial_days INTEGER NOT NULL DEFAULT 30,
  trial_ended_at INTEGER,
  trial_end_reason TEXT NOT NULL DEFAULT '',
  billing_plan TEXT,
  sms_addon_enabled INTEGER DEFAULT 0,
  sms_addon_updated_at INTEGER,
  sms_setup_billed_at INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_livemode INTEGER,
  billing_updated_at INTEGER,
  billing_status TEXT,
  billing_paid_through INTEGER,
  billing_last_paid_at INTEGER,
  billing_event_at INTEGER,
  billing_past_due_at INTEGER
);

CREATE UNIQUE INDEX companies_booking_slug ON companies(booking_slug) WHERE booking_slug IS NOT NULL;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  password_kdf TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  platform_admin INTEGER NOT NULL DEFAULT 0,
  last_sign_in_at INTEGER
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX clients_company ON clients(company_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE memberships (
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'driver')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE rides (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  pickup_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  passengers INTEGER NOT NULL DEFAULT 1,
  flight TEXT NOT NULL DEFAULT '',
  fare_cents INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  payment TEXT NOT NULL CHECK (payment IN ('unpaid', 'invoiced', 'paid')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  progress TEXT NOT NULL DEFAULT '',
  en_route_at INTEGER,
  picked_up_at INTEGER,
  completed_at INTEGER,
  driver_user_id TEXT,
  approval TEXT NOT NULL DEFAULT 'none',
  source TEXT NOT NULL DEFAULT '',
  trip_type TEXT NOT NULL DEFAULT '',
  vehicle_name TEXT NOT NULL DEFAULT '',
  hours REAL,
  quote_cents INTEGER,
  quote_json TEXT
);

CREATE INDEX rides_company ON rides(company_id);
CREATE INDEX rides_company_approval ON rides(company_id, approval);
CREATE INDEX rides_company_status ON rides(company_id, status);

CREATE TABLE invoice_settings (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  business_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  payment_instructions TEXT NOT NULL DEFAULT '',
  gratuity_note TEXT NOT NULL DEFAULT 'Price does not include gratuity.',
  terms TEXT NOT NULL DEFAULT 'Due on receipt.',
  prefix TEXT NOT NULL DEFAULT '',
  next_number INTEGER NOT NULL DEFAULT 1001,
  logo_data_url TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  ride_id TEXT NOT NULL,
  number TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  issued_on TEXT NOT NULL,
  snapshot_text TEXT NOT NULL,
  bill_name TEXT NOT NULL,
  bill_phone TEXT NOT NULL DEFAULT '',
  bill_email TEXT NOT NULL DEFAULT '',
  trip_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (company_id, ride_id),
  UNIQUE (company_id, number)
);

CREATE INDEX invoices_company ON invoices(company_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  company_name TEXT,
  user_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  account_kind TEXT NOT NULL DEFAULT 'individual',
  join_company_id TEXT,
  join_role TEXT NOT NULL DEFAULT 'owner',
  billing_plan TEXT,
  sms_addon INTEGER DEFAULT 0
);

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  failures INTEGER NOT NULL,
  window_started INTEGER NOT NULL
);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX admin_audit_created ON admin_audit(created_at);

CREATE TABLE booking_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_started INTEGER NOT NULL
);

CREATE TABLE booking_pages (
  company_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE driver_locations (
  company_id TEXT NOT NULL,
  ride_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sharing INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  acc REAL,
  fix_at INTEGER,
  saved_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, ride_id)
);

CREATE INDEX driver_locations_user ON driver_locations(company_id, user_id);

CREATE TABLE location_links (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  ride_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX location_links_ride ON location_links(company_id, ride_id, user_id);

CREATE TABLE rate_sheets (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  sheet_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE ride_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  passenger_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  passengers INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  ride_id TEXT,
  alert_email_at INTEGER,
  alert_sms_at INTEGER
);

CREATE INDEX ride_requests_company ON ride_requests(company_id, created_at);

CREATE TABLE sms_messages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  ride_id TEXT,
  user_id TEXT,
  kind TEXT NOT NULL DEFAULT 'on_my_way',
  to_last4 TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  provider_message_id TEXT,
  meter_reported_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX sms_messages_company_created ON sms_messages(company_id, created_at);
CREATE UNIQUE INDEX sms_messages_ride_kind_sent ON sms_messages(ride_id, kind) WHERE status = 'sent';

CREATE TABLE static_assets (
  path TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  livemode INTEGER,
  company_id TEXT,
  result TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
