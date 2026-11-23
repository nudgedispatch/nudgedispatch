import assert from "node:assert/strict";
import test from "node:test";
import { computeFare, validateDistanceRates, ratesForEditor, metersToMiles, durationToMinutes, rateSnapshot, ROUND_TRIP_FACTOR } from "../app/fare.js";
import { computeQuote, validateRateSheet, needsDistance, CONFIRM_SHORTLY } from "../app/quote-engine.js";
import { detectAirport, terminalsForAirline, terminalWaypoint, terminalFromProvider, airlineOf, freeWaitEnds, AIRPORTS } from "../app/airports-data.js";

// $10 base, $3/mi, $65 minimum. Cents throughout.
const RATES = { base: 1000, perMile: 300, perMinute: 0, minimum: 6500, airportFee: 0, extraStopFee: 0 };
const sum = (lines) => lines.reduce((n, l) => n + l.cents, 0);

test("fare: base + miles x per mile, lines add up to the total", () => {
  const f = computeFare(RATES, { miles: 25, minutes: 40 });
  assert.equal(f.totalCents, 1000 + 25 * 300);
  assert.equal(f.minimumApplied, false);
  assert.equal(sum(f.lines), f.totalCents);
});

test("fare: the minimum fare is a floor", () => {
  const f = computeFare(RATES, { miles: 5, minutes: 12 });
  assert.equal(f.totalCents, 6500);
  assert.equal(f.minimumApplied, true);
  assert.match(f.lines[0].label, /minimum fare/);
  // Just over the minimum is charged as computed.
  assert.equal(computeFare(RATES, { miles: 18.5, minutes: 30 }).totalCents, 1000 + 5550);
});

test("fare: per minute is off by default and adds minutes x rate when on", () => {
  assert.equal(computeFare(RATES, { miles: 20, minutes: 35 }).totalCents, 7000);
  const withMin = { ...RATES, perMinute: 50 };
  const f = computeFare(withMin, { miles: 20, minutes: 35 });
  assert.equal(f.totalCents, 7000 + 35 * 50);
  assert.match(f.lines[0].label, /35 min/);
  // Partial minutes round up.
  assert.equal(computeFare(withMin, { miles: 20, minutes: 34.2 }).totalCents, 7000 + 35 * 50);
});

test("fare: airport fee is added after the minimum, only for airport trips", () => {
  const rates = { ...RATES, airportFee: 1500 };
  assert.equal(computeFare(rates, { miles: 5, minutes: 10, airport: false }).totalCents, 6500);
  const f = computeFare(rates, { miles: 5, minutes: 10, airport: true });
  assert.equal(f.totalCents, 6500 + 1500);
  assert.deepEqual(f.lines.map((l) => l.label).slice(1), ["Airport fee"]);
  // No fee set: an airport trip costs the same as any other.
  assert.equal(computeFare(RATES, { miles: 30, minutes: 40, airport: true }).totalCents, 1000 + 9000);
});

test("fare: extra-stop fee per stop", () => {
  const rates = { ...RATES, extraStopFee: 1000 };
  const f = computeFare(rates, { miles: 30, minutes: 50, stops: 2 });
  assert.equal(f.totalCents, 1000 + 9000 + 2000);
  assert.equal(f.lines[1].label, "2 stops x $10");
  assert.equal(computeFare(rates, { miles: 30, minutes: 50, stops: 0 }).totalCents, 10000);
  assert.equal(computeFare(RATES, { miles: 30, minutes: 50, stops: 3 }).totalCents, 10000, "no stop fee set");
});

test("fare: round trip uses the fleet factor (default 2; a set factor is honoured)", () => {
  assert.equal(ROUND_TRIP_FACTOR, 2);
  const rates = { ...RATES, airportFee: 1500, extraStopFee: 1000 };
  const one = computeFare(rates, { miles: 30, minutes: 50, airport: true, stops: 1 });
  const rt = computeFare(rates, { miles: 30, minutes: 50, airport: true, stops: 1, roundTrip: true });
  assert.equal(rt.oneWayCents, one.totalCents);
  assert.equal(rt.totalCents, Math.round(one.totalCents * 2), "default is 2 x one way");
  assert.equal(sum(rt.lines), rt.totalCents);
  // Minimum applies to the one-way leg before the factor.
  assert.equal(computeFare(RATES, { miles: 2, roundTrip: true }).totalCents, Math.round(6500 * 2));
  const custom = computeFare(rates, { miles: 30, minutes: 50, airport: true, stops: 1, roundTrip: true, roundTripFactor: 1.6 });
  assert.equal(custom.totalCents, Math.round(one.totalCents * 1.6));
});

test("fare: rounding to cents", () => {
  // 12.3 mi x $2.75 = $33.825 -> + $10 base = $43.825 -> $43.83 (above a $0 minimum)
  const rates = { base: 1000, perMile: 275, perMinute: 33, minimum: 0, airportFee: 0, extraStopFee: 0 };
  const f = computeFare(rates, { miles: 12.3, minutes: 0 });
  assert.equal(f.totalCents, 4383);
  assert.ok(Number.isInteger(f.totalCents));
  // Per minute with a fraction of a cent: 7 x 33 = 231 exactly; 12.3 x 275 = 3382.5 -> total rounds once.
  assert.equal(computeFare(rates, { miles: 12.3, minutes: 7 }).totalCents, Math.round(1000 + 3382.5 + 231));
  // Round trip of an odd-cent fare is rounded once more: 4383 x 2 = 8766.
  assert.equal(computeFare(rates, { miles: 12.3, roundTrip: true }).totalCents, 8766);
});

test("units: meters to miles (1 decimal) and minutes rounded up", () => {
  assert.equal(metersToMiles(1609.344), 1);
  assert.equal(metersToMiles(29772), 18.5);
  assert.equal(metersToMiles(0), 0);
  assert.equal(durationToMinutes("1834s"), 31);
  assert.equal(durationToMinutes("1800s"), 30);
  assert.equal(durationToMinutes("61s"), 2);
  assert.equal(durationToMinutes(""), 0);
});

test("rate form: dollars in, cents stored, blanks are optional, bad input is refused", () => {
  assert.deepEqual(validateDistanceRates(null), { rates: null });
  assert.deepEqual(validateDistanceRates({ base: "", perMile: "", minimum: "" }), { rates: null });
  const ok = validateDistanceRates({ base: "10", perMile: "$3.25", perMinute: "", minimum: "65", airportFee: "15", extraStopFee: "" });
  assert.deepEqual(ok.rates, { version: 1, base: 1000, perMile: 325, perMinute: 0, minimum: 6500, airportFee: 1500, extraStopFee: 0 });
  assert.match(validateDistanceRates({ perMile: "3" }).error, /minimum fare/);
  assert.match(validateDistanceRates({ perMile: "abc", minimum: "65" }).error, /Per mile/);
  assert.match(validateDistanceRates({ perMile: "0", minimum: "65" }).error, /more than \$0/);
  assert.match(validateDistanceRates({ perMile: "3", minimum: "65", perMinute: "99" }).error, /too high/);
  assert.deepEqual(ratesForEditor(ok.rates), { base: "10", perMile: "3.25", perMinute: "", minimum: "65", airportFee: "15", extraStopFee: "" });
  assert.deepEqual(rateSnapshot(ok.rates), { version: 1, roundTripFactor: 2, base: 1000, perMile: 325, perMinute: 0, minimum: 6500, airportFee: 1500, extraStopFee: 0 });
  assert.deepEqual(rateSnapshot(ok.rates, 1.6).roundTripFactor, 1.6);
});

function sheet(distance) {
  const parsed = validateRateSheet({
    vehicles: [{ name: "SUV", seats: 6, hourlyRate: "75", minHours: 3, blockMinutes: 15, blockPrice: "18.75" }],
    flatFares: [{ place: "ATL Airport", placeKeywords: "atl", prices: { SUV: { oneWay: "145" } } }],
    distance,
  });
  assert.ok(parsed.sheet, parsed.error);
  return parsed.sheet;
}

test("quote engine: distance rates replace flat fares and price stops; hourly is unchanged", () => {
  const s = sheet({ base: "10", perMile: "3", minimum: "65", airportFee: "15", extraStopFee: "10" });
  const req = { tripType: "one-way", vehicle: "suv", pickup: "1 Main St, Alpharetta", dropoff: "ATL airport", stops: 2, airport: true };
  assert.equal(needsDistance(s, req), true, "even an 'ATL' address is routed, no flat fare");
  const q = computeQuote(s, req, { miles: 30, minutes: 41 });
  assert.equal(q.available, true);
  assert.equal(q.basis, "distance");
  assert.equal(q.totalCents, 1000 + 9000 + 1500 + 2000);
  assert.equal(q.minutes, 41);
  assert.equal(q.stops, 2);
  assert.equal(q.rates.perMile, 300);
  const rt = computeQuote(s, { ...req, tripType: "round-trip" }, { miles: 30, minutes: 41 });
  assert.equal(rt.totalCents, Math.round(13500 * 2), "new / unset fleets use x2");
  const s16 = sheet({ base: "10", perMile: "3", minimum: "65", airportFee: "15", extraStopFee: "10" });
  s16.roundTripFactor = 1.6;
  const rt16 = computeQuote(s16, { ...req, tripType: "round-trip" }, { miles: 30, minutes: 41 });
  assert.equal(rt16.totalCents, Math.round(13500 * 1.6));
  assert.equal(rt16.rates.roundTripFactor, 1.6);
  // Hourly: $75/h, 3-hour minimum, then $18.75 per 15 minutes (unchanged path).
  const h = computeQuote(s, { tripType: "hourly", vehicle: "suv", pickup: "x", hours: 4 }, null);
  assert.equal(h.basis, "hourly");
  assert.equal(h.totalCents, 7500 * 3 + 4 * 1875);
});

test("quote engine: no route (Google down or cap) means no number and the confirm message", () => {
  const s = sheet({ perMile: "3", minimum: "65" });
  const q = computeQuote(s, { tripType: "one-way", vehicle: "suv", pickup: "1 Main St", dropoff: "2 Oak St" }, null);
  assert.equal(q.available, false);
  assert.equal(q.message, CONFIRM_SHORTLY);
  assert.equal(q.totalCents, undefined);
});

test("quote engine: a sheet saved before distance rates keeps its flat fares", () => {
  const s = sheet(undefined);
  assert.equal(s.distance, null);
  const q = computeQuote(s, { tripType: "one-way", vehicle: "suv", pickup: "1 Main St", dropoff: "ATL" }, null);
  assert.equal(q.basis, "flat");
  assert.equal(q.totalCents, 14500);
});

test("airports: detection needs type airport AND one of our airports", () => {
  const atl = { types: ["airport", "point_of_interest"], lat: 33.6367, lng: -84.428 };
  assert.equal(detectAirport(atl), "ATL");
  assert.equal(detectAirport(atl, ["CLT"]), "", "not one of this fleet's airports");
  assert.equal(detectAirport({ ...atl, types: ["lodging"] }), "", "a hotel at the airport is not the airport");
  assert.equal(detectAirport({ lat: atl.lat, lng: atl.lng }), "ATL", "types left out: the location decides (no fee dodge)");
  assert.equal(detectAirport({ lat: atl.lat, lng: atl.lng, types: [] }), "ATL");
  assert.equal(detectAirport({ types: ["airport"] }), "", "no location: not detected here (the Worker re-checks by placeId)");
  assert.equal(detectAirport({ types: ["airport"], lat: 33.87, lng: -84.52 }), "", "another airport (not on our list)");
  assert.equal(detectAirport({ types: ["airport"], lat: 35.2144, lng: -80.9473 }, ["ATL", "CLT", "BNA"]), "CLT");
});

test("airports: ATL airline table follows Jesse's rule; CLT and BNA are left for Jesse/Devo", () => {
  assert.deepEqual(terminalsForAirline("ATL", "DL"), ["domestic-south", "international"]);
  assert.deepEqual(terminalsForAirline("ATL", "AA"), ["domestic-north"]);
  assert.deepEqual(terminalsForAirline("ATL", ""), [], "no airline known: no guess");
  assert.deepEqual(terminalsForAirline("CLT", "AA"), []);
  assert.deepEqual(terminalsForAirline("BNA", "WN"), []);
  assert.equal(airlineOf("dl 1234"), "DL");
  assert.equal(airlineOf("1234"), "");
});

test("airports: curb pin when set, else the terminal address; provider terminal codes map to ours", () => {
  assert.deepEqual(terminalWaypoint("ATL", "international"), { address: AIRPORTS.ATL.terminals[2].address });
  const saved = AIRPORTS.ATL.terminals[2].curb;
  AIRPORTS.ATL.terminals[2].curb = { lat: 33.64, lng: -84.41 };
  try {
    assert.deepEqual(terminalWaypoint("ATL", "international"), { location: { latLng: { latitude: 33.64, longitude: -84.41 } } });
  } finally {
    AIRPORTS.ATL.terminals[2].curb = saved;
  }
  assert.notDeepEqual(terminalWaypoint("ATL", "international"), terminalWaypoint("ATL", "domestic-north"));
  assert.deepEqual(terminalWaypoint("ATL", ""), { address: AIRPORTS.ATL.fullName });
  assert.equal(terminalFromProvider("ATL", "S"), "domestic-south");
  assert.equal(terminalFromProvider("ATL", "Terminal I"), "international");
  assert.equal(terminalFromProvider("ATL", "Z"), "");
  assert.equal(freeWaitEnds(1_000_000), 1_000_000 + 30 * 60000);
  assert.equal(freeWaitEnds(null), null);
});
