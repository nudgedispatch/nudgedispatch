// Voice-to-ride (PREVIEW, Nov 19, 2026). Pure helpers: no network, no D1.
//
// A caller phones the fleet's Bland number. Bland's AI phone agent (script in
// docs/voice-booking/agent-prompt.md) asks for pickup, drop-off, date, time, name and callback number,
// reads them back, and hangs up. Bland then POSTs the finished call to the post-call webhook in
// index.js, which turns it into a DRAFT ride (approval 'requested', source 'voice') in the owner's
// queue with a suggested driver, exactly like text-to-ride. Nothing here books, charges, or calls back.
//
// Field sources, best first:
//   1. Structured values Bland extracted: agent_dispositions[].payload (Bland Agents), analysis
//      (analysis preset / POST /v1/calls/:id/analyze), or pathway variables set during the call.
//   2. The agent's spoken read-back ("To confirm: Pickup: ... Drop-off: ... Date: ... Time: ...").
//   3. The existing deterministic text parser run over what the caller said.

import { parseRideText, parseDate, parseTime, parseAirport, airportPlace, draftWarnings, cleanText, zoned, addDays, time12, e164 } from "./text-intake.js";

export const MAX_TRANSCRIPT_TURNS = 60;
export const MAX_TRANSCRIPT_CHARS = 6000;
export const MAX_SUMMARY = 1200;

const EMPTY = /^(?:|unknown|n\/?a|none|null|undefined|not (?:provided|given|stated|mentioned|specified)|no|-)$/i;

// Accepted keys, in priority order, per field. Generic keys (name/date/time) are only read from
// analysis/dispositions; Bland's own `variables` also carry system values like now/from/to.
const KEYS = {
  pickup: ["pickup_address", "pickup_location", "pickup_place", "pickup"],
  dropoff: ["dropoff_address", "drop_off_address", "dropoff_location", "dropoff", "drop_off", "destination"],
  date: ["pickup_date", "ride_date", "date"],
  time: ["pickup_time", "ride_time", "time"],
  name: ["rider_name", "passenger_name", "caller_name", "customer_name", "name"],
  callback: ["callback_number", "callback_phone", "call_back_number"],
  passengers: ["passengers", "passenger_count", "party_size"],
  luggage: ["bags", "luggage", "luggage_count"],
  flight: ["flight_number", "flight"],
  notes: ["notes", "special_requests", "special_instructions"],
  needsCallback: ["needs_callback", "wants_callback", "callback_requested", "owner_callback"],
  confirmed: ["details_confirmed", "confirmed", "booking_confirmed"],
};
const GENERIC = new Set(["name", "date", "time", "pickup", "dropoff", "flight", "notes", "confirmed", "destination"]);

function val(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  if (typeof v === "string") {
    const s = cleanText(v, 300);
    return EMPTY.test(s) ? "" : s;
  }
  return "";
}

function pick(sources, field) {
  for (const { obj, generic } of sources) {
    if (!obj || typeof obj !== "object") continue;
    for (const k of KEYS[field]) {
      if (!generic && GENERIC.has(k)) continue;
      const v = val(obj[k]);
      if (v !== "") return v;
    }
  }
  return "";
}

function truthy(v) {
  if (typeof v === "boolean") return v;
  return /^(?:true|yes|y|1)$/i.test(String(v || ""));
}

// Structured values Bland extracted, merged across its three places. Returns {} when none.
export function structuredFields(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const sources = [];
  for (const d of Array.isArray(p.agent_dispositions) ? p.agent_dispositions : []) {
    if (!d || typeof d !== "object") continue;
    if (d.payload && typeof d.payload === "object") sources.push({ obj: d.payload, generic: true });
    if (Array.isArray(d.values)) {
      const o = {};
      for (const x of d.values) if (x && x.key && x.state !== "not_produced") o[x.key] = x.value;
      sources.push({ obj: o, generic: true });
    }
  }
  if (p.analysis && typeof p.analysis === "object") sources.push({ obj: p.analysis, generic: true });
  if (p.variables && typeof p.variables === "object") sources.push({ obj: p.variables, generic: false });
  const out = {};
  for (const f of Object.keys(KEYS)) {
    const v = pick(sources, f);
    if (v !== "") out[f] = v;
  }
  if ("needsCallback" in out) out.needsCallback = truthy(out.needsCallback);
  if ("confirmed" in out) out.confirmed = truthy(out.confirmed);
  for (const k of ["passengers", "luggage"]) {
    if (k in out) {
      const n = Number(String(out[k]).replace(/[^\d]/g, ""));
      if (Number.isInteger(n) && n > 0) out[k] = n; else delete out[k];
    }
  }
  for (const k of ["pickup", "dropoff", "date", "time", "name", "callback", "flight", "notes"]) if (k in out) out[k] = String(out[k]);
  return out;
}

// Turns as [{ who: 'caller' | 'agent', text, at }]. Prefers `transcripts`, else splits concatenated_transcript.
export function callTurns(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const out = [];
  if (Array.isArray(p.transcripts) && p.transcripts.length) {
    for (const t of p.transcripts) {
      if (!t || typeof t !== "object") continue;
      const role = String(t.user || t.role || "").toLowerCase();
      const who = role === "user" ? "caller" : role === "assistant" || role === "robot" || role === "agent" ? "agent" : "";
      const text = cleanText(String(t.text || ""), 1000);
      if (who && text) out.push({ who, text, at: Date.parse(t.created_at || "") || null });
    }
  } else if (typeof p.concatenated_transcript === "string") {
    for (const line of p.concatenated_transcript.split(/\n/)) {
      const m = /^\s*(user|assistant|agent|robot)\s*:\s*(.*)$/i.exec(line);
      if (!m) continue;
      const text = cleanText(m[2], 1000);
      if (text) out.push({ who: m[1].toLowerCase() === "user" ? "caller" : "agent", text, at: null });
    }
  }
  return out;
}

// The agent's read-back, as instructed in the script:
// "To confirm: Pickup: <place>. Drop-off: <place>. Date: <day>. Time: <time>. Name: <name>. Callback number: <digits>."
const LABELS = [
  ["pickup", /pick(?:-|\s)?up(?:\s+(?:at|from|address))?/],
  ["dropoff", /drop(?:-|\s)?off(?:\s+(?:at|address))?|destination/],
  ["date", /date|day/],
  ["time", /(?:pickup\s+)?time/],
  ["name", /(?:rider\s+|passenger\s+)?name/],
  ["callback", /call(?:-|\s)?back(?:\s+number)?|phone(?:\s+number)?/],
  ["passengers", /passengers?/],
  ["flight", /flight(?:\s+number)?/],
];
export function readBack(turns) {
  const agentLines = (turns || []).filter((t) => t.who === "agent" && /\bto confirm\b/i.test(t.text));
  if (!agentLines.length) return {};
  const text = agentLines[agentLines.length - 1].text.replace(/^[\s\S]*?\bto confirm\b\s*[:,-]?\s*/i, "");
  const labelRe = new RegExp("(?:^|[.;]\\s+|,\\s+)(" + LABELS.map(([, re]) => re.source).join("|") + ")\\s*:\\s*", "gi");
  const hits = [];
  let m;
  while ((m = labelRe.exec(text))) hits.push({ label: m[1].toLowerCase(), start: m.index, valueStart: labelRe.lastIndex });
  const out = {};
  for (let i = 0; i < hits.length; i += 1) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const raw = text.slice(hits[i].valueStart, end).replace(/[.;,\s]+$/, "").replace(/\s+(?:is that (?:right|correct)|did i get (?:that|everything) right)\??$/i, "").trim();
    const entry = LABELS.find(([, re]) => new RegExp("^(?:" + re.source + ")$", "i").test(hits[i].label));
    if (!entry || out[entry[0]] || val(raw) === "") continue;
    out[entry[0]] = entry[0] === "passengers" ? Number(raw.replace(/[^\d]/g, "")) || undefined : raw;
  }
  if (!out.passengers) delete out.passengers;
  return out;
}

function hhmm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  return String(h).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
}

// Date + time phrases from a call ("tomorrow", "Friday", "2026-11-21"; "8:15 PM", "20:15").
export function normalizeWhen(dateRaw, timeRaw, now = Date.now()) {
  const z = zoned(now);
  const warnings = [];
  let date = z.date;
  let dateExplicit = false;
  const d = String(dateRaw || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (iso) { date = d; dateExplicit = true; }
  else if (d) { const r = parseDate(d, z.date, z.weekday); date = r.date; dateExplicit = r.explicit; }
  let time = "";
  let timeAssumed = false;
  const t = String(timeRaw || "").trim();
  if (t) {
    const h24 = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
    const r = h24 ? { minutes: Number(h24[1]) * 60 + Number(h24[2]), meridiem: true } : parseTime(t);
    if (r) {
      let minutes = r.minutes;
      if (!r.meridiem) {
        const am = minutes % 720;
        const pm = am + 720;
        if (date === z.date) minutes = am > z.minutes ? am : pm > z.minutes ? pm : am;
        else minutes = /\b(tonight|evening|night)\b/i.test(t + " " + d) ? pm : am >= 360 ? am : pm;
        timeAssumed = true;
        warnings.push(`Time had no AM/PM; read as ${time12(hhmm(minutes))}. Check it.`);
      }
      if (!dateExplicit && date === z.date && minutes <= z.minutes) date = addDays(z.date, 1);
      time = hhmm(minutes);
    }
  }
  if (iso && date < z.date) warnings.push("The date is in the past. Check it.");
  return { date, time, timeAssumed, dateExplicit, warnings };
}

// Bland post-call webhook -> call facts, or { ignore: reason }.
// Bland sends the GET /v1/calls/:id object: call_id, to, from, inbound, completed, call_length (min),
// summary, concatenated_transcript, transcripts[], recording_url, variables, analysis, agent_dispositions.
// A disposition follow-up arrives later as { event_type: 'dispositions', call_id, agent_dispositions }.
export function readBlandCall(payload, isOurNumber) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ignore: "not an object" };
  const callId = String(payload.call_id || payload.c_id || "").trim().slice(0, 80);
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(callId)) return { ignore: "no call id" };
  if (payload.event_type === "dispositions") return { followUp: true, callId, fields: structuredFields(payload) };
  if (payload.event_type) return { ignore: "event " + String(payload.event_type).slice(0, 40) };
  if (payload.inbound !== true) return { ignore: "not an inbound call" };
  const ours = e164(payload.to || "");
  if (!ours || !isOurNumber(ours)) return { ignore: "unknown number" };
  const caller = e164(payload.from || "");
  const turns = callTurns(payload);
  const recording = typeof payload.recording_url === "string" && /^https:\/\/[^\s"'<>]{8,600}$/.test(payload.recording_url) ? payload.recording_url : "";
  const length = Number(payload.call_length);
  return {
    callId, ours, caller, turns, recordingUrl: recording,
    callLengthMin: Number.isFinite(length) && length >= 0 ? Math.round(length * 100) / 100 : null,
    summary: cleanText(String(payload.summary || ""), MAX_SUMMARY),
    endedBy: String(payload.call_ended_by || "").slice(0, 20),
    completed: payload.completed !== false,
    structured: structuredFields(payload),
  };
}

function trimTranscript(turns) {
  const out = [];
  let chars = 0;
  for (const t of turns.slice(0, MAX_TRANSCRIPT_TURNS)) {
    const text = t.text.slice(0, Math.max(0, MAX_TRANSCRIPT_CHARS - chars));
    if (!text) break;
    out.push({ who: t.who, text, at: t.at });
    chars += text.length;
  }
  return out;
}

// One parsed draft (same shape the text pipeline stores in intake_json.parsed) from a call.
export function parseCall(call, options = {}) {
  const now = options.now ?? Date.now();
  const s = call.structured || {};
  const rb = readBack(call.turns);
  const callerSaid = call.turns.filter((t) => t.who === "caller").map((t) => t.text).join("\n");
  const parsedSaid = parseRideText(callerSaid, { now, airports: options.airports });
  // The free-text parser only fills gaps when the caller's words look like a ride request and the caller
  // did not ask for a call back instead (so "can the owner call me" never becomes a drop-off).
  const useFallback = parsedSaid.looksLikeRide && !s.needsCallback;
  const fb = useFallback ? parsedSaid : { ...parsedSaid, pickup: "", dropoff: "", flight: "", airport: null, direction: "", passengers: null, luggage: null, name: "", time: "", timeAssumed: false };
  const fieldSource = {};
  const take = (f) => {
    if (s[f] !== undefined && s[f] !== "") { fieldSource[f] = "bland"; return s[f]; }
    if (rb[f] !== undefined && rb[f] !== "") { fieldSource[f] = "readback"; return rb[f]; }
    return undefined;
  };
  const pickup = take("pickup");
  const dropoff = take("dropoff");
  const dateRaw = take("date");
  const timeRaw = take("time");
  const name = take("name");
  const passengers = take("passengers");
  const flightRaw = take("flight");
  const callbackRaw = take("callback");
  const out = {
    text: call.summary || callerSaid.slice(0, 500),
    direction: fb.direction, airport: fb.airport,
    flight: flightRaw ? String(flightRaw).replace(/\s+/g, "").toUpperCase().slice(0, 12) : fb.flight,
    pickup: pickup ? String(pickup).slice(0, 200) : fb.pickup,
    dropoff: dropoff ? String(dropoff).slice(0, 200) : fb.dropoff,
    passengers: passengers || fb.passengers,
    luggage: s.luggage ?? fb.luggage,
    name: name ? String(name).slice(0, 80) : fb.name,
    notes: s.notes ? String(s.notes).slice(0, 500) : "",
  };
  if (!pickup) fieldSource.pickup = fb.pickup ? "transcript" : "";
  if (!dropoff) fieldSource.dropoff = fb.dropoff ? "transcript" : "";
  if (dateRaw || timeRaw) {
    const w = normalizeWhen(dateRaw, timeRaw, now);
    out.date = w.date; out.dateExplicit = w.dateExplicit;
    out.time = w.time || (timeRaw ? "" : fb.time); out.timeAssumed = w.time ? w.timeAssumed : fb.timeAssumed;
    if (!dateRaw && fb.dateExplicit) { out.date = fb.date; out.dateExplicit = true; }
    out.extraWarnings = w.warnings.filter((x) => !/AM\/PM/.test(x));
  } else {
    out.date = fb.date; out.dateExplicit = fb.dateExplicit; out.time = fb.time; out.timeAssumed = fb.timeAssumed;
    out.extraWarnings = [];
  }
  // Airport details from the final pickup/drop-off text, so terminal checks still run.
  if (!out.airport) {
    const ap = parseAirport([out.pickup, out.dropoff].join(" \n "), options.airports, { flight: out.flight });
    if (ap && !ap.assumed) {
      out.airport = { code: ap.code, name: ap.name, spot: ap.spot, assumed: false };
      if (!out.direction) out.direction = out.pickup && parseAirport(out.pickup, options.airports, {}) ? "arrival" : "departure";
    }
  }
  const callback = e164(callbackRaw || "") || "";
  out.callbackNumber = callback || call.caller || "";
  out.callbackDiffers = Boolean(callback && call.caller && callback !== call.caller);
  out.needsCallback = Boolean(s.needsCallback);
  out.confirmed = s.confirmed === true || Object.keys(rb).length >= 3;
  out.fieldSource = fieldSource;
  out.looksLikeRide = Boolean(out.pickup || out.dropoff || out.time || out.flight || out.airport);
  out.warnings = voiceWarnings(out, call);
  return out;
}

export function voiceWarnings(p, call = {}) {
  const w = draftWarnings(p).map((x) => x.replace("No date in the text", "No date from the call").replace("Ask the client.", "Call the client back."));
  for (const x of p.extraWarnings || []) if (!w.includes(x)) w.push(x);
  if (p.needsCallback) w.unshift("Caller asked for a call back from the owner.");
  if (!p.looksLikeRide) w.unshift("The caller may not have asked for a ride. Listen to the call.");
  if (!call.caller) w.push("Caller ID was hidden. Get a callback number before approving.");
  if (p.callbackDiffers) w.push("Callback number is different from caller ID.");
  if (p.looksLikeRide && !p.confirmed) w.push("The caller did not confirm the read-back. Check every field.");
  if (call.completed === false) w.push("The call did not finish normally.");
  return w;
}

export function voiceIntake(call, parsed) {
  return {
    v: 1, channel: "voice", provider: "bland",
    callId: call.callId, fromNumber: call.caller || "", toNumber: call.ours, callbackNumber: parsed.callbackNumber || "",
    messages: [{ body: call.summary || "(No summary from Bland.)", at: null }],
    transcript: trimTranscript(call.turns), recordingUrl: call.recordingUrl || "", callLengthMin: call.callLengthMin,
    summary: call.summary || "", fieldSource: parsed.fieldSource || {}, needsCallback: Boolean(parsed.needsCallback),
  };
}

// True when the call carried nothing to act on (hang-up, wrong number with no ride words, silence).
export function emptyCall(call, parsed) {
  const callerWords = call.turns.filter((t) => t.who === "caller").map((t) => t.text).join(" ").trim();
  const anyField = parsed.pickup || parsed.dropoff || parsed.time || parsed.flight || parsed.name || parsed.needsCallback || Object.keys(call.structured || {}).length;
  return !anyField && callerWords.length < 8;
}

export { airportPlace };
