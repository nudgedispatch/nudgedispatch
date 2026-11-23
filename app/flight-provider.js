// Flight data provider interface (Nov 20, 2026). One adapter per provider; the rest of the app
// only calls flightProvider() and fetchFlightSnapshot().
//
// Config (Worker secrets/vars):
//   FLIGHT_PROVIDER = aeroapi | aerodatabox | cirium | off   (unset = off)
//   FLIGHT_API_KEY  = the provider key (secret)
// The older names FLIGHT_DATA_PROVIDER / FLIGHT_DATA_API_KEY are still read when the new ones are
// unset, so the 5-minute flight-alert cron keeps working during the switch.
//
// Snapshot shape (every adapter returns this):
//   { ident, scheduledArrival, estimatedArrival, actualArrival, landed, departed, cancelled,
//     diverted, terminal, gate, status }   (times are epoch ms or null)

const ms = (iso) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : null;
};

function providerName(env) {
  return String((env && (env.FLIGHT_PROVIDER || env.FLIGHT_DATA_PROVIDER)) || "off").trim().toLowerCase();
}
function providerKey(env) {
  return (env && (env.FLIGHT_API_KEY || env.FLIGHT_DATA_API_KEY)) || "";
}
// Local tests only: a 127.0.0.1 mock server may stand in for the provider.
function localBase(env) {
  const b = env && (env.FLIGHT_API_BASE || env.FLIGHT_DATA_API_BASE);
  return b && /^http:\/\/127\.0\.0\.1:\d+$/.test(b) ? b : "";
}

// ---- FlightAware AeroAPI (implemented) ----
// /flights/{ident} -> our snapshot, picking the flight that lands closest to `around`.
export function snapshotFromAeroApi(data, around) {
  const flights = data && Array.isArray(data.flights) ? data.flights : [];
  let best = null;
  let bestGap = Infinity;
  for (const f of flights) {
    const sched = ms(f.scheduled_in) ?? ms(f.scheduled_on);
    if (sched == null) continue;
    const gap = Math.abs(sched - around);
    if (gap < bestGap) { best = f; bestGap = gap; }
  }
  if (!best || bestGap > 18 * 3600e3) return null;
  const scheduled = ms(best.scheduled_in) ?? ms(best.scheduled_on);
  const actual = ms(best.actual_on) ?? ms(best.actual_in);
  const estimated = ms(best.actual_in) ?? ms(best.actual_on) ?? ms(best.estimated_in) ?? ms(best.estimated_on) ?? scheduled;
  return {
    ident: String(best.ident || best.ident_iata || ""),
    scheduledArrival: scheduled,
    estimatedArrival: estimated,
    actualArrival: actual,
    landed: !!(best.actual_on || best.actual_in),
    departed: !!(best.actual_off || best.actual_out),
    cancelled: !!best.cancelled,
    diverted: !!best.diverted,
    terminal: String(best.terminal_destination || ""),
    gate: String(best.gate_destination || ""),
    status: String(best.status || ""),
  };
}

const aeroapi = {
  name: "aeroapi",
  async fetch(env, ident, aroundMs, doFetch) {
    const start = new Date(aroundMs - 12 * 3600e3).toISOString().slice(0, 19) + "Z";
    const end = new Date(aroundMs + 12 * 3600e3).toISOString().slice(0, 19) + "Z";
    const base = localBase(env) || "https://aeroapi.flightaware.com/aeroapi";
    const url = `${base}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const res = await doFetch(url, { headers: { "x-apikey": providerKey(env), accept: "application/json" }, signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return { ok: false, problem: `Flight lookup failed (${res.status}).` };
    const snap = snapshotFromAeroApi(await res.json(), aroundMs);
    return snap ? { ok: true, snapshot: snap } : { ok: false, problem: "Flight not found near the pickup time." };
  },
};

// ---- AeroDataBox and Cirium: stubs. Implement fetch() and remove `stub` to switch over. ----
const stub = (name) => ({
  name,
  stub: true,
  async fetch() {
    return { ok: false, problem: `The ${name} flight adapter is not built yet.` };
  },
});

const ADAPTERS = { aeroapi, aerodatabox: stub("aerodatabox"), cirium: stub("cirium") };

export function flightProvider(env) {
  const p = providerName(env);
  if (p === "off" || p === "") return { name: "off", ready: false, problem: "Flight tracking is off (FLIGHT_PROVIDER is not set)." };
  const adapter = ADAPTERS[p];
  if (!adapter) return { name: p, ready: false, problem: `Unknown FLIGHT_PROVIDER ${p}.` };
  if (adapter.stub) return { name: p, ready: false, problem: `The ${p} flight adapter is not built yet.` };
  if (!providerKey(env)) return { name: p, ready: false, problem: "FLIGHT_API_KEY is not set." };
  return { name: p, ready: true, problem: "" };
}

export async function fetchFlightSnapshot(env, ident, aroundMs, fetchImpl) {
  const provider = flightProvider(env);
  if (!provider.ready) return { ok: false, problem: provider.problem };
  try {
    return await ADAPTERS[provider.name].fetch(env, ident, aroundMs, fetchImpl || fetch);
  } catch (error) {
    return { ok: false, problem: "Flight lookup failed (" + (error instanceof Error ? error.name : "Error") + ")." };
  }
}
