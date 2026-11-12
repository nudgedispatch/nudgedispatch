import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRPORT_PRESETS, bookableVehicles, fleetClasses, presetConfig, publicAirportInfo, readAirportChoice, riderMeetingNote,
  airportSummary, seatsFor, validateAirportConfig, validateCapacities, vehicleClassOf, vehicleForPassengers, vehiclesForPassengers,
} from "../app/airport-booking.js";

const atl = presetConfig(["ATL"]);
const sedan = { id: "sedan", name: "Sedan", seats: 4 };
const suv = { id: "suv", name: "SUV", seats: 6 };

test("no airport settings means the plain booking page", () => {
  assert.deepEqual(validateAirportConfig(null).config, { version: 1, airports: [] });
  assert.deepEqual(publicAirportInfo(validateAirportConfig(null).config), []);
  assert.deepEqual(readAirportChoice({ pickup: "1 Main St" }, validateAirportConfig(null).config, "suv"), { airport: null });
});

test("the ATL preset validates and lists the three terminals", () => {
  assert.equal(atl.airports.length, 1);
  assert.deepEqual(atl.airports[0].spots.map((s) => s.id), ["domestic-north", "domestic-south", "international"]);
  assert.equal(validateAirportConfig({ airports: [AIRPORT_PRESETS.ATL, AIRPORT_PRESETS.ATL] }).error, "ATL is listed twice.");
  assert.match(validateAirportConfig({ airports: [{ code: "ATL", spots: [] }] }).error, /terminal/);
  assert.match(validateAirportConfig({ airports: [{ code: "x", spots: [{ label: "A" }] }] }).error, /code/);
  assert.match(validateAirportConfig({ airports: [{ code: "CLT", spots: [{ label: "Main" }], pickupMeet: { options: [{ label: "Curb" }], default: "inside" } }] }).error, /default/);
});

test("a black SUV pickup at ATL defaults to the Legacy West Curb (W1 and W2)", () => {
  const r = readAirportChoice({ airport: { code: "ATL", side: "pickup", spot: "domestic-south" } }, atl, "suv");
  assert.equal(r.address, "ATL Airport - Domestic Terminal South (Delta)");
  assert.equal(r.airport.side, "pickup");
  assert.equal(r.airport.meet.id, "legacy-west-curb");
  assert.match(riderMeetingNote(r.airport), /Legacy West Curb \(W1 and W2\)/);
  assert.match(airportSummary(r.airport), /Meet at Legacy West Curb/);
  // Black SUVs: Legacy West Curb is the only pickup point (no inside meet-and-greet).
  assert.match(readAirportChoice({ airport: { side: "pickup", spot: "international", meet: "inside" } }, atl, "suv").error, /meet/);
  assert.equal(readAirportChoice({ airport: { side: "pickup", spot: "international", meet: "inside" } }, atl, "sedan").airport.meet.id, "inside");
  // Curbside is for sedans and vans in the example; an SUV cannot pick it.
  assert.match(readAirportChoice({ airport: { side: "pickup", spot: "international", meet: "curbside" } }, atl, "suv").error, /meet/);
  assert.equal(readAirportChoice({ airport: { side: "pickup", spot: "international" } }, atl, "sedan").airport.meet.id, "curbside");
});

test("airport pickup needs a terminal; the airport never lands on the other side", () => {
  assert.match(readAirportChoice({ airport: { code: "ATL", side: "pickup" } }, atl, "suv").error, /terminal/);
  assert.match(readAirportChoice({ airport: { code: "ATL", side: "sideways", spot: "international" } }, atl, "suv").error, /pickup or drop-off/);
  const drop = readAirportChoice({ airport: { code: "ATL", side: "dropoff", spot: "domestic-north" } }, atl, "suv");
  assert.equal(drop.airport.side, "dropoff");
  assert.equal(drop.airport.meet, undefined);
});

test("drop-off is topside for black SUVs by default and the client can pick curbside", () => {
  const def = readAirportChoice({ airport: { side: "dropoff", spot: "domestic-south" } }, atl, "suv");
  assert.equal(def.airport.style.id, "topside");
  assert.match(riderMeetingNote(def.airport), /^Drop-off: Topside/);
  const curb = readAirportChoice({ airport: { side: "dropoff", spot: "domestic-south", style: "curbside" } }, atl, "suv");
  assert.equal(curb.airport.style.id, "curbside");
  assert.match(airportSummary(curb.airport), /Curbside drop-off/);
  assert.equal(readAirportChoice({ airport: { side: "dropoff", spot: "domestic-south" } }, atl, "sedan").airport.style.id, "curbside");
});

test("topside or curbside is offered only at Domestic Terminal South (Delta)", () => {
  for (const spot of ["domestic-north", "international"]) {
    const r = readAirportChoice({ airport: { side: "dropoff", spot, style: "topside" } }, atl, "suv");
    assert.equal(r.error, undefined);
    assert.equal(r.airport.style, undefined);
    assert.doesNotMatch(riderMeetingNote(r.airport) || "", /topside|curbside/i);
  }
  const pub = publicAirportInfo(atl);
  assert.deepEqual(pub[0].dropoffStyle.spots, ["domestic-south"]);
  assert.deepEqual(pub[0].pickupMeet.options.filter((o) => !o.classes || o.classes.includes("suv")).map((o) => o.id), ["legacy-west-curb"]);
});

test("vehicle classes come from roster text; an SUV-only fleet hides the sedan", () => {
  assert.equal(vehicleClassOf("Black Chevy Suburban"), "suv");
  assert.equal(vehicleClassOf("Cadillac Escalade ESV"), "suv");
  assert.equal(vehicleClassOf("Mercedes S-Class"), "sedan");
  assert.equal(vehicleClassOf("Sprinter van"), "sprinter");
  assert.equal(vehicleClassOf(""), "");
  const classes = fleetClasses([{ vehicle: "Black Suburban" }, { vehicle: "Lincoln Continental", deleted_at: 5 }]);
  assert.deepEqual([...classes], ["suv"]);
  assert.deepEqual(bookableVehicles([sedan, suv], classes).map((v) => v.id), ["suv"]);
  assert.deepEqual(bookableVehicles([sedan, suv], fleetClasses([{ vehicle: "Suburban" }, { vehicle: "Camry sedan" }])).map((v) => v.id), ["sedan", "suv"]);
  assert.deepEqual(bookableVehicles([sedan, suv], new Set()).map((v) => v.id), ["sedan", "suv"]);
});

test("sedans hold 3 passengers by default; 4 or more is SUV only; fleets can change it", () => {
  assert.equal(seatsFor(sedan), 3);
  assert.equal(seatsFor(suv), 6);
  assert.deepEqual(vehiclesForPassengers([sedan, suv], 3).map((v) => v.id), ["sedan", "suv"]);
  assert.deepEqual(vehiclesForPassengers([sedan, suv], 4).map((v) => v.id), ["suv"]);
  assert.equal(vehicleForPassengers([sedan, suv], 2).id, "sedan");
  assert.equal(vehicleForPassengers([sedan, suv], 5).id, "suv");
  const caps = validateCapacities({ sedan: 4 }).capacities;
  assert.deepEqual(vehiclesForPassengers([sedan, suv], 4, caps).map((v) => v.id), ["sedan", "suv"]);
  assert.match(validateCapacities({ sedan: 0 }).error, /1 to 56/);
  assert.match(validateCapacities({ hovercraft: 2 }).error, /Unknown/);
});
