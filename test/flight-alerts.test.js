import assert from "node:assert/strict";
import test from "node:test";
import { fetchFlightSnapshot, flightAlerts, flightProvider, flightRules, normalizeFlight, shouldWatch, snapshotFromAeroApi } from "../app/flight-alerts.js";

const T = Date.parse("2026-11-12T20:00:00Z");
const snap = (offMin, extra = {}) => ({ ident: "DAL1234", scheduledArrival: T, estimatedArrival: T + offMin * 60000, cancelled: false, diverted: false, landed: false, departed: true, terminal: "S", gate: "A12", ...extra });
const kinds = (list) => list.map((a) => a.kind);

test("early arrivals alert at 15 minutes or more, not less", () => {
  assert.deepEqual(kinds(flightAlerts(null, snap(-10), {})), []);
  assert.deepEqual(kinds(flightAlerts(null, snap(-15), {})), ["early"]);
  assert.match(flightAlerts(null, snap(-22), {}, { flight: "DL1234", pickupTimeLabel: "3:00 PM" })[0].message, /22 min ahead.*Pickup stays at 3:00 PM/);
  // Operator threshold 30: 20 min early is not an early alert.
  assert.deepEqual(kinds(flightAlerts(null, snap(-20), { earlyMinutes: 30 })), []);
  assert.equal(flightRules({ earlyMinutes: 10 }).earlyMinutes, 15);
  assert.equal(flightRules({ earlyMinutes: 30 }).earlyMinutes, 30);
});

test("delays alert only beyond 30 minutes", () => {
  assert.deepEqual(kinds(flightAlerts(null, snap(30), {})), []);
  assert.deepEqual(kinds(flightAlerts(null, snap(31), {})), ["delay"]);
});

test("cancellations and diversions always alert", () => {
  assert.deepEqual(kinds(flightAlerts(null, snap(0, { cancelled: true }), {})), ["cancelled"]);
  assert.deepEqual(kinds(flightAlerts(snap(0, { cancelled: true }), snap(0, { cancelled: true }), {})), []);
  assert.deepEqual(kinds(flightAlerts(snap(0), snap(0, { diverted: true }), {})), ["diverted"]);
});

test("any other change after the first check alerts the driver", () => {
  assert.deepEqual(kinds(flightAlerts(snap(0), snap(8), {})), ["changed"]);
  assert.deepEqual(kinds(flightAlerts(snap(0), snap(2), {})), []);
  assert.deepEqual(kinds(flightAlerts(snap(0), snap(0, { gate: "B3" }), {})), ["changed"]);
  assert.deepEqual(kinds(flightAlerts(snap(0), snap(0, { terminal: "I" }), {})), ["changed"]);
  assert.deepEqual(kinds(flightAlerts(snap(0), snap(0, { landed: true }), {})), ["changed"]);
  // Same early estimate twice: one alert, same key.
  const a = flightAlerts(null, snap(-20), {});
  const b = flightAlerts(snap(-20), snap(-20), {});
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});

test("flight numbers normalize and the provider is off by default", () => {
  assert.equal(normalizeFlight("dl 1234"), "DL1234");
  assert.equal(normalizeFlight("Delta 88"), "DL88");
  assert.equal(normalizeFlight("hello"), "");
  assert.equal(flightProvider({}).ready, false);
  assert.equal(flightProvider({ FLIGHT_DATA_PROVIDER: "aeroapi" }).ready, false);
  assert.equal(flightProvider({ FLIGHT_DATA_PROVIDER: "aeroapi", FLIGHT_DATA_API_KEY: "x" }).ready, true);
});

test("AeroAPI responses map to a snapshot near the pickup", async () => {
  const data = { flights: [
    { ident: "DAL1234", scheduled_in: "2026-11-10T20:00:00Z", estimated_in: "2026-11-10T20:00:00Z" },
    { ident: "DAL1234", scheduled_in: "2026-11-12T20:00:00Z", estimated_in: "2026-11-12T19:40:00Z", terminal_destination: "S", gate_destination: "A12", actual_off: "2026-11-12T17:00:00Z" },
  ] };
  const s = snapshotFromAeroApi(data, T);
  assert.equal(s.estimatedArrival, T - 20 * 60000);
  assert.equal(s.departed, true);
  let seen = "";
  const fake = async (url, init) => { seen = url + " " + init.headers["x-apikey"]; return new Response(JSON.stringify(data), { status: 200 }); };
  const r = await fetchFlightSnapshot({ FLIGHT_DATA_PROVIDER: "aeroapi", FLIGHT_DATA_API_KEY: "k" }, "DAL1234", T, fake);
  assert.equal(r.ok, true);
  assert.match(seen, /^https:\/\/aeroapi\.flightaware\.com\/aeroapi\/flights\/DAL1234\?start=/);
  const off = await fetchFlightSnapshot({}, "DAL1234", T, fake);
  assert.equal(off.ok, false);
});

test("only scheduled rides near the pickup are watched", () => {
  const row = { flight: "DL1", status: "scheduled", approval: "approved" };
  assert.equal(shouldWatch(row, T, T + 3600e3), true);
  assert.equal(shouldWatch(row, T, T + 7 * 3600e3), false);
  assert.equal(shouldWatch({ ...row, status: "cancelled" }, T, T), false);
  assert.equal(shouldWatch({ ...row, flight: "" }, T, T), false);
});
