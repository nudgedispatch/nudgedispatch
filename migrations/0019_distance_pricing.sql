-- Distance pricing (Google Routes) and the airport add-on, Nov 20, 2026. Additive only.
-- Do not apply this file to a remote database from this checkout.

-- Copy of every rate sheet as it was before the new rate form, so a rollback can restore flat
-- fares and per-vehicle mileage rates. Nothing reads this table.
CREATE TABLE rate_sheets_legacy (
  company_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  sheet_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  copied_at INTEGER NOT NULL
);
INSERT INTO rate_sheets_legacy (company_id, enabled, sheet_json, updated_at, copied_at)
  SELECT company_id, enabled, sheet_json, updated_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM rate_sheets;

-- The quote saved on each ride/request. quote_cents (existing) is the quoted fare.
-- quote_status: 'auto' (priced by the Worker) or 'manual' (no automatic price; the owner types it).
-- NULL on rides made before this migration and on rides the owner entered by hand.
-- quote_rates_json: the fleet's rates used for this quote (snapshot; later rate edits don't change it).
ALTER TABLE rides ADD COLUMN quoted_miles REAL;
ALTER TABLE rides ADD COLUMN quoted_minutes INTEGER;
ALTER TABLE rides ADD COLUMN quote_status TEXT;
ALTER TABLE rides ADD COLUMN quote_rates_json TEXT;
ALTER TABLE rides ADD COLUMN quoted_at INTEGER;
-- Airport code, terminal, flight gate, landing time used and terminal source live in airport_json
-- (see app/airport-booking.js); the flight number stays in rides.flight.

-- Our own daily caps on paid Google Routes and flight-data calls (all fleets together).
-- day: YYYY-MM-DD in America/New_York. kind: 'routes' | 'flight'.
CREATE TABLE api_daily_usage (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);

-- Fleet home base (More > Rates): where the fleet works from, picked with Places Autocomplete, and a
-- service radius. Used only to bias address suggestions (never to restrict them). NULL = not set.
ALTER TABLE companies ADD COLUMN base_address TEXT;
ALTER TABLE companies ADD COLUMN base_lat REAL;
ALTER TABLE companies ADD COLUMN base_lng REAL;
ALTER TABLE companies ADD COLUMN service_radius_miles REAL;
