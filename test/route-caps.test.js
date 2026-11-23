import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}

async function call(worker, path, { method = "GET", body, session, admin = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text };
  }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || "") };
}

function sessionOf(result) {
  return { cookie: result.cookie, csrf: result.data.csrf || "" };
}

async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "-c", "wrangler.toml", "--persist-to", persistTo],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

async function openOwner(worker, email, companyName, accountKind) {
  const invite = await call(worker, "/api/admin/invites", {
    method: "POST",
    admin: true,
    body: { email, companyName, accountKind },
  });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", {
    method: "POST",
    body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true },
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const session = sessionOf(accepted);
  const settings = await call(worker, "/api/settings", { session });
  assert.equal(settings.status, 200, JSON.stringify(settings.data));
  return { session, slug: settings.data.settings.bookingSlug, companyName };
}

function futureDate(days) {
  return new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

const SUV = { name: "SUV", seats: 6, hourlyRate: "75", minHours: 3, blockMinutes: 15, blockPrice: "18.75" };
const DISTANCE = { base: "10", perMile: "3", perMinute: "", minimum: "65", airportFee: "15", extraStopFee: "10" };

async function startWorker(persistTo, vars) {
  await applyMigrations(persistTo);
  return unstable_dev("app/index.js", {
    config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", ...vars },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
}

async function setUpFleet(worker, email) {
  const fleet = await openOwner(worker, email, "Distance Cars", "fleet");
  const rates = await call(worker, "/api/rate-sheet", { method: "PUT", session: fleet.session, body: { enabled: true, rateSheet: { vehicles: [SUV], distance: DISTANCE } } });
  assert.equal(rates.status, 200, JSON.stringify(rates.data));
  assert.equal(rates.data.rateSheet.distanceSet, true);
  assert.deepEqual(rates.data.rateSheet.distance, { base: "10", perMile: "3", perMinute: "", minimum: "65", airportFee: "15", extraStopFee: "10" });
  const driver = await call(worker, "/api/drivers", { method: "POST", session: fleet.session, body: { name: "Dee Driver", vehicle: "Black Chevy Suburban" } });
  assert.equal(driver.status, 201, JSON.stringify(driver.data));
  const air = await call(worker, "/api/booking-settings", { method: "PUT", session: fleet.session, body: { preset: ["ATL", "CLT"] } });
  assert.equal(air.status, 200, JSON.stringify(air.data));
  return fleet;
}

async function rideFor(worker, session, clientName) {
  const list = await call(worker, "/api/rides", { session });
  return (list.data.rides || []).find((r) => r.clientName === clientName);
}


// ---------- Routes caps and the pre-0019 schema (PR #39 review, Nov 21, 2026) ----------
// Fake routing (QUOTE_DEV_FAKE_ROUTE) counts against the same caps as Google, so these run offline.
const ROOT = new URL("..", import.meta.url).pathname;
let uniq = 0;
const street = () => `${100 + (++uniq)} Unique St, Alpharetta, GA`;
const publicQuote = (worker, slug) => call(worker, `/api/public/book/${slug}/quote`, { method: "POST", body: { tripType: "one-way", vehicle: "suv", passengers: 2, pickup: street(), dropoff: "200 Peachtree St, Atlanta, GA" } });
const preview = (worker, session) => call(worker, "/api/rate-sheet/preview", { method: "POST", session, body: { tripType: "one-way", vehicle: "suv", pickup: street(), dropoff: "200 Peachtree St, Atlanta, GA" } });
const priced = (r) => !!(r.data && r.data.quote && r.data.quote.available);

function d1(persistTo, sql, config = "wrangler.toml") {
  return new Promise((resolve, reject) => {
    let out = "";
    const child = spawn("npx", ["wrangler", "d1", "execute", "nudge-app-local", "--local", "-c", config, "--persist-to", persistTo, "--json", "--command", sql], { cwd: ROOT, env: { ...process.env, CI: "1" } });
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error("d1 execute exited " + code));
      try { resolve(JSON.parse(out.slice(out.indexOf("[")))[0].results); } catch (e) { reject(e); }
    });
  });
}

test("Routes caps: atomic, per fleet, public quotes bounded, one fleet cannot zero another", { timeout: 300000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-caps-"));
  let worker;
  try {
    worker = await startWorker(persistTo, { ROUTES_DAILY_CAP: "6", ROUTES_FLEET_DAILY_CAP: "10", ROUTES_PUBLIC_DAILY_CAP: "3", ROUTES_FLEET_RESERVE: "2", FLIGHT_PROVIDER: "off" });
    const a = await setUpFleet(worker, "caps-a@example.test");
    const b = await setUpFleet(worker, "caps-b@example.test");

    // Fleet A, unauthenticated, 6 unique trips at once: exactly 3 priced (ROUTES_PUBLIC_DAILY_CAP, atomic).
    const burst = await Promise.all(Array.from({ length: 6 }, () => publicQuote(worker, a.slug)));
    assert.equal(burst.filter(priced).length, 3, JSON.stringify(burst.map((r) => r.status)));
    const refused = burst.find((r) => !priced(r));
    assert.equal(refused.status, 200);
    assert.equal(refused.data.quote.message, "We'll confirm your price shortly.");

    // Fleet A's owner keeps going until the shared budget (6) is gone: 3 more, then refused.
    const previews = [];
    for (let i = 0; i < 5; i++) previews.push(priced(await preview(worker, a.session)));
    assert.deepEqual(previews, [true, true, true, false, false]);

    // Shared budget used up by A. Fleet B is not at zero: its reserve (2) still prices, then manual.
    const bQuotes = [];
    for (let i = 0; i < 3; i++) bQuotes.push(priced(await publicQuote(worker, b.slug)));
    assert.deepEqual(bQuotes, [true, true, false], "fleet B keeps its reserve after fleet A spent the shared cap");

    // Hourly makes no Routes call: still priced with every Routes cap reached.
    const hourly = await call(worker, `/api/public/book/${b.slug}/quote`, { method: "POST", body: { tripType: "hourly", vehicle: "suv", passengers: 2, pickup: street(), hours: 4 } });
    assert.equal(hourly.data.quote.available, true, JSON.stringify(hourly.data));
    assert.equal(hourly.data.quote.basis, "hourly");

    // A booking with every cap reached still saves (Price needed).
    const booked = await call(worker, "/api/public/book/" + a.slug, { method: "POST", body: { name: "Capped Rider", phone: "404-555-0170", date: futureDate(3), time: "10:00", passengers: 2, vehicle: "suv", tripType: "one-way", pickup: street(), dropoff: "200 Peachtree St, Atlanta, GA" } });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    assert.equal((await rideFor(worker, a.session, "Capped Rider")).priceNeeded, true);

    // The short IP window still answers 429 (120 per IP per 15 minutes).
    let got429 = false;
    for (let i = 0; i < 130 && !got429; i++) got429 = (await publicQuote(worker, b.slug)).status === 429;
    assert.equal(got429, true);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("ROUTES_DAILY_CAP: refused calls are not counted, a raised cap works the same day, the count resets by Eastern day", { timeout: 300000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-caps-day-"));
  let worker;
  try {
    const base = { ROUTES_FLEET_DAILY_CAP: "100", ROUTES_PUBLIC_DAILY_CAP: "100", ROUTES_FLEET_RESERVE: "0", FLIGHT_PROVIDER: "off" };
    worker = await startWorker(persistTo, { ...base, ROUTES_DAILY_CAP: "5" });
    const fleet = await setUpFleet(worker, "caps-day@example.test");
    const first = [];
    for (let i = 0; i < 9; i++) first.push(priced(await preview(worker, fleet.session)));
    assert.deepEqual(first, [true, true, true, true, true, false, false, false, false]);
    await worker.stop();
    worker = null;

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const rows = await d1(persistTo, "SELECT day, kind, calls FROM api_daily_usage ORDER BY kind");
    const global = rows.find((r) => r.kind === "routes");
    assert.equal(global.calls, 5, "the 4 refused calls were not counted");
    assert.equal(global.day, today, "counted by the Eastern day");
    assert.ok(rows.some((r) => r.kind.startsWith("routes-fleet:") && r.calls === 5 && r.day === today), JSON.stringify(rows));

    // Raised the same day: exactly 3 more (5 -> 8).
    worker = await startWorker(persistTo, { ...base, ROUTES_DAILY_CAP: "8" });
    const login = await call(worker, "/api/login", { method: "POST", body: { email: "caps-day@example.test", password: "sample-owner-pass" } });
    const session = sessionOf(login);
    const raised = [];
    for (let i = 0; i < 4; i++) raised.push(priced(await preview(worker, session)));
    assert.deepEqual(raised, [true, true, true, false]);
    await worker.stop();
    worker = null;

    // Yesterday's counts don't limit today: move today's rows to yesterday, and the full cap is back.
    await d1(persistTo, "UPDATE api_daily_usage SET day = '2000-01-01'");
    worker = await startWorker(persistTo, { ...base, ROUTES_DAILY_CAP: "2" });
    const session2 = sessionOf(await call(worker, "/api/login", { method: "POST", body: { email: "caps-day@example.test", password: "sample-owner-pass" } }));
    const fresh = [];
    for (let i = 0; i < 3; i++) fresh.push(priced(await preview(worker, session2)));
    assert.deepEqual(fresh, [true, true, false]);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("Worker before migration 0019: bookings save, the ride list works, quotes fail closed to manual", { timeout: 300000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-pre0019-"));
  const migDir = await mkdtemp(join(tmpdir(), "nudge-mig-0018-"));
  const config = join(migDir, "wrangler.toml");
  let worker;
  try {
    // Migrations 0001-0018 only, applied with a copy of wrangler.toml that points at that folder.
    const { readdir, copyFile, readFile, writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(migDir, "migrations"));
    for (const f of (await readdir(join(ROOT, "migrations"))).filter((x) => x.endsWith(".sql") && x < "0019")) await copyFile(join(ROOT, "migrations", f), join(migDir, "migrations", f));
    await writeFile(config, (await readFile(join(ROOT, "wrangler.toml"), "utf8")).replace(/migrations_dir = "migrations"/, `migrations_dir = "${join(migDir, "migrations")}"`).replace(/^main = .*$/m, `main = "${join(ROOT, "app/index.js")}"`));
    await new Promise((resolve, reject) => {
      const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "-c", config, "--persist-to", persistTo], { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("migrations exited " + code))));
    });
    const cols = await d1(persistTo, "SELECT name FROM pragma_table_info('rides')", config);
    assert.ok(!cols.some((c) => c.name === "quote_status"), "really the pre-0019 schema");

    // startWorker() would apply every migration; start this one on the 0018 database as it is.
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const fleet = await openOwner(worker, "pre0019@example.test", "Old Schema Cars", "fleet");
    const rates = await call(worker, "/api/rate-sheet", { method: "PUT", session: fleet.session, body: { enabled: true, rateSheet: { vehicles: [SUV], distance: DISTANCE } } });
    assert.equal(rates.status, 200, JSON.stringify(rates.data));

    const q = await publicQuote(worker, fleet.slug);
    assert.equal(q.status, 200, JSON.stringify(q.data));
    assert.equal(q.data.quote.available, false, "no usage table: fail closed, no uncounted routing call " + JSON.stringify(q.data.quote));
    assert.equal(q.data.quote.message, "We'll confirm your price shortly.");

    const booked = await call(worker, "/api/public/book/" + fleet.slug, { method: "POST", body: { name: "Old Schema Rider", phone: "404-555-0180", date: futureDate(3), time: "10:00", passengers: 2, vehicle: "suv", tripType: "one-way", pickup: street(), dropoff: "200 Peachtree St, Atlanta, GA" } });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    const list = await call(worker, "/api/rides", { session: fleet.session });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    const ride = list.data.rides.find((r) => r.clientName === "Old Schema Rider");
    assert.ok(ride, "the booking was saved");
    assert.equal(ride.priceNeeded, true);
    const one = await call(worker, `/api/rides/${ride.id}`, { session: fleet.session });
    assert.equal(one.status, 200, JSON.stringify(one.data));
    const base = await call(worker, "/api/booking-settings", { method: "PUT", session: fleet.session, body: { base: { address: "1 Main St, Alpharetta, GA", lat: 34.07, lng: -84.29, radiusMiles: 20 } } });
    assert.equal(base.status, 503);
    assert.match(base.data.error, /migration 0019/);
    const still = await d1(persistTo, "SELECT name FROM sqlite_master WHERE type='table' AND name = 'api_daily_usage'", config);
    assert.equal(still.length, 0, "the whole test ran on the pre-0019 schema");
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
    await rm(migDir, { recursive: true, force: true });
  }
});
