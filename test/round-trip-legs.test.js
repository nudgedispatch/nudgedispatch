import assert from "node:assert/strict";
import test from "node:test";
import { computeQuote, validateRateSheet } from "../app/quote-engine.js";
import { shouldSplitRoundTrip, splitRoundTripFareCents, roundTripGroupId, flipAirport, isSplitLeg } from "../app/round-trip-legs.js";
import { TRIAL_SPLIT_ROUND_TRIP_COUNTS_AS, countCompletedForTrial, trialCompletedRideSql } from "../app/trial.js";

test("shouldSplitRoundTrip only when the return is on a later date with a time", () => {
  assert.equal(shouldSplitRoundTrip("round-trip", "2026-12-01", "2026-12-03", "17:00"), true);
  assert.equal(shouldSplitRoundTrip("round-trip", "2026-12-01", "2026-12-01", "17:00"), false);
  assert.equal(shouldSplitRoundTrip("round-trip", "2026-12-01", "2026-12-03", ""), false);
  assert.equal(shouldSplitRoundTrip("round-trip", "2026-12-01", "", "17:00"), false);
  assert.equal(shouldSplitRoundTrip("one-way", "2026-12-01", "2026-12-03", "17:00"), false);
  assert.equal(shouldSplitRoundTrip("hourly", "2026-12-01", "2026-12-03", "17:00"), false);
  assert.equal(shouldSplitRoundTrip("round-trip", "2026-12-03", "2026-12-01", "17:00"), false);
});

test("splitRoundTripFareCents sums to the quote and prefers a known one-way share", () => {
  assert.deepEqual(splitRoundTripFareCents(19300, { oneWayCents: 10000, factor: 1.93 }), { outboundCents: 10000, returnCents: 9300 });
  assert.deepEqual(splitRoundTripFareCents(20000, { factor: 2 }), { outboundCents: 10000, returnCents: 10000 });
  const odd = splitRoundTripFareCents(101, { factor: 2 });
  assert.equal(odd.outboundCents + odd.returnCents, 101);
  assert.deepEqual(splitRoundTripFareCents(0), { outboundCents: 0, returnCents: 0 });
  // oneWay at or above the total is ignored; invert with the factor instead.
  assert.deepEqual(splitRoundTripFareCents(5000, { oneWayCents: 5000, factor: 2 }), { outboundCents: 2500, returnCents: 2500 });
});

test("distance and flat round-trip quotes split into shares that sum to the total", () => {
  const parsed = validateRateSheet({
    vehicles: [{ name: "Sedan", seats: 3, base: "15", perMile: "2.5" }],
    flatFares: [{ place: "ATL Airport", placeKeywords: "atl, airport", prices: { Sedan: { oneWay: "95" } } }],
    fees: [{ label: "Fuel", kind: "flat", amount: "5" }],
    roundTripFactor: 2,
  });
  assert.equal(parsed.error, undefined);
  const vehicle = parsed.sheet.vehicles[0].id;
  const flat = computeQuote(parsed.sheet, { tripType: "round-trip", vehicle, pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport" }, null);
  assert.equal(flat.available, true);
  assert.equal(flat.oneWayCents, 9500);
  const flatSplit = splitRoundTripFareCents(flat.totalCents, { oneWayCents: flat.oneWayCents, factor: flat.roundTripFactor });
  assert.equal(flatSplit.outboundCents + flatSplit.returnCents, flat.totalCents);
  assert.equal(flatSplit.outboundCents, 9500);

  const distance = computeQuote(parsed.sheet, { tripType: "round-trip", vehicle, pickup: "100 Main St, Alpharetta", dropoff: "200 Pine St, Roswell" }, { miles: 10, minutes: 20 });
  assert.equal(distance.available, true);
  assert.ok(distance.oneWayCents > 0);
  const distSplit = splitRoundTripFareCents(distance.totalCents, { oneWayCents: distance.oneWayCents, factor: distance.roundTripFactor });
  assert.equal(distSplit.outboundCents + distSplit.returnCents, distance.totalCents);
});

test("roundTripGroupId, flipAirport, and isSplitLeg", () => {
  assert.equal(roundTripGroupId("abcdef0123456789ffff"), "RT-abcdef0123456789");
  assert.equal(roundTripGroupId("a1b2c3d4-e5f6-7890-abcd-ef0123456789"), "RT-a1b2c3d4e5f67890");
  assert.match(roundTripGroupId(""), /^RT-[0-9a-f]{16}$/);
  assert.deepEqual(flipAirport({ code: "ATL", name: "ATL", side: "pickup", spot: "domestic-south", spotLabel: "Domestic South", meet: { id: "x", label: "Curb" } }), { code: "ATL", name: "ATL", side: "dropoff", spot: "domestic-south", spotLabel: "Domestic South" });
  assert.equal(flipAirport(null), null);
  assert.equal(isSplitLeg({ group_id: "RT-abc", leg: 1 }), true);
  assert.equal(isSplitLeg({ group_id: "", leg: null }), false);
});

test("a split round trip counts as 1 completed trial ride by default, and the switch is one constant", () => {
  assert.equal(TRIAL_SPLIT_ROUND_TRIP_COUNTS_AS, 1);
  const rows = [
    { id: "a", group_id: "RT-1", status: "completed" },
    { id: "b", group_id: "RT-1", status: "completed" },
    { id: "c", group_id: "", status: "completed" },
    { id: "d", group_id: "RT-2", status: "scheduled" },
  ];
  assert.equal(countCompletedForTrial(rows), 2, "the pair counts once, plus the ungrouped completed ride");
  assert.match(trialCompletedRideSql(), /group_id/);
});
