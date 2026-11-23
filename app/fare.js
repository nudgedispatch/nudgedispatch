// Distance fare for one fleet (pure, no network, no D1). Nov 20, 2026.
//
//   fare = base + miles * perMile + minutes * perMinute     (perMinute optional, default 0)
//   fare = max(fare, minimumFare)
//   fare += airportFee                 if pickup or drop-off is an airport on our list
//   fare += extraStopFee * stops
//   round to cents
//   round trip = one way x the fleet's "Round trip = one way x" setting (new fleets start at 2,
//   as before the distance-pricing work; existing fleets keep whatever they already have)
//
// Hourly trips are not priced here (see quote-engine.js). All money is integer cents.

// Default for new fleets and when a sheet has no factor. Not a hard-coded discount.
export const ROUND_TRIP_FACTOR = 2;
export const RATE_FIELDS = ["base", "perMile", "perMinute", "minimum", "airportFee", "extraStopFee"];
const REQUIRED = ["perMile", "minimum"];
const LABELS = {
  base: "Base fare",
  perMile: "Per mile",
  perMinute: "Per minute",
  minimum: "Minimum fare",
  airportFee: "Airport fee",
  extraStopFee: "Extra stop fee",
};
const MAX = { base: 100000, perMile: 5000, perMinute: 1000, minimum: 100000, airportFee: 100000, extraStopFee: 100000 };

// "3.25", "$3.25", 3.25 -> 325. "" / null -> null. Anything else -> NaN.
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : NaN;
  if (typeof v !== "string") return NaN;
  const t = v.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

// Owner input (dollars) -> stored rates (cents). An all-blank form means "no distance rates yet"
// ({ rates: null }), so one-way and round-trip requests come through with "We'll confirm your price".
// Returns { rates } or { error }.
export function validateDistanceRates(input) {
  if (input === null || input === undefined) return { rates: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Expected distance rates." };
  const out = {};
  let any = false;
  for (const key of RATE_FIELDS) {
    const c = cents(input[key]);
    if (Number.isNaN(c)) return { error: `${LABELS[key]}: enter dollars, such as 3.25.` };
    if (c !== null && c > MAX[key]) return { error: `${LABELS[key]} looks too high.` };
    if (c !== null) any = true;
    out[key] = c;
  }
  if (!any) return { rates: null };
  for (const key of REQUIRED) {
    if (out[key] === null) return { error: `Distance rates: enter the ${LABELS[key].toLowerCase()}.` };
  }
  if (!(out.perMile > 0)) return { error: "Per mile must be more than $0." };
  return {
    rates: {
      version: 1,
      base: out.base || 0,
      perMile: out.perMile,
      perMinute: out.perMinute || 0,
      minimum: out.minimum,
      airportFee: out.airportFee || 0,
      extraStopFee: out.extraStopFee || 0,
    },
  };
}

// Stored rates -> the dollar strings the editor shows ("" for 0 on optional fields).
export function ratesForEditor(rates) {
  const d = (c, keepZero) => (c === null || c === undefined || (!c && !keepZero) ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));
  const r = rates || {};
  return {
    base: d(r.base, false),
    perMile: d(r.perMile, true),
    perMinute: d(r.perMinute, false),
    minimum: d(r.minimum, true),
    airportFee: d(r.airportFee, false),
    extraStopFee: d(r.extraStopFee, false),
  };
}

// Google Routes units -> ours.
export function metersToMiles(meters) {
  const m = Number(meters);
  return Number.isFinite(m) && m > 0 ? Math.round(m / 160.9344) / 10 : 0;
}
export function durationToMinutes(duration) {
  // Routes API duration is a string like "1834s" (or a number of seconds in tests).
  const secs = typeof duration === "number" ? duration : parseFloat(String(duration || "0").replace(/s$/, ""));
  return Number.isFinite(secs) && secs > 0 ? Math.ceil(secs / 60 - 1e-9) : 0;
}

const fmt = (c) => "$" + (c / 100).toFixed(2).replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// trip: { miles, minutes, airport (bool), stops (count), roundTrip (bool) }
// Returns { oneWayCents, totalCents, minimumApplied, lines: [{ label, cents }] } where lines sum to totalCents.
export function computeFare(rates, trip) {
  const r = rates || {};
  const miles = Math.max(0, Number(trip && trip.miles) || 0);
  const minutes = Math.max(0, Math.ceil((Number(trip && trip.minutes) || 0) - 1e-9));
  const stops = Math.max(0, Math.floor(Number(trip && trip.stops) || 0));
  const raw = (r.base || 0) + miles * (r.perMile || 0) + minutes * (r.perMinute || 0);
  const minimumApplied = raw < (r.minimum || 0);
  const ride = Math.round(Math.max(raw, r.minimum || 0));
  const tripBits = [`${miles} mi`];
  if (r.perMinute) tripBits.push(`${minutes} min`);
  const rateBits = [];
  if (r.base) rateBits.push(fmt(r.base));
  rateBits.push(`${fmt(r.perMile || 0)}/mi`);
  if (r.perMinute) rateBits.push(`${fmt(r.perMinute)}/min`);
  const lines = [{ label: minimumApplied ? `${tripBits.join(", ")} (minimum fare)` : `${tripBits.join(", ")} (${rateBits.join(" + ")})`, cents: ride }];
  let oneWay = ride;
  if (trip && trip.airport && r.airportFee) {
    lines.push({ label: "Airport fee", cents: r.airportFee });
    oneWay += r.airportFee;
  }
  if (stops && r.extraStopFee) {
    const c = stops * r.extraStopFee;
    lines.push({ label: `${stops} stop${stops === 1 ? "" : "s"} x ${fmt(r.extraStopFee)}`, cents: c });
    oneWay += c;
  }
  let total = oneWay;
  if (trip && trip.roundTrip) {
    const factor = Number(trip.roundTripFactor) >= 1 ? Number(trip.roundTripFactor) : ROUND_TRIP_FACTOR;
    total = Math.round(oneWay * factor);
    lines.push({ label: `Round trip (one way x ${factor})`, cents: total - oneWay });
  }
  return { oneWayCents: oneWay, totalCents: total, minimumApplied, lines };
}

// What is saved on the ride, so a later rate change never alters this quote.
export function rateSnapshot(rates, factor) {
  if (!rates) return null;
  const f = Number(factor) >= 1 ? Number(factor) : ROUND_TRIP_FACTOR;
  const out = { version: 1, roundTripFactor: f };
  for (const key of RATE_FIELDS) out[key] = rates[key] || 0;
  return out;
}

export const formatFareCents = fmt;
