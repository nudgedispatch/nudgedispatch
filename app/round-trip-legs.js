// Different-date round trips become two linked rides (group_id + leg).
// Same-day stays one row and keeps return_date / return_time.
// Pure helpers, so they can be unit-tested without a database.

export function shouldSplitRoundTrip(tripType, pickupDate, returnDate, returnTime) {
  if (String(tripType || "") !== "round-trip") return false;
  const out = String(pickupDate || "");
  const back = String(returnDate || "");
  const time = String(returnTime || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out) || !/^\d{4}-\d{2}-\d{2}$/.test(back)) return false;
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  return back > out;
}

// Split a quoted (or typed) total so the two legs sum exactly to it.
// Prefer the known one-way amount when it is a proper share of the total (fees
// and the round-trip remainder stay on the return). Otherwise invert with the
// rate-sheet factor (default 2).
export function splitRoundTripFareCents(totalCents, opts = {}) {
  const total = Math.round(Number(totalCents) || 0);
  if (total <= 0) return { outboundCents: 0, returnCents: 0 };
  const oneWay = Number(opts.oneWayCents);
  if (Number.isFinite(oneWay) && oneWay > 0 && oneWay < total) {
    return { outboundCents: Math.round(oneWay), returnCents: total - Math.round(oneWay) };
  }
  const factor = Number(opts.factor);
  const f = Number.isFinite(factor) && factor >= 1 ? factor : 2;
  const outbound = Math.round(total / f);
  return { outboundCents: outbound, returnCents: total - outbound };
}

export function roundTripGroupId(seed) {
  const raw = String(seed || "").replace(/-/g, "").toLowerCase();
  const hex = /^[0-9a-f]{16,}$/.test(raw) ? raw.slice(0, 16) : crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return "RT-" + hex;
}

// Return leg: swap the airport side. Meet/style belong to one side only, so they are dropped.
export function flipAirport(airport) {
  if (!airport || (airport.side !== "pickup" && airport.side !== "dropoff")) return null;
  return { code: airport.code, name: airport.name, side: airport.side === "pickup" ? "dropoff" : "pickup", spot: airport.spot, spotLabel: airport.spotLabel };
}

export function isSplitLeg(row) {
  return !!(row && row.group_id && Number(row.leg) > 0);
}
