// The airport list we maintain (Nov 20, 2026). Fleets tick which of these they serve in
// More > Rates; they never set up terminals or pins themselves. To add an airport, add an entry
// here (code, name, center, terminals, airlines) and ship it.
//
// center/radiusKm: used only to recognise an autocomplete Place of type "airport" as this airport.
//   Approximate public airport coordinates. TODO(Devo): confirm before go-live.
// terminals[].curb: the curb pin the Routes call uses for this terminal, so ATL International vs
//   Domestic mileage is right. null = not set yet; routing then uses terminals[].address instead.
//   TODO(Devo): set every curb pin ({ lat, lng }) from the real pickup/drop-off curb.
// terminals[].providerCodes: terminal strings the flight provider may return for this terminal
//   (AeroAPI terminal_destination). TODO(Devo): confirm against real AeroAPI responses.
// airlines: airline (IATA code) -> terminal ids. One id pre-selects that terminal; two or more
//   means "depends on the flight" and the rider picks among them. "*" is every other airline.

export const AIRPORTS = {
  ATL: {
    code: "ATL",
    name: "ATL Airport",
    fullName: "Hartsfield-Jackson Atlanta International Airport",
    center: { lat: 33.6407, lng: -84.4277 },
    radiusKm: 6,
    terminals: [
      { id: "domestic-north", label: "Domestic Terminal North", address: "Domestic Terminal North, Hartsfield-Jackson Atlanta International Airport, Atlanta, GA", curb: null, providerCodes: ["N"] },
      { id: "domestic-south", label: "Domestic Terminal South (Delta)", address: "Domestic Terminal South, Hartsfield-Jackson Atlanta International Airport, Atlanta, GA", curb: null, providerCodes: ["S"] },
      { id: "international", label: "International Terminal", address: "Maynard H. Jackson Jr. International Terminal, Hartsfield-Jackson Atlanta International Airport, Atlanta, GA", curb: null, providerCodes: ["I", "F"] },
    ],
    // Jesse's rule: Delta uses Domestic South or International depending on the flight; most other
    // airlines use Domestic North. TODO(Jesse): list any other airline that is not Domestic North.
    airlines: {
      DL: ["domestic-south", "international"],
      "*": ["domestic-north"],
    },
    // Booking-page choices (unchanged from the earlier ATL preset).
    pickupMeet: {
      options: [
        { id: "legacy-west-curb", label: "Legacy West Curb (W1 and W2)", detail: "Black SUV pickups at ATL are at the Legacy West Curb, zones W1 and W2. Your driver meets you there.", classes: ["suv"] },
        { id: "curbside", label: "Curbside", detail: "Your driver meets you at the arrivals curb.", classes: ["sedan", "van"] },
        { id: "inside", label: "Inside meet-and-greet", detail: "Your driver meets you inside at baggage claim and walks you to the car.", classes: ["sedan", "van", "sprinter", "bus"] },
      ],
      default: "curbside",
      defaultByClass: { suv: "legacy-west-curb" },
    },
    dropoffStyle: {
      options: [
        { id: "topside", label: "Topside", detail: "Drop-off on the upper-level departures roadway." },
        { id: "curbside", label: "Curbside", detail: "Drop-off at the curb." },
      ],
      default: "curbside",
      defaultByClass: { suv: "topside" },
      spots: ["domestic-south"],
    },
  },
  CLT: {
    code: "CLT",
    name: "CLT Airport",
    fullName: "Charlotte Douglas International Airport",
    center: { lat: 35.214, lng: -80.9431 },
    radiusKm: 5,
    // TODO(Jesse/Devo): confirm the terminal names riders should pick from, and set curb pins.
    terminals: [
      { id: "main", label: "Main terminal (TODO: verify)", address: "Charlotte Douglas International Airport, Charlotte, NC", curb: null, providerCodes: [] },
    ],
    // TODO(Jesse/Devo): CLT airline-to-terminal table. Empty means the rider picks the terminal.
    airlines: {},
  },
  BNA: {
    code: "BNA",
    name: "BNA Airport",
    fullName: "Nashville International Airport",
    center: { lat: 36.1263, lng: -86.6774 },
    radiusKm: 5,
    // TODO(Jesse/Devo): confirm the terminal names riders should pick from, and set curb pins.
    terminals: [
      { id: "main", label: "Main terminal (TODO: verify)", address: "Nashville International Airport, Nashville, TN", curb: null, providerCodes: [] },
    ],
    // TODO(Jesse/Devo): BNA airline-to-terminal table. Empty means the rider picks the terminal.
    airlines: {},
  },
};

export const AIRPORT_CODES = Object.keys(AIRPORTS);

export function airportByCode(code) {
  const c = String(code || "").toUpperCase();
  return Object.prototype.hasOwnProperty.call(AIRPORTS, c) ? AIRPORTS[c] : null;
}

export function terminalOf(code, terminalId) {
  const a = airportByCode(code);
  return a ? a.terminals.find((t) => t.id === terminalId) || null : null;
}

// Routes API waypoint for an airport terminal: the curb pin when set, else the terminal address.
// No terminal: the airport's general location by name.
export function terminalWaypoint(code, terminalId) {
  const a = airportByCode(code);
  if (!a) return null;
  const t = terminalId ? a.terminals.find((x) => x.id === terminalId) : null;
  if (t && t.curb && Number.isFinite(t.curb.lat) && Number.isFinite(t.curb.lng)) {
    return { location: { latLng: { latitude: t.curb.lat, longitude: t.curb.lng } } };
  }
  return { address: t ? t.address : a.fullName };
}

function kmBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Is this Place one of our airports? The location decides which airport (within radiusKm of the
// airport's center, limited to the fleet's ticked codes); the types only rule it out:
//   types include "airport"            -> airport (if the location matches)
//   types missing or empty             -> airport (if the location matches); a client that leaves the
//                                         types out cannot skip the airport fee that way
//   types given without "airport"      -> not an airport (an "Airport hotel" is lodging). The Worker
//                                         re-checks such types server-side when it can (placeId + key).
// place: { types: [], lat, lng }. Returns the airport code or "".
export function detectAirport(place, codes) {
  if (!place) return "";
  const types = Array.isArray(place.types) ? place.types : [];
  if (types.length && !types.includes("airport")) return "";
  return airportAt(place, codes);
}

// The airport (code) whose area contains this location, among the given codes; "" if none.
export function airportAt(place, codes) {
  if (!place) return "";
  const lat = Number(place.lat), lng = Number(place.lng);
  if (place.lat == null || place.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const allowed = Array.isArray(codes) ? codes.map((c) => String(c).toUpperCase()) : AIRPORT_CODES;
  for (const code of allowed) {
    const a = airportByCode(code);
    if (a && kmBetween(a.center, { lat, lng }) <= a.radiusKm) return a.code;
  }
  return "";
}

// "DL1234" -> "DL" (IATA airline code: two characters, at least one a letter). "" for anything else,
// including 3-letter ICAO idents such as DAL1234, which the airline table does not use.
export function airlineOf(flight) {
  const m = /^([A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/.exec(String(flight || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  return m ? m[1] : "";
}

// Terminal ids for this airline at this airport ([] = unknown, the rider picks).
export function terminalsForAirline(code, airline) {
  const a = airportByCode(code);
  if (!a || !a.airlines) return [];
  const key = String(airline || "").toUpperCase();
  if (!key) return []; // no airline known: no guess, the rider picks
  const list = a.airlines[key] || a.airlines["*"] || [];
  return list.filter((id) => a.terminals.some((t) => t.id === id));
}

// Provider terminal text ("S", "Terminal S", "International") -> our terminal id, or "".
export function terminalFromProvider(code, providerTerminal) {
  const a = airportByCode(code);
  const raw = String(providerTerminal || "").trim().toUpperCase();
  if (!a || !raw) return "";
  const short = raw.replace(/^TERMINAL\s+/, "");
  for (const t of a.terminals) {
    if ((t.providerCodes || []).some((p) => p.toUpperCase() === short)) return t.id;
    if (t.label.toUpperCase().startsWith(raw)) return t.id;
  }
  return "";
}

// The shape airport-booking.js validates and stores per fleet (terminals become "spots").
export function bookingConfigFor(code) {
  const a = airportByCode(code);
  if (!a) return null;
  const out = { code: a.code, name: a.name, spots: a.terminals.map((t) => ({ id: t.id, label: t.label })) };
  if (a.pickupMeet) out.pickupMeet = a.pickupMeet;
  if (a.dropoffStyle) out.dropoffStyle = a.dropoffStyle;
  return out;
}

// What the booking page may know about one airport, beyond its terminals: where it is (to match an
// autocomplete pick) and the airline table (to pre-select a terminal). No pins, no keys.
export function publicAirportExtras(code) {
  const a = airportByCode(code);
  if (!a) return null;
  const airlines = {};
  for (const [k, ids] of Object.entries(a.airlines || {})) airlines[k] = ids.slice();
  return { center: a.center, radiusKm: a.radiusKm, airlines };
}

// Free airport wait starts at the actual (or latest estimated) landing time. The wait rules are
// not changed here; this only works out when the free wait ends for the ride view.
export const FREE_WAIT_MINUTES = 30;
export function freeWaitEnds(landingMs) {
  const n = Number(landingMs);
  return Number.isFinite(n) && n > 0 ? n + FREE_WAIT_MINUTES * 60000 : null;
}
