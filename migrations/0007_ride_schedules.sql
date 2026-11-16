-- Regular client schedules: rides that repeat on fixed days of the month and/or weekdays.
-- Additive only (two new tables, no change to existing rows). Depends on 0006_ride_stops.sql.
-- Do not apply this file to a remote database from this checkout.
--
-- Rides are NOT created automatically. The owner app lists upcoming dates; the owner confirms
-- (creates one normal scheduled ride) or skips each date. ride_schedule_occurrences records that
-- decision, and its primary key (schedule_id, occurs_on) guarantees a date is handled only once.

CREATE TABLE ride_schedules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  label TEXT NOT NULL DEFAULT '',
  month_days TEXT NOT NULL DEFAULT '[]',   -- JSON list of 1..31 and/or -1 (last day of the month)
  week_days TEXT NOT NULL DEFAULT '[]',    -- JSON list of 0 (Sun) .. 6 (Sat)
  pickup_time TEXT NOT NULL,               -- HH:MM, America/New_York wall time like rides.pickup_time
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  stops_json TEXT,                         -- same shape as rides.stops_json (NULL = no stops)
  passengers INTEGER NOT NULL DEFAULT 1,
  flight TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  fare_cents INTEGER,                      -- NULL = no default fare; the owner types it when confirming
  driver_user_id TEXT,                     -- preferred driver (fleet accounts); NULL = unassigned
  start_date TEXT NOT NULL,                -- YYYY-MM-DD
  end_date TEXT,                           -- YYYY-MM-DD or NULL (no end)
  lookahead_days INTEGER NOT NULL DEFAULT 14,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ride_schedules_company ON ride_schedules(company_id, active);
CREATE INDEX ride_schedules_client ON ride_schedules(company_id, client_id);

CREATE TABLE ride_schedule_occurrences (
  schedule_id TEXT NOT NULL REFERENCES ride_schedules(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  occurs_on TEXT NOT NULL,                 -- YYYY-MM-DD occurrence date (the schedule's date, even if the ride was moved)
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'skipped')),
  ride_id TEXT,                            -- the ride created on confirm
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, occurs_on)
);
CREATE INDEX ride_schedule_occurrences_company ON ride_schedule_occurrences(company_id, occurs_on);
