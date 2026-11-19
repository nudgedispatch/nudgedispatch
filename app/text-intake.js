// Text-to-ride (PREVIEW, Nov 17, 2026). Pure helpers: no network, no D1.
//
// A client texts the fleet's Bland number ("landing ATL 8:15 DL1742"). The webhook in index.js
// turns that text into a DRAFT ride (approval = 'requested', source = 'text') that waits in the
// owner's queue. Nothing here books a ride or sends a text. Parsing is deterministic regex only.

export const TEXT_ZONE = "America/New_York";
export const MAX_TEXT = 1000;
// Follow-up texts from the same number within this window are added to the open draft.
export const MERGE_WINDOW_MS = 3 * 60 * 60 * 1000;
// A driver with a ride starting within this many minutes of the draft's time is "busy".
export const BUSY_WINDOW_MIN = 120;

// Common US airline IATA codes plus a few international carriers seen at ATL. A two-character
// code is accepted as a flight number only from this list (so "AT 8" or "IN 20" are not flights).
const AIRLINE_CODES = new Set(["DL", "AA", "UA", "WN", "B6", "AS", "NK", "F9", "G4", "SY", "HA", "MX", "XP", "QX", "OO", "YX", "9E", "MQ", "OH", "YV", "ZW", "C5", "AC", "WS", "PD", "AM", "Y4", "VB", "BA", "VS", "AF", "KL", "LH", "LX", "OS", "SN", "IB", "AZ", "EI", "TP", "SK", "AY", "TK", "EK", "QR", "EY", "ET", "KE", "OZ", "JL", "NH", "CX", "SQ", "QF", "NZ", "LA", "AV", "CM", "AR", "BW", "SV", "MS", "RJ", "LY", "WY", "CI", "BR", "CA", "MU", "CZ", "AI"]);
const AIRLINE_NAMES = [["delta", "DL"], ["american", "AA"], ["united", "UA"], ["southwest", "WN"], ["jetblue", "B6"], ["jet blue", "B6"], ["alaska", "AS"], ["spirit", "NK"], ["frontier", "F9"], ["allegiant", "G4"], ["sun country", "SY"], ["air canada", "AC"], ["british airways", "BA"], ["virgin", "VS"], ["air france", "AF"], ["klm", "KL"], ["lufthansa", "LH"], ["korean air", "KE"], ["turkish", "TK"], ["emirates", "EK"], ["qatar", "QR"], ["aeromexico", "AM"], ["breeze", "MX"]];

// Fallback airports when the fleet has no airport settings. Fleets with settings use their own list.
const DEFAULT_AIRPORTS = [
  { code: "ATL", name: "ATL Airport", words: ["hartsfield", "atlanta airport", "atl airport"], spots: [{ id: "domestic", label: "Domestic Terminal" }, { id: "international", label: "International Terminal" }] },
  { code: "PDK", name: "PDK (Peachtree-DeKalb)", words: ["peachtree dekalb", "dekalb peachtree"], spots: [] },
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function cleanText(v, max = MAX_TEXT) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

// Date and clock in the fleet's zone (Eastern) for a timestamp.
export function zoned(nowMs, zone = TEXT_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long" })
    .formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute), weekday: WEEKDAYS.indexOf(String(parts.weekday).toLowerCase()) };
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function time12(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  if (!m) return t || "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function hhmm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function airportList(airports) {
  const list = Array.isArray(airports) && airports.length ? airports : DEFAULT_AIRPORTS;
  return list.filter((a) => a && /^[A-Z]{3}$/.test(String(a.code || "").toUpperCase())).map((a) => ({
    code: String(a.code).toUpperCase(),
    name: String(a.name || a.code),
    words: Array.isArray(a.words) ? a.words : (DEFAULT_AIRPORTS.find((d) => d.code === String(a.code).toUpperCase()) || {}).words || [],
    spots: Array.isArray(a.spots) ? a.spots.filter((s) => s && s.label).map((s) => ({ id: String(s.id || ""), label: String(s.label) })) : [],
  }));
}

export function parseFlight(text) {
  const t = " " + text + " ";
  const coded = /(?:^|[\s(#,])(?:flight\s*#?\s*)?([A-Z][A-Z0-9]|[0-9][A-Z])\s?-?(\d{1,4})(?=[\s).,!?;:]|$)/gi;
  let m;
  while ((m = coded.exec(t))) {
    const code = m[1].toUpperCase();
    if (!/[A-Z]/.test(code) || !AIRLINE_CODES.has(code)) continue;
    return code + String(Number(m[2]));
  }
  const lower = t.toLowerCase();
  for (const [name, code] of AIRLINE_NAMES) {
    const re = new RegExp("\\b" + name.replace(/ /g, "\\s+") + "\\s+(?:flight\\s*)?#?\\s*(\\d{1,4})\\b");
    const hit = re.exec(lower);
    if (hit) return code + String(Number(hit[1]));
  }
  return "";
}

// Times like 8:15, 8:15pm, 8.15 pm, 815pm, 8pm, 20:15, "at 8", noon, midnight.
export function parseTime(text) {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return { minutes: 12 * 60, meridiem: true };
  if (/\bmidnight\b/.test(t)) return { minutes: 0, meridiem: true };
  const patterns = [
    /\b(\d{1,2})[:.](\d{2})\s*(a\.?m?\.?|p\.?m?\.?)?(?![\d/])/,
    /\b(\d{1,2})(\d{2})\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/,
    /\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/,
    /\b(?:at|@|around|by|landing|lands|land|arriving|arrive|arrives|gets in|departs|leaves)\s+(\d{1,2})(?![\d:./]|\s*(?:people|passengers|pax|bags|ppl|of us))\b/,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const m = patterns[i].exec(t);
    if (!m) continue;
    let h = Number(m[1]);
    let min = 0;
    let mer = "";
    if (i === 0) { min = Number(m[2]); mer = m[3] || ""; }
    else if (i === 1) { min = Number(m[2]); mer = m[3]; }
    else if (i === 2) { mer = m[2]; }
    if (min > 59 || h > 23) continue;
    mer = mer.replace(/\./g, "");
    if (mer) {
      if (h < 1 || h > 12) continue;
      if (mer.startsWith("p") && h !== 12) h += 12;
      if (mer.startsWith("a") && h === 12) h = 0;
      return { minutes: h * 60 + min, meridiem: true };
    }
    if (h > 12 || h === 0) return { minutes: h * 60 + min, meridiem: true };
    return { minutes: h * 60 + min, meridiem: false };
  }
  return null;
}

// Date words relative to "today" in Eastern time. Returns { date, explicit }.
export function parseDate(text, today, weekdayToday) {
  const t = text.toLowerCase();
  if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return { date: today, explicit: true };
  if (/\b(tomorrow|tmrw|tmr|tomorow|2morrow)\b/.test(t)) return { date: addDays(today, 1), explicit: true };
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (numeric) {
    const mo = Number(numeric[1]);
    const d = Number(numeric[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { date: resolveMonthDay(today, mo, d, numeric[3]), explicit: true };
  }
  const named = new RegExp("\\b(" + MONTHS.join("|") + ")[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b").exec(t);
  if (named) {
    const mo = MONTHS.indexOf(named[1]) + 1;
    const d = Number(named[2]);
    if (d >= 1 && d <= 31) return { date: resolveMonthDay(today, mo, d), explicit: true };
  }
  const wd = /\b(?:(next|this)\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?\b/.exec(t);
  if (wd) {
    const idx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].findIndex((p) => wd[2].startsWith(p));
    if (idx >= 0) {
      let diff = (idx - weekdayToday + 7) % 7;
      if (wd[1] === "next" && diff === 0) diff = 7;
      return { date: addDays(today, diff), explicit: true };
    }
  }
  return { date: today, explicit: false };
}

function resolveMonthDay(today, mo, d, yearRaw) {
  let y = Number(today.slice(0, 4));
  if (yearRaw) y = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!yearRaw && iso < today) return `${y + 1}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso;
}

export function parseAirport(text, airports, opts = {}) {
  const list = airportList(airports);
  const lower = text.toLowerCase();
  let found = null;
  for (const a of list) {
    if (new RegExp("\\b" + a.code + "\\b", "i").test(text) || a.words.some((w) => lower.includes(w))) { found = a; break; }
  }
  if (!found && /\bairport\b/.test(lower) && list.length === 1) found = list[0];
  if (!found && /\bairport\b/.test(lower)) return { code: "", name: "Airport", spot: "", generic: true };
  let assumed = false;
  // A flight number or a terminal word with no airport named: use the fleet's first airport.
  if (!found && list.length && (opts.flight || /\b(international|intl|domestic|terminal|concourse)\b/.test(lower))) { found = list[0]; assumed = true; }
  if (!found) return null;
  let spot = "";
  const intl = /\b(international|intl|int'l|terminal\s*f|concourse\s*[ef])\b/.test(lower);
  const dom = /\b(domestic|dom|north terminal|south terminal|concourse\s*[abcdt])\b/.test(lower);
  if (found.spots.length) {
    const byWord = (w) => found.spots.find((s) => s.label.toLowerCase().includes(w));
    const direct = found.spots.find((s) => lower.includes(s.label.toLowerCase()));
    const pick = direct || (intl ? byWord("international") || byWord("intl") : null) || (dom ? byWord("domestic") : null);
    if (pick) spot = pick.label;
  } else if (intl) spot = "International Terminal";
  else if (dom) spot = "Domestic Terminal";
  return { code: found.code, name: found.name, spot, assumed };
}

const STOP_WORDS = /\b(?:at|around|by|on|tomorrow|today|tonight|landing|flight|thanks|thank you|thx|pls|please|for)\b/i;
function trimPlace(s) {
  let out = String(s || "").split(/[\n;!?]|\.(?:\s|$)|,\s*(?:landing|flight|thanks|thx|this is|it's|its|my name)/i)[0];
  const cut = STOP_WORDS.exec(out);
  if (cut && cut.index > 3 && /\b(?:at|around|by|on|for)\s+\d|\b(?:tomorrow|today|tonight|thanks|thank you|thx|pls|please)\b/i.test(out.slice(cut.index))) out = out.slice(0, cut.index);
  return out.replace(/\s+/g, " ").replace(/[\s,.-]+$/, "").trim().slice(0, 200);
}

function isAirportPhrase(s, airport) {
  const t = String(s || "").toLowerCase().trim();
  if (!t) return false;
  if (/^(the\s+)?airport\b/.test(t)) return true;
  if (airport && airport.code && new RegExp("^(?:the\\s+)?" + airport.code.toLowerCase() + "\\b").test(t)) return true;
  return /^(?:hartsfield|atl\b)/.test(t);
}

export function parseName(text) {
  const m = /\b(?:[Tt]his is|[Ii]t'?s|[Ii]ts|[Mm]y name is|[Nn]ame is|I am|I'm|[Ii]m)\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)?)/.exec(text);
  if (m && !/^(Landing|Flying|Coming|Arriving|Going|Delta|American|United|Southwest|Here|On|At|In|Back)$/.test(m[1].split(/\s+/)[0])) return m[1].slice(0, 80);
  const sign = /(?:^|\n|[.!]\s+|[-–—~]\s*)([A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20})?)\s*$/.exec(text.trim());
  if (sign && /[-–—~\n]/.test(text.trim().slice(Math.max(0, text.trim().length - sign[0].length - 1)))) {
    const first = sign[1].split(/\s+/)[0];
    if (!/^(Thanks|Thank|Thx|Please|Pls|Delta|American|United|Southwest|Atl|Domestic|International|Terminal|Tonight|Tomorrow|Today)$/i.test(first)) return sign[1];
  }
  return "";
}

// Main parser. options: { now (ms), airports (fleet airport settings list) }.
export function parseRideText(raw, options = {}) {
  const text = cleanText(raw);
  const now = options.now ?? Date.now();
  const z = zoned(now);
  const lower = text.toLowerCase();
  const warnings = [];
  const flight = parseFlight(text);
  const airport = parseAirport(text, options.airports, { flight });
  const arrival = /\b(land(?:s|ing|ed)?|arriv(?:e|es|ing|al)|gets? in|getting in|coming in|flying in|fly in|in from|pick me up (?:at|from) (?:the )?(?:airport|atl))\b/.test(lower);
  const departure = /\b(depart(?:s|ing|ure)?|leav(?:e|es|ing)|flying out|fly out|flight out|(?:to|drop(?:\s|-)?(?:me\s+)?off at|take me to) (?:the )?(?:airport|atl|hartsfield)|heading to (?:the )?(?:airport|atl))\b/.test(lower);
  let direction = "";
  if (airport || flight) direction = arrival && !departure ? "arrival" : departure && !arrival ? "departure" : arrival ? "arrival" : "";
  if (!direction && airport && /\bpick(?:\s|-)?(?:me\s+)?up\b/.test(lower) && /\bfrom (?:the )?(?:airport|atl)/.test(lower)) direction = "arrival";

  const time = parseTime(text.replace(/\b[A-Z0-9]{2}\s?\d{1,4}\b/g, (m) => (flight && m.replace(/\s/g, "").toUpperCase().endsWith(flight.slice(2)) ? " " : m)));
  const dateInfo = parseDate(text, z.date, z.weekday);
  let date = dateInfo.date;
  let pickupTime = "";
  let timeAssumed = false;
  if (time) {
    let minutes = time.minutes;
    if (!time.meridiem) {
      // "8:15" with no am/pm: choose the next 8:15 from now (morning or evening) on the given day.
      const am = minutes % (12 * 60);
      const pm = am + 12 * 60;
      if (date === z.date) minutes = am > z.minutes ? am : pm > z.minutes ? pm : am;
      else minutes = /\b(tonight|evening|night)\b/.test(lower) ? pm : am >= 6 * 60 ? am : pm;
      timeAssumed = true;
      warnings.push(`Time had no AM/PM; read as ${time12(hhmm(minutes))}. Check it.`);
    }
    if (!dateInfo.explicit && date === z.date && minutes <= z.minutes) {
      date = addDays(z.date, 1);
      warnings.push("No date given and that time has passed today, so it is set for tomorrow.");
    } else if (!dateInfo.explicit) {
      warnings.push("No date given; set for today.");
    }
    pickupTime = hhmm(minutes);
  } else {
    warnings.push("No time found. Add the pickup time.");
    if (!dateInfo.explicit) warnings.push("No date given; set for today.");
  }

  let pickup = "";
  let dropoff = "";
  const airportLabel = airportPlace(airport);
  const toMatch = /\b(?:to|drop(?:\s|-)?(?:me\s+)?off(?:\s+at)?|going to|headed to|heading to|take me to|then to|destination)\s*[:\-]?\s+(.+)/i.exec(text);
  const fromMatch = /\b(?:from|pick(?:\s|-)?(?:me\s+)?up(?:\s+at|\s+from)?|pickup(?:\s+at|\s+from)?|i'?m at)\s*[:\-]?\s+(.+)/i.exec(text);
  const toPlace = toMatch ? trimPlace(toMatch[1]) : "";
  const fromPlace = fromMatch ? trimPlace(fromMatch[1]) : "";
  if (direction === "arrival") {
    pickup = airportLabel;
    if (toPlace && !isAirportPhrase(toPlace, airport)) dropoff = toPlace;
    if (flight && !pickupTime) warnings.push("Arrival time missing; the flight number can be used to look it up.");
  } else if (direction === "departure") {
    dropoff = airportLabel;
    if (fromPlace && !isAirportPhrase(fromPlace, airport)) pickup = fromPlace;
    if (pickupTime) warnings.push("For a departure this may be the flight time, not the pickup time. Set the pickup time.");
  } else {
    if (fromPlace && !isAirportPhrase(fromPlace, airport)) pickup = fromPlace;
    else if (airport && fromPlace) pickup = airportLabel;
    if (toPlace && !isAirportPhrase(toPlace, airport)) dropoff = toPlace;
    else if (airport && toPlace) dropoff = airportLabel;
    if (airport && !pickup && !dropoff) { pickup = airportLabel; warnings.push("Not sure if this is a pickup or a drop-off at the airport. Check the direction."); }
  }
  if (airport && airport.assumed) warnings.push(`Airport not named; assumed ${airport.code}.`);
  if (!pickup) warnings.push("Pickup address missing.");
  if (!dropoff) warnings.push("Drop-off address missing. Ask the client.");
  if (airport && airport.code && !airport.spot && airport.code === "ATL") warnings.push("Terminal not given (Domestic or International).");

  const pax = /\b(\d{1,2})\s*(?:people|persons|passengers|pax|ppl|of us|guests|adults)\b/i.exec(text) || /\bparty of\s*(\d{1,2})\b/i.exec(text);
  const passengers = pax ? Math.min(14, Math.max(1, Number(pax[1]))) : null;
  const bags = /\b(\d{1,2})\s*(?:bags|bag|luggage|suitcases|suitcase|checked bags)\b/i.exec(text);
  const luggage = bags ? Math.min(30, Number(bags[1])) : null;
  const name = parseName(text);
  const unsign = (place) => (name && place ? place.replace(new RegExp("[\\s,]*[-–—~]\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "").trim() : place);
  pickup = unsign(pickup);
  dropoff = unsign(dropoff);
  const confidence = [flight, airport, pickupTime, pickup && dropoff].filter(Boolean).length;
  return {
    text, date, time: pickupTime, timeAssumed, dateExplicit: dateInfo.explicit, direction,
    airport: airport ? { code: airport.code, name: airport.name, spot: airport.spot, assumed: Boolean(airport.assumed) } : null,
    flight, pickup, dropoff, passengers, luggage, name, warnings,
    looksLikeRide: Boolean(flight || airport || (pickupTime && (pickup || dropoff)) || /\b(ride|pick ?up|car|driver|pickup)\b/i.test(lower)),
    confidence,
  };
}

export function airportPlace(airport) {
  if (!airport) return "";
  if (airport.spot) return [airport.code || airport.name, airport.spot].filter(Boolean).join(" · ");
  return airport.name || airport.code || "Airport";
}

// Fill blanks on an open draft from a follow-up text. Fields already set are kept.
export function mergeParsed(prev, next) {
  const out = { ...prev };
  const oldPlace = airportPlace(prev.airport);
  for (const k of ["flight", "pickup", "dropoff", "name", "direction"]) if (!out[k] && next[k]) out[k] = next[k];
  if (!out.airport && next.airport) out.airport = next.airport;
  if (out.airport && next.airport && !out.airport.spot && next.airport.spot && out.airport.code === next.airport.code) out.airport = { ...out.airport, spot: next.airport.spot };
  if ((!out.time || out.timeAssumed) && next.time && (!next.timeAssumed || !out.time)) { out.time = next.time; out.timeAssumed = next.timeAssumed; out.date = next.date; }
  if (!out.dateExplicit && next.dateExplicit) { out.date = next.date; out.dateExplicit = true; }
  // The terminal arrived in a later text: update the airport side of the trip too.
  const newPlace = airportPlace(out.airport);
  if (oldPlace && newPlace !== oldPlace) {
    if (out.pickup === oldPlace) out.pickup = newPlace;
    if (out.dropoff === oldPlace) out.dropoff = newPlace;
  }
  if (out.passengers == null && next.passengers != null) out.passengers = next.passengers;
  if (out.luggage == null && next.luggage != null) out.luggage = next.luggage;
  return out;
}

// Recompute the warning list for a merged parse (so a follow-up "Domestic" clears "Terminal not given").
export function draftWarnings(p) {
  const w = [];
  if (!p.time) w.push("No time found. Add the pickup time.");
  else if (p.timeAssumed) w.push(`Time had no AM/PM; read as ${time12(p.time)}. Check it.`);
  if (!p.dateExplicit) w.push("No date in the text. Check the date.");
  if (p.direction === "departure" && p.time) w.push("For a departure this may be the flight time, not the pickup time. Set the pickup time.");
  if (!p.pickup) w.push("Pickup address missing.");
  if (!p.dropoff) w.push("Drop-off address missing. Ask the client.");
  if (p.airport && p.airport.assumed) w.push(`Airport not named; assumed ${p.airport.code}.`);
  if (p.airport && p.airport.code === "ATL" && !p.airport.spot) w.push("Terminal not given (Domestic or International).");
  return w;
}

// Bland message webhook -> inbound text, or { ignore: reason }.
// Bland sends one payload per message with sender USER (client), AGENT, or HUMAN, plus status
// payloads (type status / status field) when a conversation ends. Only USER messages count.
export function readBlandInbound(payload, isOurNumber) {
  if (!payload || typeof payload !== "object") return { ignore: "not an object" };
  if (payload.type === "status" || (payload.status && !payload.message)) return { ignore: "status event" };
  if (payload.event_type) return { ignore: "event " + String(payload.event_type).slice(0, 40) };
  const sender = String(payload.sender || "").toUpperCase();
  if (sender && sender !== "USER") return { ignore: "sender " + sender.slice(0, 10) };
  const channel = String(payload.channel || "sms").toLowerCase();
  if (channel !== "sms") return { ignore: "channel " + channel.slice(0, 12) };
  const body = cleanText(typeof payload.message === "string" ? payload.message : (payload.message && payload.message.text) || "");
  if (!body) return { ignore: "empty message" };
  const a = e164(payload.to || payload.agent_number || "");
  const b = e164(payload.from || payload.phone_number || payload.user_number || "");
  let ours = "";
  let client = "";
  if (a && isOurNumber(a)) { ours = a; client = b; }
  else if (b && isOurNumber(b)) { ours = b; client = a; }
  if (!ours) return { ignore: "unknown number", to: a, from: b };
  if (!client) return { ignore: "no sender number" };
  return { ours, client, body, conversationId: String(payload.conversation_id || "").slice(0, 80) };
}

export function e164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : "";
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return "";
  return "+1" + national;
}

export function prettyPhone(e) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e || "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(e || "");
}

function toMinutes(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Suggest a driver for a draft. candidates: [{ id, name, role }]. rides: the fleet's scheduled
// rides that day [{ driverUserId, date, time, hours }]. Strategy "free" (today): drivers with no
// ride within BUSY_WINDOW_MIN of the draft's time, fewest rides that day first, then name.
// Strategy "nearby" (later): pass options.distanceKm(driverId) once drivers report locations;
// free drivers are then ranked by distance first. Returns { id, name, reason } or null.
export function suggestDriver(candidates, rides, draft, options = {}) {
  const pool = (candidates || []).filter((c) => c && c.id);
  if (!pool.length) return null;
  const drivers = pool.filter((c) => c.role === "driver");
  const usable = drivers.length ? drivers : pool;
  const at = toMinutes(draft.time);
  const sameDay = (rides || []).filter((r) => r.date === draft.date && r.driverUserId);
  const busy = (id) => at !== null && sameDay.some((r) => {
    if (r.driverUserId !== id) return false;
    const start = toMinutes(r.time);
    if (start === null) return false;
    const len = r.hours ? Math.round(r.hours * 60) : 0;
    return at >= start - BUSY_WINDOW_MIN && at <= start + len + BUSY_WINDOW_MIN;
  });
  const load = (id) => sameDay.filter((r) => r.driverUserId === id).length;
  const free = usable.filter((c) => !busy(c.id));
  if (!free.length) return null;
  const dist = typeof options.distanceKm === "function" ? options.distanceKm : null;
  free.sort((x, y) => {
    if (dist) {
      const dx = dist(x.id); const dy = dist(y.id);
      if (dx != null && dy != null && dx !== dy) return dx - dy;
      if (dx != null && dy == null) return -1;
      if (dy != null && dx == null) return 1;
    }
    return load(x.id) - load(y.id) || String(x.name || "").localeCompare(String(y.name || ""));
  });
  const pick = free[0];
  const n = load(pick.id);
  const reason = at === null
    ? `No time yet; ${n ? n + " ride" + (n === 1 ? "" : "s") : "no rides"} that day.`
    : `Free at that time (no ride within ${BUSY_WINDOW_MIN / 60} h)${n ? `; ${n} other ride${n === 1 ? "" : "s"} that day` : ""}.`;
  return { id: pick.id, name: pick.name || "", reason, strategy: dist ? "nearby" : "free" };
}

// Constant-time hex compare for the Bland X-Webhook-Signature (HMAC-SHA256 of the raw body).
export async function verifyBlandSignature(secret, rawBody, header) {
  const sig = String(header || "").trim().toLowerCase().replace(/^sha256=/, "");
  if (!secret || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
