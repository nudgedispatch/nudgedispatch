// Sample rows for local screenshots and wrangler dev. Not production data.
// SMS stays off. Nothing here calls Bland, Stripe, or Google.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { validateRateSheet } from "../app/quote-engine.js";

const OPERATOR_EMAIL = "operator@example.test";
const ADMIN_EMAIL = "admin@example.test";
const FLEET_EMAIL = "fleet@example.test";
const OPERATOR_PASSWORD = "sample-operator-1";
const ADMIN_PASSWORD = "sample-admin-pass";
const FLEET_PASSWORD = "sample-fleet-pass";

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations: 100000,
  }, key, 256));
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  return { salt: b64(salt), hash: b64(bits) };
}

function q(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

const now = Date.now();
const companyId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const adminId = "33333333-3333-4333-8333-333333333333";
const clientId = "44444444-4444-4444-8444-444444444444";
const requestedId = "55555555-5555-4555-8555-555555555555";
const scheduledId = "66666666-6666-4666-8666-666666666666";
const fleetCompanyId = "77777777-7777-4777-8777-777777777777";
const fleetOwnerId = "88888888-8888-4888-8888-888888888888";
const rosterDriverId = "99999999-9999-4999-8999-999999999999";

const parsed = validateRateSheet({
  vehicles: [{ name: "SUV", seats: 6, hourlyRate: "85", minHours: 3 }],
  flatFares: [{
    place: "ATL Airport",
    placeKeywords: "atl, airport, hartsfield",
    prices: { SUV: { oneWay: "125", roundTrip: "230" } },
  }],
});
if (!parsed.sheet) throw new Error(parsed.error || "rate sheet");

const quote = {
  basis: "flat",
  label: "To ATL Airport, one way",
  lines: [{ label: "SUV, to ATL Airport flat fare (one way)", cents: 12500 }],
  notes: ["Gratuity not included."],
};

const operator = await hashPassword(OPERATOR_PASSWORD);
const admin = await hashPassword(ADMIN_PASSWORD);
const fleet = await hashPassword(FLEET_PASSWORD);
const rosterSecret = await hashPassword(crypto.randomUUID() + crypto.randomUUID());

const sql = `
DELETE FROM sessions;
DELETE FROM drivers;
DELETE FROM rides;
DELETE FROM rate_sheets;
DELETE FROM invoice_settings;
DELETE FROM memberships;
DELETE FROM clients;
DELETE FROM users;
DELETE FROM companies;

INSERT INTO companies (id, name, created_at, kind, status, booking_slug, trial_status, trial_started_at, billing_plan)
VALUES
  (${q(companyId)}, 'Sample Car Service', ${now}, 'individual', 'active', 'sample-car-service', 'trial', ${now}, 'solo'),
  (${q(fleetCompanyId)}, 'Fleet Sample Cars', ${now}, 'fleet', 'active', 'fleet-sample', 'trial', ${now}, 'small');

INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at, platform_admin)
VALUES
  (${q(ownerId)}, ${q(companyId)}, ${q(OPERATOR_EMAIL)}, ${q(operator.hash)}, ${q(operator.salt)}, 100000, 'pbkdf2-sha256', ${now}, ${now}, 0),
  (${q(adminId)}, NULL, ${q(ADMIN_EMAIL)}, ${q(admin.hash)}, ${q(admin.salt)}, 100000, 'pbkdf2-sha256', ${now}, ${now}, 1),
  (${q(fleetOwnerId)}, ${q(fleetCompanyId)}, ${q(FLEET_EMAIL)}, ${q(fleet.hash)}, ${q(fleet.salt)}, 100000, 'pbkdf2-sha256', ${now}, ${now}, 0),
  (${q(rosterDriverId)}, ${q(fleetCompanyId)}, ${q("roster+" + rosterDriverId + "@drivers.invalid")}, ${q(rosterSecret.hash)}, ${q(rosterSecret.salt)}, 100000, 'pbkdf2-sha256', ${now}, ${now}, 0);

INSERT INTO memberships (company_id, user_id, role, created_at)
VALUES
  (${q(companyId)}, ${q(ownerId)}, 'owner', ${now}),
  (${q(fleetCompanyId)}, ${q(fleetOwnerId)}, 'owner', ${now}),
  (${q(fleetCompanyId)}, ${q(rosterDriverId)}, 'driver', ${now});

INSERT INTO drivers (user_id, company_id, name, vehicle, plate, login, created_at, updated_at)
VALUES (${q(rosterDriverId)}, ${q(fleetCompanyId)}, 'Riley Cole', 'SUV', 'ATL1042', 'passcode', ${now}, ${now});

INSERT INTO clients (id, company_id, name, phone, email, notes, created_at, updated_at)
VALUES (${q(clientId)}, ${q(companyId)}, 'Avery Cole', '404-555-0199', 'avery@example.test', 'Sample client', ${now}, ${now});

INSERT INTO rides (
  id, company_id, client_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight,
  fare_cents, notes, status, payment, created_at, updated_at, approval, source, trip_type, vehicle_name, quote_cents, quote_json
) VALUES
  (${q(requestedId)}, ${q(companyId)}, ${q(clientId)}, '2026-11-18', '09:30', 'The Whitley Hotel, Atlanta', 'ATL Airport', 2, 'DL1234',
   0, 'Sample booking request', 'scheduled', 'unpaid', ${now}, ${now}, 'requested', 'booking', 'one-way', 'SUV', 12500, ${q(JSON.stringify(quote))}),
  (${q(scheduledId)}, ${q(companyId)}, ${q(clientId)}, '2026-11-19', '16:00', 'ATL Airport', 'Buckhead', 1, 'DL5678',
   14500, 'Confirmed sample ride', 'scheduled', 'unpaid', ${now}, ${now}, 'approved', 'operator', 'one-way', 'SUV', NULL, NULL);

INSERT INTO rate_sheets (company_id, enabled, sheet_json, updated_at)
VALUES (${q(companyId)}, 1, ${q(JSON.stringify(parsed.sheet))}, ${now});

INSERT INTO invoice_settings (company_id, business_name, phone, email, payment_instructions, updated_at)
VALUES
  (${q(companyId)}, 'Sample Car Service', '404-555-0100', 'office@example.test', 'Pay the driver by card or check.', ${now}),
  (${q(fleetCompanyId)}, 'Fleet Sample Cars', '404-555-0140', 'fleet@example.test', 'Pay the driver by card or check.', ${now});
`;

writeFileSync(new URL("./seed-local.sql", import.meta.url), sql);
const apply = spawnSync("npx", ["wrangler", "d1", "execute", "nudge-app-local", "--local", "--file", new URL("./seed-local.sql", import.meta.url).pathname], {
  stdio: "inherit",
  cwd: new URL("..", import.meta.url).pathname,
});
if (apply.status !== 0) process.exit(apply.status || 1);
console.log("Local sample operator:", OPERATOR_EMAIL, OPERATOR_PASSWORD);
console.log("Local sample fleet owner:", FLEET_EMAIL, FLEET_PASSWORD);
console.log("Local sample admin:", ADMIN_EMAIL, ADMIN_PASSWORD);
console.log("Scheduled ride:", scheduledId);
