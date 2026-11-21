// Flight tracking for airport pickups (pure rules + a provider adapter; no D1 here).
//
// The ride's pickup time is what the rider typed. The flight number is only for watching the
// flight, so nothing here changes the pickup time. The driver is alerted when:
//   * the flight is cancelled or diverted,
//   * it is running late by more than delayMinutes (default 30),
//   * it is arriving early by earlyMinutes or more (default 15; operators may set 15 to 30),
//   * anything else about the arrival changes after the first check (new estimated time,
//     terminal or gate, departed or landed).
// Provider: see flight-provider.js (FLIGHT_PROVIDER + FLIGHT_API_KEY; the older FLIGHT_DATA_* names
// still work). With no provider set nothing is fetched.

export { flightProvider, fetchFlightSnapshot, snapshotFromAeroApi } from "./flight-provider.js";

export const DEFAULT_FLIGHT_RULES = { earlyMinutes: 15, delayMinutes: 30, minChangeMinutes: 5 };

export function flightRules(input) {
  const r = { ...DEFAULT_FLIGHT_RULES };
  const early = Number(input && input.earlyMinutes);
  if (Number.isFinite(early) && early >= 15 && early <= 30) r.earlyMinutes = Math.round(early);
  const delay = Number(input && input.delayMinutes);
  if (Number.isFinite(delay) && delay >= 15 && delay <= 120) r.delayMinutes = Math.round(delay);
  return r;
}

// "DL 1234", "dal1234", "Delta 1234" -> "DL1234"-style ident the provider accepts.
const AIRLINE_NAMES = { delta: "DL", american: "AA", united: "UA", southwest: "WN", spirit: "NK", frontier: "F9", jetblue: "B6", alaska: "AS" };
export function normalizeFlight(text) {
  let t = String(text || "").trim().toLowerCase();
  for (const [name, code] of Object.entries(AIRLINE_NAMES)) if (t.startsWith(name)) t = code.toLowerCase() + t.slice(name.length);
  t = t.replace(/[^a-z0-9]/g, "").toUpperCase();
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(t) ? t : "";
}

function clock(msValue, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(msValue));
}

// Compare the last snapshot with a new one. Returns [{ kind, key, message }] (key dedupes).
export function flightAlerts(prev, next, rulesIn, ctx) {
  if (!next) return [];
  const rules = flightRules(rulesIn);
  const tz = ctx && ctx.timeZone;
  const flight = (ctx && ctx.flight) || next.ident || "The flight";
  const pickup = ctx && ctx.pickupTimeLabel ? ` Pickup stays at ${ctx.pickupTimeLabel} unless the office changes it.` : "";
  const out = [];
  const add = (kind, key, message) => out.push({ kind, key: kind + ":" + key, message: message + pickup });
  if (next.cancelled && !(prev && prev.cancelled)) add("cancelled", "1", `${flight} was cancelled.`);
  if (next.diverted && !(prev && prev.diverted)) add("diverted", "1", `${flight} was diverted.`);
  if (next.cancelled || next.diverted) return out;
  const sched = next.scheduledArrival;
  const est = next.estimatedArrival;
  if (sched != null && est != null) {
    const off = Math.round((est - sched) / 60000);
    const prevOff = prev && prev.scheduledArrival != null && prev.estimatedArrival != null ? Math.round((prev.estimatedArrival - prev.scheduledArrival) / 60000) : null;
    const estKey = String(Math.round(est / 60000));
    if (off <= -rules.earlyMinutes && (prevOff == null || Math.abs(off - prevOff) >= rules.minChangeMinutes || prevOff > -rules.earlyMinutes)) {
      add("early", estKey, `${flight} is arriving early: ${-off} min ahead of schedule, now ${clock(est, tz)}.`);
    } else if (off > rules.delayMinutes && (prevOff == null || Math.abs(off - prevOff) >= rules.minChangeMinutes || prevOff <= rules.delayMinutes)) {
      add("delay", estKey, `${flight} is delayed ${off} min, now arriving ${clock(est, tz)}.`);
    } else if (prev && prev.estimatedArrival != null && Math.abs(est - prev.estimatedArrival) >= rules.minChangeMinutes * 60000) {
      add("changed", estKey, `${flight} arrival time changed to ${clock(est, tz)} (was ${clock(prev.estimatedArrival, tz)}).`);
    }
  }
  if (prev) {
    if (next.terminal && prev.terminal && next.terminal !== prev.terminal) add("changed", "t" + next.terminal, `${flight} now arrives at terminal ${next.terminal}.`);
    if (next.gate && prev.gate && next.gate !== prev.gate) add("changed", "g" + next.gate, `${flight} gate changed to ${next.gate}.`);
    if (next.departed && !prev.departed) add("changed", "departed", `${flight} has departed.`);
    if (next.landed && !prev.landed) add("changed", "landed", `${flight} has landed${est != null ? " at " + clock(est, tz) : ""}.`);
  }
  return out;
}

// Which rides to watch: approved or pending airport pickups with a flight, from 6 h before to
// 3 h after the pickup time. Returns true/false for one ride row and the current time.
export function shouldWatch(row, nowMs, pickupMs) {
  if (!row || !row.flight || row.status !== "scheduled") return false;
  if (row.approval === "declined") return false;
  if (pickupMs == null) return false;
  return nowMs >= pickupMs - 6 * 3600e3 && nowMs <= pickupMs + 3 * 3600e3;
}
