// Nudge instant quote engine (pure, no network, no D1). Runs on the server only; the booking page
// shows whatever the Worker returns, so a rider can't change the price in the browser.
//
// Rate model (follows the demo's quote.js and Iron Gate's published quote tool, without their prices):
//   * vehicles: each with base fare + per mile, trip minimum, hourly rate + minimum hours, and an
//     optional "after the minimum, $X per N minutes" block (Iron Gate style hourly overtime).
//   * flat fares: a named place (e.g. "ATL Airport") matched by keywords on either end of the trip,
//     optionally only from/to a pickup area (e.g. "Alpharetta"). One-way and round-trip price per vehicle.
//     Flat fares need no distance lookup.
//   * distance fares: base + per mile x road miles, at least the trip minimum, x round-trip factor.
//   * extras: fees (flat $ or % of fare), optional gratuity %, rounding of the fare to $1/$5/$10.
// All money is integer cents.

export const TRIP_TYPES = ["one-way", "round-trip", "hourly"];
export const TRIP_LABELS = { "one-way": "One way", "round-trip": "Round trip", hourly: "Hourly" };
export const LIMITS = { vehicles: 6, flatFares: 20, fees: 5, keywords: 10 };
const MAX_CENTS = 10000000; // $100,000 sanity cap

function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9#&'.\- ]+/g, " ").replace(/\s+/g, " ").trim();
}
// Dollars (number or "125.50" / "$125") -> cents. "" / null -> null. Invalid -> NaN.
export function dollarsToCents(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.round(v * 100) : NaN;
  if (typeof v !== "string") return NaN;
  const t = v.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const n = Number(t);
  return n <= 100000 ? Math.round(n * 100) : NaN;
}
function numberIn(v, min, max, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < min || n > max) return NaN;
  return n;
}
function keywordList(v, fallbackName) {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = [];
  for (const k of raw) {
    const n = norm(cleanText(String(k), 40));
    if (n.length >= 2 && !out.includes(n)) out.push(n);
    if (out.length >= LIMITS.keywords) break;
  }
  if (!out.length && fallbackName) {
    const n = norm(fallbackName);
    if (n.length >= 2) out.push(n);
  }
  return out;
}
function slugId(name, used) {
  let base = norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "v";
  let id = base, i = 2;
  while (used.has(id)) id = base + "-" + i++;
  used.add(id);
  return id;
}

// Validate an operator-submitted rate sheet (dollars in the UI) and return the stored form (cents).
// Returns { sheet } or { error }.
export function validateRateSheet(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Expected a rate sheet." };
  const vehiclesIn = Array.isArray(input.vehicles) ? input.vehicles : [];
  if (!vehiclesIn.length) return { error: "Add at least one vehicle." };
  if (vehiclesIn.length > LIMITS.vehicles) return { error: `Use up to ${LIMITS.vehicles} vehicles.` };
  const usedIds = new Set();
  const names = new Set();
  const vehicles = [];
  for (const [i, v] of vehiclesIn.entries()) {
    const n = i + 1;
    const name = cleanText(v && v.name, 30);
    if (!name) return { error: `Vehicle ${n}: enter a name, such as Sedan or SUV.` };
    if (names.has(name.toLowerCase())) return { error: `Two vehicles are named ${name}. Use different names.` };
    names.add(name.toLowerCase());
    const seats = numberIn(v.seats, 1, 56, null);
    if (Number.isNaN(seats) || (seats !== null && !Number.isInteger(seats))) return { error: `${name}: seats must be a whole number from 1 to 56.` };
    const money = {};
    for (const key of ["base", "perMile", "minimum", "hourlyRate", "blockPrice"]) {
      const c = dollarsToCents(v[key]);
      if (Number.isNaN(c)) return { error: `${name}: enter amounts in dollars, such as 65 or 3.25.` };
      money[key] = c;
    }
    if (money.perMile !== null && money.perMile > 5000) return { error: `${name}: the per-mile rate looks too high.` };
    const minHours = numberIn(v.minHours, 0, 24, null);
    if (Number.isNaN(minHours) || (minHours !== null && Math.round(minHours * 2) !== minHours * 2)) return { error: `${name}: minimum hours must be in half hours, from 0 to 24.` };
    const blockMinutes = numberIn(v.blockMinutes, 0, 60, null);
    if (Number.isNaN(blockMinutes) || (blockMinutes !== null && ![0, 15, 30, 60].includes(blockMinutes))) return { error: `${name}: after-minimum billing must be every 15, 30, or 60 minutes.` };
    if ((blockMinutes && money.blockPrice === null) || (!blockMinutes && money.blockPrice)) return { error: `${name}: set both the after-minimum block and its price, or neither.` };
    if (money.blockPrice !== null && money.hourlyRate === null) return { error: `${name}: set an hourly rate before after-minimum billing.` };
    const distance = money.base !== null || money.perMile !== null;
    vehicles.push({
      id: slugId(name, usedIds),
      name,
      seats,
      base: money.base,
      perMile: money.perMile,
      minimum: money.minimum,
      hourlyRate: money.hourlyRate,
      minHours: money.hourlyRate !== null ? (minHours || 0) : null,
      blockMinutes: money.hourlyRate !== null && blockMinutes ? blockMinutes : null,
      blockPrice: money.hourlyRate !== null && blockMinutes ? money.blockPrice : null,
      distance,
    });
  }
  const byName = new Map(vehicles.map((v) => [v.name.toLowerCase(), v]));
  const fixIdFor = (key) => {
    // UI sends prices keyed by vehicle name (ids are derived on save).
    const v = byName.get(String(key || "").toLowerCase()) || vehicles.find((x) => x.id === key);
    return v ? v.id : "";
  };

  const faresIn = Array.isArray(input.flatFares) ? input.flatFares : [];
  if (faresIn.length > LIMITS.flatFares) return { error: `Use up to ${LIMITS.flatFares} flat fares.` };
  const flatFares = [];
  const fareIds = new Set();
  for (const [i, f] of faresIn.entries()) {
    const n = i + 1;
    const place = cleanText(f && f.place, 60);
    if (!place) return { error: `Flat fare ${n}: enter the place, such as ATL Airport.` };
    const placeKeywords = keywordList(f.placeKeywords, place);
    const area = cleanText(f.area, 60);
    const areaKeywords = area ? keywordList(f.areaKeywords, area) : [];
    const pricesIn = f.prices && typeof f.prices === "object" ? f.prices : {};
    const prices = {};
    for (const [key, p] of Object.entries(pricesIn)) {
      const id = fixIdFor(key);
      if (!id || !p || typeof p !== "object") continue;
      const oneWay = dollarsToCents(p.oneWay);
      const roundTrip = dollarsToCents(p.roundTrip);
      if (Number.isNaN(oneWay) || Number.isNaN(roundTrip)) return { error: `${place}: enter prices in dollars, such as 95.` };
      if (oneWay === null && roundTrip === null) continue;
      if (oneWay === null) return { error: `${place}: set the one-way price before a round-trip price.` };
      prices[id] = { oneWay, roundTrip };
    }
    if (!Object.keys(prices).length) return { error: `${place}: set a one-way price for at least one vehicle.` };
    flatFares.push({ id: slugId(place + (area ? "-" + area : ""), fareIds), place, placeKeywords, area, areaKeywords, prices });
  }

  const feesIn = Array.isArray(input.fees) ? input.fees : [];
  if (feesIn.length > LIMITS.fees) return { error: `Use up to ${LIMITS.fees} fees.` };
  const fees = [];
  for (const [i, fee] of feesIn.entries()) {
    const label = cleanText(fee && fee.label, 40);
    if (!label) return { error: `Fee ${i + 1}: enter a name, such as Airport fee.` };
    const kind = fee.kind === "percent" ? "percent" : "flat";
    const appliesTo = fee.appliesTo === "flat" ? "flat" : "all";
    if (kind === "percent") {
      const pct = numberIn(fee.amount, 0, 50, NaN);
      if (Number.isNaN(pct)) return { error: `${label}: enter a percent from 0 to 50.` };
      fees.push({ label, kind, appliesTo, percent: Math.round(pct * 100) / 100 });
    } else {
      const c = dollarsToCents(fee.amount);
      if (c === null || Number.isNaN(c) || c > 100000) return { error: `${label}: enter an amount in dollars up to 1000.` };
      fees.push({ label, kind, appliesTo, cents: c });
    }
  }

  const gratuityPercent = numberIn(input.gratuityPercent, 0, 30, 0);
  if (Number.isNaN(gratuityPercent)) return { error: "Gratuity must be a percent from 0 to 30 (0 means not included)." };
  const roundTripFactor = numberIn(input.roundTripFactor, 1, 2.5, 2);
  if (Number.isNaN(roundTripFactor)) return { error: "Round trip multiplier must be from 1 to 2.5." };
  const roundTo = numberIn(input.roundTo, 0, 10, 1);
  if (Number.isNaN(roundTo) || ![0, 1, 5, 10].includes(roundTo)) return { error: "Round fares to $1, $5, or $10." };
  const maxMiles = numberIn(input.maxMiles, 5, 500, 100);
  if (Number.isNaN(maxMiles)) return { error: "Longest trip to estimate must be from 5 to 500 miles." };

  const priced = vehicles.some((v) => v.distance || v.hourlyRate !== null) || flatFares.length > 0;
  if (!priced) return { error: "Add a per-mile, hourly, or flat price so riders can see an estimate." };
  return {
    sheet: {
      version: 1,
      currency: "USD",
      vehicles,
      flatFares,
      fees,
      gratuityPercent: Math.round(gratuityPercent * 100) / 100,
      roundTripFactor: Math.round(roundTripFactor * 100) / 100,
      roundTo: roundTo || 1,
      maxMiles: Math.round(maxMiles),
    },
  };
}

// The stored sheet back into the dollar form the editor uses.
export function sheetForEditor(sheet) {
  const d = (c) => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));
  const vehicles = (sheet.vehicles || []).map((v) => ({
    id: v.id, name: v.name, seats: v.seats ?? "", base: d(v.base), perMile: d(v.perMile), minimum: d(v.minimum),
    hourlyRate: d(v.hourlyRate), minHours: v.minHours ?? "", blockMinutes: v.blockMinutes || "", blockPrice: d(v.blockPrice),
  }));
  const nameOf = new Map((sheet.vehicles || []).map((v) => [v.id, v.name]));
  return {
    vehicles,
    flatFares: (sheet.flatFares || []).map((f) => ({
      place: f.place, placeKeywords: (f.placeKeywords || []).join(", "), area: f.area || "", areaKeywords: (f.areaKeywords || []).join(", "),
      prices: Object.fromEntries(Object.entries(f.prices || {}).filter(([id]) => nameOf.has(id)).map(([id, p]) => [nameOf.get(id), { oneWay: d(p.oneWay), roundTrip: d(p.roundTrip) }])),
    })),
    fees: (sheet.fees || []).map((f) => ({ label: f.label, kind: f.kind, appliesTo: f.appliesTo || "all", amount: f.kind === "percent" ? String(f.percent) : d(f.cents) })),
    gratuityPercent: sheet.gratuityPercent || 0,
    roundTripFactor: sheet.roundTripFactor || 2,
    roundTo: sheet.roundTo || 1,
    maxMiles: sheet.maxMiles || 100,
  };
}

// What the public booking page may know (no prices).
export function publicSheetInfo(sheet) {
  return {
    vehicles: (sheet.vehicles || []).map((v) => ({ id: v.id, name: v.name, seats: v.seats, hourly: v.hourlyRate !== null, minHours: v.minHours || 0 })),
    places: [...new Set((sheet.flatFares || []).map((f) => f.place))].slice(0, 8),
    gratuityPercent: sheet.gratuityPercent || 0,
  };
}

// Whole-word keyword match. Returns the longest matching keyword length (0 = no match).
function matchLen(text, keywords) {
  const t = " " + norm(text) + " ";
  let best = 0;
  for (const k of keywords || []) {
    if (!k) continue;
    const e = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp("(^|[^a-z0-9])" + e + "([^a-z0-9]|$)").test(t) && k.length > best) best = k.length;
  }
  return best;
}

// Find the flat fare for this trip, either direction. Area-specific fares beat "from anywhere" fares.
export function findFlatFare(sheet, vehicleId, pickup, dropoff) {
  let best = null, bestScore = -1;
  for (const f of sheet.flatFares || []) {
    const price = f.prices && f.prices[vehicleId];
    if (!price) continue;
    for (const [placeEnd, otherEnd, dir] of [[dropoff, pickup, "to"], [pickup, dropoff, "from"]]) {
      const p = matchLen(placeEnd, f.placeKeywords);
      if (!p) continue;
      let score = p;
      if (f.area) {
        const a = matchLen(otherEnd, f.areaKeywords);
        if (!a) continue;
        score += 1000 + a;
      } else if (matchLen(otherEnd, f.placeKeywords)) {
        continue; // both ends are the same place: not a flat-fare trip
      }
      if (score > bestScore) { best = { fare: f, price, dir }; bestScore = score; }
    }
  }
  return best;
}

const roundUp = (cents, dollars) => Math.ceil(cents / (Math.max(1, dollars) * 100) - 1e-9) * Math.max(1, dollars) * 100;
const fmt = (c) => "$" + (c / 100).toFixed(2).replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function hoursText(h) {
  const w = Math.floor(h), m = Math.round((h - w) * 60);
  return w + (m ? ":" + String(m).padStart(2, "0") : "") + " h";
}

// Does this trip need a road-distance lookup? (Only one-way/round-trip, no flat fare, vehicle priced by distance.)
export function needsDistance(sheet, req) {
  if (!req || req.tripType === "hourly") return false;
  const v = (sheet.vehicles || []).find((x) => x.id === req.vehicle);
  if (!v || !v.distance) return false;
  if (!req.pickup || !req.dropoff) return false;
  return !findFlatFare(sheet, v.id, req.pickup, req.dropoff);
}

// req: { tripType, vehicle (id), pickup, dropoff, hours, passengers }
// route: { miles, minutes } | null  (from the Worker's routing lookup; null = unavailable)
// Returns { available: true, totalCents, basis, label, lines:[{label,cents}], notes:[], miles?, minutes? }
//      or { available: false, reason, message }
export function computeQuote(sheet, req, route) {
  const tripType = TRIP_TYPES.includes(req.tripType) ? req.tripType : "one-way";
  const v = (sheet.vehicles || []).find((x) => x.id === req.vehicle);
  if (!v) return { available: false, reason: "vehicle", message: "Choose a vehicle to see an estimate." };
  const notes = [];
  if (v.seats && Number(req.passengers) > v.seats) notes.push(`${v.name} seats up to ${v.seats}. The operator may suggest a larger vehicle.`);
  let fareCents, basis, label, fareLine;
  let extra = {};
  if (tripType === "hourly") {
    if (v.hourlyRate === null) return { available: false, reason: "no-hourly", message: `${v.name} isn't offered by the hour. Send the request and the operator will quote it.` };
    const h = Number(req.hours);
    if (!(h > 0) || h > 24) return { available: false, reason: "hours", message: "Choose how many hours." };
    const minH = v.minHours || 0;
    if (v.blockMinutes && v.blockPrice !== null && h > minH) {
      const blocks = Math.ceil(((h - minH) * 60) / v.blockMinutes - 1e-9);
      fareCents = v.hourlyRate * minH + blocks * v.blockPrice;
      fareLine = `${v.name}, ${hoursText(minH)} at ${fmt(v.hourlyRate)}/h + ${blocks} x ${v.blockMinutes} min at ${fmt(v.blockPrice)}`;
    } else {
      const billed = Math.max(h, minH);
      fareCents = Math.round(v.hourlyRate * billed);
      fareLine = `${v.name}, ${hoursText(billed)} at ${fmt(v.hourlyRate)}/h`;
      if (billed > h) notes.push(`${minH}-hour minimum.`);
    }
    basis = "hourly";
    label = "Hourly, " + hoursText(Math.max(h, 0));
  } else {
    if (!req.pickup || !req.dropoff) return { available: false, reason: "addresses", message: "Enter pickup and drop-off to see an estimate." };
    const legs = tripType === "round-trip";
    const flat = findFlatFare(sheet, v.id, req.pickup, req.dropoff);
    if (flat) {
      const p = flat.price;
      fareCents = legs ? (p.roundTrip !== null && p.roundTrip !== undefined ? p.roundTrip : Math.round(p.oneWay * sheet.roundTripFactor)) : p.oneWay;
      const where = flat.fare.area ? (flat.dir === "to" ? `${flat.fare.area} to ${flat.fare.place}` : `${flat.fare.place} to ${flat.fare.area}`) : (flat.dir === "to" ? `To ${flat.fare.place}` : `From ${flat.fare.place}`);
      fareLine = `${v.name}, ${flat.fare.area ? where : where.charAt(0).toLowerCase() + where.slice(1)} flat fare (${legs ? "round trip" : "one way"})`;
      basis = "flat";
      label = where + (legs ? ", round trip" : ", one way");
    } else {
      if (!v.distance) return { available: false, reason: "no-rate", message: "This trip isn't on the rate sheet. Send the request and the operator will quote it." };
      if (!route || !(route.miles > 0)) return { available: false, reason: "no-distance", message: "We couldn't estimate this trip. Send the request and the operator will confirm the price." };
      if (route.miles > (sheet.maxMiles || 100)) return { available: false, reason: "too-far", message: "This trip is longer than we estimate online. Send the request and the operator will quote it." };
      const miles = Math.round(route.miles * 10) / 10;
      const oneWay = Math.max((v.base || 0) + Math.round((v.perMile || 0) * miles), v.minimum || 0);
      fareCents = legs ? Math.round(oneWay * sheet.roundTripFactor) : oneWay;
      fareLine = `${v.name}, ${miles} mi` + (v.base ? ` (${fmt(v.base)} + ${fmt(v.perMile || 0)}/mi)` : ` at ${fmt(v.perMile || 0)}/mi`) + (legs ? `, round trip x${sheet.roundTripFactor}` : "");
      if (v.minimum && (v.base || 0) + Math.round((v.perMile || 0) * miles) < v.minimum) notes.push(`${fmt(v.minimum)} trip minimum.`);
      basis = "distance";
      label = legs ? "Round trip by road distance" : "One way by road distance";
      extra = { miles, minutes: route.minutes != null ? Math.round(route.minutes) : null };
    }
  }
  if (basis !== "flat") fareCents = roundUp(fareCents, sheet.roundTo || 1);
  if (fareCents > MAX_CENTS) return { available: false, reason: "too-large", message: "Send the request and the operator will quote it." };
  const lines = [{ label: fareLine, cents: fareCents }];
  let total = fareCents;
  for (const fee of sheet.fees || []) {
    const c = fee.kind === "percent" ? Math.round((fareCents * fee.percent) / 100) : fee.cents;
    if (!c || (fee.appliesTo === "flat" && basis !== "flat")) continue;
    lines.push({ label: fee.kind === "percent" ? `${fee.label} (${fee.percent}%)` : fee.label, cents: c });
    total += c;
  }
  if (sheet.gratuityPercent > 0) {
    const g = Math.round((fareCents * sheet.gratuityPercent) / 100);
    lines.push({ label: `Gratuity (${sheet.gratuityPercent}%)`, cents: g });
    total += g;
  } else {
    notes.push("Gratuity not included.");
  }
  return { available: true, totalCents: total, basis, tripType, vehicle: v.name, label, lines, notes, ...extra, ...(tripType === "hourly" ? { hours: Number(req.hours) } : {}) };
}

export const formatCents = fmt;
