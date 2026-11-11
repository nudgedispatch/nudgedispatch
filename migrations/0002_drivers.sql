-- Fleet roster. One row per driver user. The user id is what rides and sessions store,
-- so renaming the driver does not move those links. Passcode hashes live on this row.
-- Do not apply this file to a remote database from this checkout.

CREATE TABLE drivers (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  vehicle TEXT NOT NULL DEFAULT '' CHECK (length(vehicle) <= 40),
  plate TEXT NOT NULL DEFAULT '' CHECK (length(plate) <= 12),
  login TEXT NOT NULL DEFAULT 'passcode' CHECK (login IN ('passcode', 'email')),
  passcode_hash TEXT NOT NULL DEFAULT '',
  passcode_salt TEXT NOT NULL DEFAULT '',
  passcode_iterations INTEGER NOT NULL DEFAULT 0,
  passcode_kdf TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX drivers_company_name ON drivers(company_id, name COLLATE NOCASE);
CREATE INDEX drivers_company ON drivers(company_id);
