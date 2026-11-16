// Intermediate stops between pickup and drop-off (pure, no network, no D1).
//
// Stored on rides.stops_json as a JSON array of address strings, in trip order. A ride with no
// stops stores NULL so existing rides and the no-stop booking flow are unchanged. Any trip with
// one or more stops is priced by the operator: the booking page shows "Price on request" and the
// server never stores an automatic estimate for it.

export const MAX_STOPS = 5;
export const STOP_MAX_LENGTH = 200;
export const STOPS_PRICE_MESSAGE = "Trips with stops are priced by the operator. We'll confirm your fare when they approve the request.";

// Control characters become spaces; runs of whitespace collapse. Display code escapes on output.
function cleanStop(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// Read stops from a request body value. Missing / null / [] means no stops. Blank entries are
// dropped (an empty "Add stop" row). Returns { stops } or { error }.
export function readStops(input) {
  if (input === undefined || input === null || input === "") return { stops: [] };
  if (!Array.isArray(input)) return { error: "Stops must be a list of addresses." };
  if (input.length > MAX_STOPS * 2) return { error: `Add up to ${MAX_STOPS} stops.` };
  const stops = [];
  for (const raw of input) {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.address : raw;
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number") return { error: "Each stop must be an address." };
    const text = cleanStop(value);
    if (!text) continue;
    if (text.length > STOP_MAX_LENGTH) return { error: `Each stop can be up to ${STOP_MAX_LENGTH} characters.` };
    stops.push(text);
  }
  if (stops.length > MAX_STOPS) return { error: `Add up to ${MAX_STOPS} stops.` };
  return { stops };
}

export function stopsToStored(stops) {
  return Array.isArray(stops) && stops.length ? JSON.stringify(stops) : null;
}

// Tolerant read of rides.stops_json: always an array of at most MAX_STOPS strings.
export function parseStoredStops(text) {
  if (!text) return [];
  try {
    const value = JSON.parse(String(text));
    if (!Array.isArray(value)) return [];
    return value.filter((s) => typeof s === "string" && s.trim()).map((s) => cleanStop(s).slice(0, STOP_MAX_LENGTH)).slice(0, MAX_STOPS);
  } catch {
    return [];
  }
}

// "Stop 1: ...", one line per stop (invoice text, plain-text exports).
export function stopLines(stops) {
  return (stops || []).map((s, i) => `Stop ${i + 1}: ${s}`);
}

// One CSV cell: "1) A | 2) B".
export function stopsCell(stops) {
  return (stops || []).map((s, i) => `${i + 1}) ${s}`).join(" | ");
}
