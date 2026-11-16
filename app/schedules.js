// Regular client schedules (pure date math and validation; no network, no D1).
//
// A schedule repeats on fixed days of the month (1..31, or "last") and/or weekly days (0 = Sun .. 6 = Sat),
// between a start date and an optional end date. Dates are plain calendar dates (YYYY-MM-DD) in the
// operator's zone, the same America/New_York wall clock every ride already uses (rides store
// pickup_date / pickup_time as local wall time), so daylight-saving changes never move or duplicate a date.
//
// Rides are never created from here. The owner app lists upcoming occurrences and the owner confirms or
// skips each one; the server records that per (schedule, date) so a date is only ever created once.
import { readStops, stopsToStored } from "./stops.js";

export const SCHEDULE_ZONE = "America/New_York";
export const LAST_DAY = -1;
export const DEFAULT_LOOKAHEAD_DAYS = 14;
export const MAX_LOOKAHEAD_DAYS = 60;
export const MAX_SCAN_DAYS = 400;
export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validHhmm(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// month is 1..12
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Calendar date in the operator's zone at a given instant (DST-safe: Intl does the offset).
export function todayInZone(nowMs = Date.now(), zone = SCHEDULE_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
}

export function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAY_NAMES[weekdayOf(iso)]}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

function sortedUnique(list) {
  return [...new Set(list)].sort((a, b) => a - b);
}

// Month days from a request: numbers 1..31 or "last" (also -1). Returns { days } or { error }.
export function readMonthDays(input) {
  if (input === undefined || input === null || input === "") return { days: [] };
  if (!Array.isArray(input) || input.length > 40) return { error: "Days of the month must be a list." };
  const out = [];
  for (const raw of input) {
    if (raw === "last" || raw === LAST_DAY || raw === String(LAST_DAY)) { out.push(LAST_DAY); continue; }
    const n = typeof raw === "string" && /^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (!Number.isInteger(n) || n < 1 || n > 31) return { error: "Days of the month must be 1 to 31, or last." };
    out.push(n);
  }
  const days = sortedUnique(out);
  // Keep "last" at the end for display.
  return { days: days.filter((d) => d !== LAST_DAY).concat(days.includes(LAST_DAY) ? [LAST_DAY] : []) };
}

export function readWeekDays(input) {
  if (input === undefined || input === null || input === "") return { days: [] };
  if (!Array.isArray(input) || input.length > 14) return { error: "Weekdays must be a list." };
  const out = [];
  for (const raw of input) {
    const n = typeof raw === "string" && /^\d$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (!Number.isInteger(n) || n < 0 || n > 6) return { error: "Weekdays must be 0 (Sun) to 6 (Sat)." };
    out.push(n);
  }
  return { days: sortedUnique(out) };
}

function readFareCents(value) {
  if (value === undefined || value === null || value === "") return { cents: null };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e5) return { cents: Math.round(value * 100) };
  if (typeof value !== "string") return { error: "Enter the default fare in dollars, such as 125, or leave it blank." };
  const t = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return { cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) > 1e5) return { error: "Enter the default fare in dollars, such as 125, or leave it blank." };
  return { cents: Math.round(Number(t) * 100) };
}

// Validate a schedule body. `existing` (already in API shape) fills in missing keys for a PATCH.
// Returns { fields } (D1 column names) or { error }.
export function readSchedule(body, existing) {
  const pick = (key) => (body[key] !== undefined ? body[key] : existing ? existing[key] : undefined);
  const clientId = clean(pick("clientId"), 36);
  if (!/^[0-9a-f-]{36}$/.test(clientId)) return { error: "Choose a client." };
  const month = readMonthDays(pick("monthDays"));
  if (month.error) return { error: month.error };
  const week = readWeekDays(pick("weekDays"));
  if (week.error) return { error: week.error };
  if (!month.days.length && !week.days.length) return { error: "Pick at least one day of the month or weekday." };
  const time = clean(pick("time"), 5);
  if (!validHhmm(time)) return { error: "Enter the pickup time." };
  const pickup = clean(pick("pickup"), 200);
  const dropoff = clean(pick("dropoff"), 200);
  if (!pickup) return { error: "Enter the pickup address." };
  if (!dropoff) return { error: "Enter the drop-off address." };
  const stopsIn = readStops(pick("stops"));
  if (stopsIn.error) return { error: stopsIn.error };
  const passengersRaw = pick("passengers");
  const passengers = passengersRaw === undefined || passengersRaw === null || passengersRaw === "" ? 1 : Number(passengersRaw);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 14) return { error: "Enter passengers from 1 to 14." };
  const flight = clean(pick("flight"), 12).toUpperCase();
  const notes = typeof pick("notes") === "string" ? pick("notes").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, 2000) : "";
  const label = clean(pick("label"), 80);
  const fareKey = body.fare !== undefined ? body.fare : existing ? (existing.fareCents == null ? null : (existing.fareCents / 100).toFixed(2)) : undefined;
  const fare = readFareCents(fareKey);
  if (fare.error) return { error: fare.error };
  const driverRaw = pick("driverUserId");
  const driverUserId = driverRaw === undefined || driverRaw === null || driverRaw === "" ? null : clean(driverRaw, 36);
  if (driverUserId !== null && !/^[0-9a-f-]{36}$/.test(driverUserId)) return { error: "Choose a driver from the list." };
  const startDate = clean(pick("startDate"), 10);
  if (!validIsoDate(startDate)) return { error: "Enter the start date." };
  const endRaw = pick("endDate");
  const endDate = endRaw === undefined || endRaw === null || endRaw === "" ? null : clean(endRaw, 10);
  if (endDate !== null && !validIsoDate(endDate)) return { error: "Enter a valid end date, or leave it blank." };
  if (endDate !== null && endDate < startDate) return { error: "The end date must be on or after the start date." };
  const lookRaw = pick("lookaheadDays");
  const lookaheadDays = lookRaw === undefined || lookRaw === null || lookRaw === "" ? DEFAULT_LOOKAHEAD_DAYS : Number(lookRaw);
  if (!Number.isInteger(lookaheadDays) || lookaheadDays < 1 || lookaheadDays > MAX_LOOKAHEAD_DAYS) return { error: `Remind me between 1 and ${MAX_LOOKAHEAD_DAYS} days ahead.` };
  const activeRaw = pick("active");
  const active = activeRaw === undefined ? true : activeRaw === true || activeRaw === 1 || activeRaw === "true";
  if (activeRaw !== undefined && typeof activeRaw !== "boolean" && activeRaw !== 0 && activeRaw !== 1 && activeRaw !== "true" && activeRaw !== "false") return { error: "Active must be true or false." };
  return {
    fields: {
      client_id: clientId, label, month_days: JSON.stringify(month.days), week_days: JSON.stringify(week.days), pickup_time: time,
      pickup, dropoff, stops_json: stopsToStored(stopsIn.stops), passengers, flight, notes, fare_cents: fare.cents,
      driver_user_id: driverUserId, start_date: startDate, end_date: endDate, lookahead_days: lookaheadDays, active: active ? 1 : 0,
    },
  };
}

// Tolerant JSON list read for stored month_days / week_days.
export function parseDayList(text, kind) {
  try {
    const value = JSON.parse(String(text || "[]"));
    const read = kind === "week" ? readWeekDays(value) : readMonthDays(value);
    return read.days || [];
  } catch {
    return [];
  }
}

// Does `iso` fall on this schedule? Returns null, or { date, weekday, viaWeek, monthDays, lastDayFallback, note }.
// A month day the month does not have (29, 30, 31) lands on that month's last day, and says so.
export function matchDate(schedule, iso) {
  if (!validIsoDate(iso)) return null;
  if (schedule.startDate && iso < schedule.startDate) return null;
  if (schedule.endDate && iso > schedule.endDate) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dim = daysInMonth(y, m);
  const weekday = weekdayOf(iso);
  const viaWeek = (schedule.weekDays || []).includes(weekday);
  const monthDays = schedule.monthDays || [];
  const exact = monthDays.includes(d);
  const viaLast = d === dim && monthDays.includes(LAST_DAY);
  const missing = d === dim ? monthDays.filter((n) => n !== LAST_DAY && n > dim) : [];
  if (!viaWeek && !exact && !viaLast && !missing.length) return null;
  const lastDayFallback = missing.length > 0 && !exact && !viaLast && !viaWeek;
  let note = "";
  if (missing.length && !exact) note = `Last day of ${MONTH_NAMES[m - 1]} (no ${missing.map(ordinal).join(" or ")} this month)`;
  else if (viaLast && !exact && !viaWeek) note = "Last day of the month";
  return { date: iso, weekday, viaWeek, lastDayFallback, note };
}

// Every occurrence from `fromIso` to `toIso` inclusive (each date at most once), capped at MAX_SCAN_DAYS.
export function occurrencesBetween(schedule, fromIso, toIso) {
  const out = [];
  if (!validIsoDate(fromIso) || !validIsoDate(toIso) || toIso < fromIso) return out;
  let day = schedule.startDate && schedule.startDate > fromIso ? schedule.startDate : fromIso;
  const last = schedule.endDate && schedule.endDate < toIso ? schedule.endDate : toIso;
  for (let i = 0; day <= last && i < MAX_SCAN_DAYS; i++, day = addDays(day, 1)) {
    const hit = matchDate(schedule, day);
    if (hit) out.push(hit);
  }
  return out;
}

// Occurrences the owner still has to confirm or skip: today .. today + lookahead, minus handled dates.
// `handled` is a Set of YYYY-MM-DD already confirmed or skipped for this schedule.
export function pendingOccurrences(schedule, todayIso, handled = new Set()) {
  if (!schedule.active) return [];
  const days = Math.min(Math.max(Number(schedule.lookaheadDays) || DEFAULT_LOOKAHEAD_DAYS, 1), MAX_LOOKAHEAD_DAYS);
  return occurrencesBetween(schedule, todayIso, addDays(todayIso, days)).filter((o) => !handled.has(o.date));
}

// "Monthly on the 1st, 15th and last day · Weekly on Mon, Thu"
export function describeSchedule(schedule) {
  const parts = [];
  const md = schedule.monthDays || [];
  if (md.length) {
    const names = md.map((n) => (n === LAST_DAY ? "last day" : ordinal(n)));
    const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    parts.push("Monthly on the " + list);
  }
  const wd = schedule.weekDays || [];
  if (wd.length) parts.push("Weekly on " + wd.map((n) => WEEKDAY_NAMES[n]).join(", "));
  return parts.join(" \u00b7 ");
}

// Shown under the days when any picked day is missing from some months.
export function monthEndNote(schedule) {
  const high = (schedule.monthDays || []).filter((n) => n >= 29);
  if (!high.length) return "";
  return `Months without the ${high.map(ordinal).join(", ")} use the last day of the month instead.`;
}
