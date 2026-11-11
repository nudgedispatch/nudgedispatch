// Airport pickups and drop-offs on the public booking page (pure, no network, no D1).
//
// Every fleet sets its own airports. Nothing here is specific to one operator: a fleet with no
// airport settings gets the plain booking page (typed pickup and drop-off). AIRPORT_PRESETS.ATL is
// the example config, taken from Iron Gate's live booking flow (terminal list, Legacy West Curb
// for black SUV pickups, topside or curbside drop-off).
//
// Config (stored per company in booking_settings.airports_json):
// {
//   version: 1,
//   airports: [{
//     code: "ATL", name: "ATL Airport",
//     spots: [{ id, label }],                         // terminals or pickup zones, 1..8
//     pickupMeet:  { options: [{ id, label, detail?, classes? }], default?, defaultByClass? },
//     dropoffStyle:{ options: [{ id, label, detail?, classes? }], default?, defaultByClass?, spots? },
//   }]
// }
// classes limits an option to vehicle classes (for example the Legacy West Curb is for black SUVs).
// defaultByClass picks the starting option for the vehicle class the rider is booking.
// dropoffStyle.spots limits the drop-off choice to some spots (empty or missing means all spots).

export const VEHICLE_CLASSES = ["sedan", "suv", "van", "sprinter", "bus"];
export const LIMITS = { airports: 4, spots: 8, options: 4 };

const CLASS_WORDS = [
  // Order matters: the first class whose word appears wins, so "sprinter van" is a sprinter.
  ["sprinter", ["sprinter", "transit 350", "executive van"]],
  ["bus", ["bus", "coach", "shuttle"]],
  ["van", ["van", "minivan", "sienna", "odyssey", "pacifica", "carnival"]],
  ["suv", ["suv", "suburban", "yukon", "escalade", "tahoe", "navigator", "expedition", "denali", "gx", "lx", "qx80", "range rover", "gls", "g wagon", "x7", "sequoia", "land cruiser", "telluride", "palisade", "traverse", "durango"]],
  ["sedan", ["sedan", "s class", "s-class", "e class", "e-class", "7 series", "5 series", "a8", "a6", "ct6", "xts", "ct5", "continental", "mkz", "camry", "accord", "genesis", "g90", "g80", "es 350", "ls 500", "model s", "town car"]],
];

function clean(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function idOf(v) {
  const s = clean(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 32);
}

// "Black Chevy Suburban" -> "suv". Unknown text -> "".
export function vehicleClassOf(text) {
  const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (t.trim() === "") return "";
  for (const [cls, words] of CLASS_WORDS) {
    for (const w of words) if (t.includes(" " + w + " ")) return cls;
  }
  return "";
}

// Classes the active fleet can actually run, from the roster's vehicle text.
export function fleetClasses(drivers) {
  const out = new Set();
  for (const d of drivers || []) {
    if (!d || d.deleted_at) continue;
    const cls = d.vehicle_class || vehicleClassOf(d.vehicle);
    if (cls) out.add(cls);
  }
  return out;
}

// Rate-sheet vehicles the rider may pick. A vehicle whose class is known and not in the fleet is
// hidden (an SUV-only fleet does not offer a sedan). With no fleet data, every vehicle is offered.
export function bookableVehicles(vehicles, classes) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  if (!classes || !classes.size) return list.slice();
  const shown = list.filter((v) => {
    const cls = vehicleClassOf(v.name);
    return !cls || classes.has(cls);
  });
  return shown.length ? shown : list.slice();
}

// Passenger capacity per vehicle class, per fleet. Sedans default to 3 passengers; other classes use
// the rate sheet's seat count unless the fleet sets a number here.
export const DEFAULT_CAPACITIES = { sedan: 3 };

export function validateCapacities(input) {
  const out = { ...DEFAULT_CAPACITIES };
  if (input == null) return { capacities: out };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Expected passenger limits by vehicle type." };
  for (const [cls, n] of Object.entries(input)) {
    const c = String(cls).toLowerCase();
    if (!VEHICLE_CLASSES.includes(c)) return { error: `Unknown vehicle type ${cls}.` };
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > 56) return { error: `${c}: passenger limit must be a whole number from 1 to 56.` };
    out[c] = v;
  }
  return { capacities: out };
}

// Effective seats: the rate sheet's seats, capped by the fleet's limit for that class.
export function seatsFor(vehicle, capacities) {
  const caps = capacities || DEFAULT_CAPACITIES;
  const cls = vehicleClassOf(vehicle && vehicle.name);
  const cap = cls && caps[cls] != null ? caps[cls] : null;
  const seats = vehicle && vehicle.seats != null ? vehicle.seats : null;
  if (cap == null) return seats;
  return seats == null ? cap : Math.min(seats, cap);
}

// Vehicles that seat this many passengers (1-3 can be a sedan or an SUV; 4+ is not a sedan).
export function vehiclesForPassengers(vehicles, passengers, capacities) {
  const n = Math.max(1, Number(passengers) || 1);
  return (vehicles || []).filter((v) => {
    const s = seatsFor(v, capacities);
    return s == null || s >= n;
  });
}

// Smallest vehicle that seats everyone; the largest one when none does.
export function vehicleForPassengers(vehicles, passengers, capacities) {
  const list = (vehicles || []).slice();
  if (!list.length) return null;
  const seats = (v) => {
    const s = seatsFor(v, capacities);
    return s == null ? 99 : s;
  };
  const fits = vehiclesForPassengers(list, passengers, capacities).sort((a, b) => seats(a) - seats(b));
  if (fits.length) return fits[0];
  return list.sort((a, b) => seats(b) - seats(a))[0];
}

function readOptions(input, label) {
  if (input == null) return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: `${label}: expected options.` };
  const raw = Array.isArray(input.options) ? input.options : [];
  if (!raw.length) return { value: null };
  if (raw.length > LIMITS.options) return { error: `${label}: use up to ${LIMITS.options} options.` };
  const options = [];
  const seen = new Set();
  for (const o of raw) {
    const optLabel = clean(o && o.label, 60);
    const id = idOf((o && o.id) || optLabel);
    if (!optLabel || !id) return { error: `${label}: every option needs a name.` };
    if (seen.has(id)) return { error: `${label}: two options are both ${optLabel}.` };
    seen.add(id);
    const classes = Array.isArray(o.classes) ? o.classes.map((c) => String(c).toLowerCase()).filter((c) => VEHICLE_CLASSES.includes(c)) : [];
    const opt = { id, label: optLabel };
    const detail = clean(o.detail, 240);
    if (detail) opt.detail = detail;
    if (classes.length) opt.classes = [...new Set(classes)];
    options.push(opt);
  }
  const value = { options };
  const def = idOf(input.default);
  if (def) {
    if (!seen.has(def)) return { error: `${label}: the default is not one of the options.` };
    value.default = def;
  }
  if (input.defaultByClass && typeof input.defaultByClass === "object") {
    const byClass = {};
    for (const [cls, id] of Object.entries(input.defaultByClass)) {
      const c = String(cls).toLowerCase();
      const oid = idOf(id);
      if (!VEHICLE_CLASSES.includes(c)) return { error: `${label}: unknown vehicle class ${cls}.` };
      if (!seen.has(oid)) return { error: `${label}: the ${c} default is not one of the options.` };
      byClass[c] = oid;
    }
    if (Object.keys(byClass).length) value.defaultByClass = byClass;
  }
  return { value };
}

// Validate an operator's airport settings. Returns { config } or { error }.
export function validateAirportConfig(input) {
  if (input == null) return { config: { version: 1, airports: [] } };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Expected airport settings." };
  const raw = Array.isArray(input.airports) ? input.airports : [];
  if (raw.length > LIMITS.airports) return { error: `Use up to ${LIMITS.airports} airports.` };
  const airports = [];
  const codes = new Set();
  for (const a of raw) {
    const code = clean(a && a.code, 4).toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(code)) return { error: "Each airport needs a 3- or 4-letter code, such as ATL." };
    if (codes.has(code)) return { error: `${code} is listed twice.` };
    codes.add(code);
    const name = clean(a.name, 60) || code + " Airport";
    const spotsIn = Array.isArray(a.spots) ? a.spots : [];
    if (!spotsIn.length) return { error: `${code}: add at least one terminal.` };
    if (spotsIn.length > LIMITS.spots) return { error: `${code}: use up to ${LIMITS.spots} terminals.` };
    const spots = [];
    const spotIds = new Set();
    for (const s of spotsIn) {
      const label = clean(s && s.label, 60);
      const id = idOf((s && s.id) || label);
      if (!label || !id) return { error: `${code}: every terminal needs a name.` };
      if (spotIds.has(id)) return { error: `${code}: ${label} is listed twice.` };
      spotIds.add(id);
      spots.push({ id, label });
    }
    const meet = readOptions(a.pickupMeet, `${code} pickup meeting point`);
    if (meet.error) return { error: meet.error };
    const style = readOptions(a.dropoffStyle, `${code} drop-off`);
    if (style.error) return { error: style.error };
    if (style.value && Array.isArray(a.dropoffStyle.spots) && a.dropoffStyle.spots.length) {
      const only = a.dropoffStyle.spots.map(idOf).filter((id) => spotIds.has(id));
      if (!only.length) return { error: `${code} drop-off: the terminals listed are not in this airport.` };
      style.value.spots = [...new Set(only)];
    }
    const airport = { code, name, spots };
    if (meet.value) airport.pickupMeet = meet.value;
    if (style.value) airport.dropoffStyle = style.value;
    airports.push(airport);
  }
  return { config: { version: 1, airports } };
}

// Example config: Iron Gate Executive Transport at Hartsfield-Jackson (ATL).
export const AIRPORT_PRESETS = {
  ATL: {
    code: "ATL",
    name: "ATL Airport",
    spots: [
      { id: "domestic-north", label: "Domestic Terminal North" },
      { id: "domestic-south", label: "Domestic Terminal South (Delta)" },
      { id: "international", label: "International Terminal" },
    ],
    pickupMeet: {
      options: [
        {
          id: "legacy-west-curb",
          label: "Legacy West Curb (W1 and W2)",
          detail: "Black SUV pickups at ATL are at the Legacy West Curb, zones W1 and W2. Your driver meets you there.",
          classes: ["suv"],
        },
        { id: "curbside", label: "Curbside", detail: "Your driver meets you at the arrivals curb.", classes: ["sedan", "van"] },
        { id: "inside", label: "Inside meet-and-greet", detail: "Your driver meets you inside at baggage claim and walks you to the car." },
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
    },
  },
};

export function presetConfig(codes) {
  const list = (codes || []).map((c) => AIRPORT_PRESETS[String(c).toUpperCase()]).filter(Boolean);
  return validateAirportConfig({ airports: list }).config;
}

function optionsFor(group, cls) {
  if (!group) return [];
  return group.options.filter((o) => !o.classes || !cls || o.classes.includes(cls));
}

function defaultFor(group, cls) {
  const opts = optionsFor(group, cls);
  if (!opts.length) return "";
  const byClass = cls && group.defaultByClass && group.defaultByClass[cls];
  if (byClass && opts.some((o) => o.id === byClass)) return byClass;
  if (group.default && opts.some((o) => o.id === group.default)) return group.default;
  return opts[0].id;
}

// What the public booking page may know. No prices.
export function publicAirportInfo(config) {
  const airports = (config && config.airports) || [];
  return airports.map((a) => ({
    code: a.code,
    name: a.name,
    spots: a.spots.map((s) => ({ id: s.id, label: s.label })),
    pickupMeet: a.pickupMeet ? { options: a.pickupMeet.options, default: a.pickupMeet.default || "", defaultByClass: a.pickupMeet.defaultByClass || {} } : null,
    dropoffStyle: a.dropoffStyle ? { options: a.dropoffStyle.options, default: a.dropoffStyle.default || "", defaultByClass: a.dropoffStyle.defaultByClass || {}, spots: a.dropoffStyle.spots || [] } : null,
  }));
}

export function spotAddress(airport, spot) {
  return `${airport.name} - ${spot.label}`;
}

// Read the airport part of a booking. body.airport = { code, side: "pickup"|"dropoff", spot, meet, style }.
// Returns { airport: null } for a trip with no airport, { error } when something is missing, or
// { airport: {...stored shape}, address } where address replaces the typed pickup or drop-off.
export function readAirportChoice(body, config, vehicleClass) {
  const a = body && body.airport;
  if (!a || typeof a !== "object" || !a.side || a.side === "none") return { airport: null };
  const side = a.side === "pickup" || a.side === "dropoff" ? a.side : "";
  if (!side) return { error: "Choose pickup or drop-off at the airport." };
  const airports = (config && config.airports) || [];
  const code = clean(a.code, 4).toUpperCase() || (airports.length === 1 ? airports[0].code : "");
  const airport = airports.find((x) => x.code === code);
  if (!airport) return { error: "Choose an airport." };
  const spot = airport.spots.find((s) => s.id === idOf(a.spot));
  if (!spot) return { error: `Choose the ${airport.name} terminal.` };
  const cls = vehicleClass || "";
  const out = { code: airport.code, name: airport.name, side, spot: spot.id, spotLabel: spot.label };
  if (side === "pickup" && airport.pickupMeet) {
    const opts = optionsFor(airport.pickupMeet, cls);
    const want = idOf(a.meet) || defaultFor(airport.pickupMeet, cls);
    const pick = opts.find((o) => o.id === want);
    if (!pick) return { error: "Choose where to meet your driver." };
    out.meet = { id: pick.id, label: pick.label, detail: pick.detail || "" };
  }
  if (side === "dropoff" && airport.dropoffStyle) {
    const group = airport.dropoffStyle;
    const applies = !group.spots || !group.spots.length || group.spots.includes(spot.id);
    if (applies) {
      const opts = optionsFor(group, cls);
      const want = idOf(a.style) || defaultFor(group, cls);
      const pick = opts.find((o) => o.id === want);
      if (!pick) return { error: "Choose topside or curbside drop-off." };
      out.style = { id: pick.id, label: pick.label, detail: pick.detail || "" };
    }
  }
  return { airport: out, address: spotAddress(airport, spot) };
}

// One line for drivers, the office, and the rider.
export function airportSummary(a) {
  if (!a) return "";
  if (a.side === "pickup") return `Airport pickup: ${a.name}, ${a.spotLabel}` + (a.meet ? `. Meet at ${a.meet.label}.` : ".");
  return `Airport drop-off: ${a.name}, ${a.spotLabel}` + (a.style ? `. ${a.style.label} drop-off.` : ".");
}

// What the rider sees on the confirmation.
export function riderMeetingNote(a) {
  if (!a) return "";
  if (a.side === "pickup" && a.meet) return `Meeting point: ${a.meet.label}. ${a.meet.detail || ""}`.trim();
  if (a.side === "dropoff" && a.style) return `Drop-off: ${a.style.label}. ${a.style.detail || ""}`.trim();
  return "";
}

export function parseStoredAirport(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && (v.side === "pickup" || v.side === "dropoff") ? v : null;
  } catch {
    return null;
  }
}
