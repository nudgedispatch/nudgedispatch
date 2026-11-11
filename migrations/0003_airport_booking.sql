-- Airport pickups and drop-offs on the booking page, luggage, per-fleet vehicle capacities,
-- and flight tracking alerts for drivers. Additive only. Do not apply this file to a remote
-- database from this checkout.

-- Per-company booking settings. airports_json: see app/airport-booking.js (empty = no airport
-- options, the plain booking page). capacities_json: passenger limit by vehicle class
-- (sedan defaults to 3). flight_rules_json: early/delay alert thresholds.
CREATE TABLE booking_settings (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  airports_json TEXT NOT NULL DEFAULT '{"version":1,"airports":[]}',
  capacities_json TEXT NOT NULL DEFAULT '{}',
  flight_rules_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- airport_json: { code, name, side: pickup|dropoff, spot, spotLabel, meet?, style? } set from the
-- booking page. Drivers see it on the ride. luggage: pieces of luggage from the booking page.
ALTER TABLE rides ADD COLUMN airport_json TEXT;
ALTER TABLE rides ADD COLUMN luggage INTEGER;
-- Last flight snapshot from the provider (for change detection) and when it was checked.
ALTER TABLE rides ADD COLUMN flight_status_json TEXT;
ALTER TABLE rides ADD COLUMN flight_checked_at INTEGER;

CREATE TABLE flight_alerts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  ride_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('early', 'delay', 'cancelled', 'diverted', 'changed')),
  alert_key TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER
);
CREATE UNIQUE INDEX flight_alerts_ride_key ON flight_alerts(company_id, ride_id, alert_key);
CREATE INDEX flight_alerts_ride ON flight_alerts(company_id, ride_id, created_at);
