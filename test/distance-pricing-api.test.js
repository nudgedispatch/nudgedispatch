import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
      ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo],
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
const sumLines = (q) => q.lines.reduce((n, l) => n + Math.round(Number(l.amount.replace(/[$,]/g, "")) * 100), 0);
const cents = (text) => Math.round(Number(String(text).replace(/[^0-9.]/g, "")) * 100);

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

test("distance pricing: stops, airport fee and curb pins, round trip, hourly, flight lookup, snapshot", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-distance-"));
  let flightMode = "ok";
  const flightServer = createServer((req, res) => {
    assert.equal(req.headers["x-apikey"], "test-flight-key");
    if (flightMode === "down") { res.writeHead(503); res.end("{}"); return; }
    const url = new URL(req.url, "http://x");
    const start = Date.parse(url.searchParams.get("start"));
    const sched = new Date(start + 12 * 3600e3).toISOString();
    const est = new Date(start + 12 * 3600e3 + 10 * 60000).toISOString();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ flights: [{ ident: "DAL1234", scheduled_in: sched, estimated_in: est, terminal_destination: "I", gate_destination: "E12" }] }));
  });
  await new Promise((resolve) => flightServer.listen(0, "127.0.0.1", resolve));
  let worker;
  try {
    worker = await startWorker(persistTo, {
      FLIGHT_PROVIDER: "aeroapi", FLIGHT_API_KEY: "test-flight-key", FLIGHT_API_BASE: `http://127.0.0.1:${flightServer.address().port}`,
      GOOGLE_MAPS_BROWSER_KEY: "test-browser-key-0123456789",
    });
    const fleet = await setUpFleet(worker, "distance@example.test");
    const slug = fleet.slug;

    // Booking page: browser key for autocomplete, airport centers and airline tables, no server key.
    const page = await call(worker, "/api/public/book/" + slug);
    assert.equal(page.data.mapsKey, "test-browser-key-0123456789");
    assert.equal(page.data.quotes.distance, true);
    assert.deepEqual(page.data.quotes.places, [], "no flat-fare chips once distance rates are set");
    assert.deepEqual(page.data.airports.map((a) => a.code), ["ATL", "CLT"]);
    assert.deepEqual(page.data.airports[0].airlines.DL, ["domestic-south", "international"]);
    assert.ok(page.data.airports[0].center.lat > 33);
    assert.doesNotMatch(JSON.stringify(page.data), /"curb"\s*:|providerCodes|latLng/, "no curb pins on the public page");
    const html = await worker.fetch(`http://127.0.0.1/book/${slug}/`);
    assert.match(html.headers.get("content-security-policy"), /script-src [^;]*https:\/\/\*\.googleapis\.com/);
    assert.equal(html.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.doesNotMatch(await html.text(), /http-equiv="Content-Security-Policy"/);
    const appShell = await worker.fetch("http://127.0.0.1/");
    assert.match(appShell.headers.get("content-security-policy"), /googleapis/, "owner/driver app loads Places too");
    assert.equal(appShell.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    const css = await worker.fetch("http://127.0.0.1/app.css");
    assert.doesNotMatch(css.headers.get("content-security-policy"), /googleapis/, "other responses keep the strict CSP");
    assert.equal(css.headers.get("referrer-policy"), "no-referrer");

    // Fleet home base: bias for suggestions, rounded on public pages, clamped to Google's 50 km.
    assert.equal(page.data.bias, null, "no base yet: default behaviour");
    const badBase = await call(worker, "/api/booking-settings", { method: "PUT", session: fleet.session, body: { base: { address: "1 Main St, Alpharetta, GA", lat: 34.07, radiusMiles: 50 } } });
    assert.equal(badBase.status, 400);
    const setBase = await call(worker, "/api/booking-settings", { method: "PUT", session: fleet.session, body: { base: { address: "1 Main St, Alpharetta, GA", lat: 34.075376, lng: -84.294090, radiusMiles: 50 } } });
    assert.equal(setBase.status, 200, JSON.stringify(setBase.data));
    const withBase = await call(worker, "/api/public/book/" + slug);
    assert.deepEqual(withBase.data.bias, { lat: 34.08, lng: -84.29, radiusMeters: 50000 });
    assert.doesNotMatch(JSON.stringify(withBase.data), /1 Main St/, "the base address is not on the public page");
    const meNow = await call(worker, "/api/me", { session: fleet.session });
    assert.equal(meNow.data.maps.key, "test-browser-key-0123456789");
    assert.deepEqual(meNow.data.maps.bias, withBase.data.bias);
    const settingsNow = await call(worker, "/api/booking-settings", { session: fleet.session });
    assert.equal(settingsNow.data.base.address, "1 Main St, Alpharetta, GA");
    assert.equal(settingsNow.data.base.radiusMiles, 50);

    const quote = (body) => call(worker, `/api/public/book/${slug}/quote`, { method: "POST", body: { vehicle: "suv", passengers: 2, ...body } });
    const plain = await quote({ tripType: "one-way", pickup: "100 Main St, Alpharetta, GA", dropoff: "200 Peachtree St, Atlanta, GA" });
    assert.equal(plain.status, 200, JSON.stringify(plain.data));
    const q1 = plain.data.quote;
    assert.equal(q1.available, true, JSON.stringify(q1));
    assert.equal(q1.basis, "distance");
    assert.ok(q1.miles > 0 && Number.isInteger(q1.minutes));
    assert.equal(cents(q1.total), Math.max(1000 + Math.round(q1.miles * 300), 6500));
    assert.equal(sumLines(q1), cents(q1.total));

    // Two stops: routed with intermediates (longer) and the extra-stop fee per stop.
    const stops = await quote({ tripType: "one-way", pickup: "100 Main St, Alpharetta, GA", dropoff: "200 Peachtree St, Atlanta, GA", stops: ["Lenox Square, Atlanta", "Ponce City Market, Atlanta"] });
    const q2 = stops.data.quote;
    assert.equal(q2.available, true, JSON.stringify(q2));
    assert.ok(q2.lines.some((l) => l.label === "2 stops x $10" && l.amount === "$20"));
    assert.equal(cents(q2.total), Math.max(1000 + Math.round(q2.miles * 300), 6500) + 2000);

    // Airport pickup: fee added, and the terminal's own waypoint is routed (International vs Domestic).
    const intl = (await quote({ tripType: "one-way", dropoff: "100 Main St, Alpharetta, GA", airport: { code: "ATL", side: "pickup", spot: "international" } })).data;
    const north = (await quote({ tripType: "one-way", dropoff: "100 Main St, Alpharetta, GA", airport: { code: "ATL", side: "pickup", spot: "domestic-north" } })).data;
    assert.equal(intl.pickup, "ATL Airport - International Terminal");
    assert.ok(intl.quote.lines.some((l) => l.label === "Airport fee" && l.amount === "$15"));
    assert.notEqual(intl.quote.miles, north.quote.miles, "International and Domestic North are routed from different points");
    // An autocomplete Place of type airport on our list also counts (no airport connection chosen).
    const placeAirport = (await quote({ tripType: "one-way", pickup: "Hartsfield-Jackson Atlanta International Airport", dropoff: "100 Main St, Alpharetta, GA", places: { pickup: { placeId: "ChIJexampleexampleATL", lat: 33.6407, lng: -84.4277, types: ["airport"] } } })).data;
    assert.ok(placeAirport.quote.lines.some((l) => l.label === "Airport fee"));
    const hotel = (await quote({ tripType: "one-way", pickup: "Airport hotel", dropoff: "100 Main St, Alpharetta, GA", places: { pickup: { lat: 33.6407, lng: -84.4277, types: ["lodging"] } } })).data;
    assert.ok(!hotel.quote.lines.some((l) => l.label === "Airport fee"), "a non-airport place near ATL gets no fee");

    // Out of the service area still routes and prices normally (bias, not restriction).
    const far = (await quote({ tripType: "one-way", pickup: "500 Broadway, Nashville, TN", dropoff: "200 Peachtree St, Atlanta, GA" })).data.quote;
    assert.equal(far.available, true, JSON.stringify(far));
    // Round trip = 1.6 x the one-way fare.
    const rt = (await quote({ tripType: "round-trip", pickup: "100 Main St, Alpharetta, GA", dropoff: "200 Peachtree St, Atlanta, GA" })).data.quote;
    assert.equal(cents(rt.total), Math.round(cents(q1.total) * 1.6));
    // Hourly unchanged: $75/h, 3 h minimum, then $18.75 per 15 min.
    const hourly = (await quote({ tripType: "hourly", pickup: "100 Main St, Alpharetta, GA", hours: 4 })).data.quote;
    assert.equal(hourly.basis, "hourly");
    assert.ok(hourly.lines[0].amount === "$300", JSON.stringify(hourly));

    // Flight lookup: terminal, gate and landing time from the provider.
    const date = futureDate(1);
    const fs1 = await call(worker, `/api/public/book/${slug}/flight-status`, { method: "POST", body: { code: "ATL", flight: "DL1234", date, time: "15:00" } });
    assert.equal(fs1.status, 200);
    assert.equal(fs1.data.found, true, JSON.stringify(fs1.data));
    assert.equal(fs1.data.terminal, "international");
    assert.equal(fs1.data.terminalSource, "flight_lookup");
    assert.equal(fs1.data.gate, "E12");
    assert.ok(fs1.data.landingLabel);
    // Lookup down: the airline table answers, the raw provider error never reaches the rider.
    flightMode = "down";
    const fs2 = await call(worker, `/api/public/book/${slug}/flight-status`, { method: "POST", body: { code: "ATL", flight: "AA100", date, time: "15:00" } });
    assert.equal(fs2.data.found, false);
    assert.equal(fs2.data.terminal, "domestic-north");
    assert.equal(fs2.data.terminalSource, "airline_table");
    assert.doesNotMatch(JSON.stringify(fs2.data), /503|failed|key/i);
    const fs3 = await call(worker, `/api/public/book/${slug}/flight-status`, { method: "POST", body: { code: "ATL", flight: "DL555", date, time: "15:00" } });
    assert.equal(fs3.data.terminal, "", "Delta depends on the flight: no pre-selection");
    assert.deepEqual(fs3.data.airlineTerminals, ["domestic-south", "international"]);
    flightMode = "ok";

    // Bookings save the quote, a rate snapshot, and airport details; the owner approves at the quote.
    const book = (body) => call(worker, "/api/public/book/" + slug, { method: "POST", body: { name: "Rider", phone: "404-555-0101", date, time: "15:00", passengers: 2, vehicle: "suv", ...body } });
    const b1 = await book({ name: "Plain Rider", phone: "404-555-0111", tripType: "one-way", pickup: "100 Main St, Alpharetta, GA", dropoff: "200 Peachtree St, Atlanta, GA" });
    assert.equal(b1.status, 201, JSON.stringify(b1.data));
    assert.equal(b1.data.estimate.total, q1.total);
    const b2 = await book({ name: "Air Rider", phone: "404-555-0112", tripType: "one-way", dropoff: "100 Main St, Alpharetta, GA", flight: "DL1234", airport: { code: "ATL", side: "pickup", spot: "international", meet: "legacy-west-curb", terminalSource: "flight_lookup" } });
    assert.equal(b2.status, 201, JSON.stringify(b2.data));

    const r1 = await rideFor(worker, fleet.session, "Plain Rider");
    assert.equal(r1.quoteStatus, "auto");
    assert.equal(r1.priceNeeded, false);
    assert.equal(r1.quote.totalCents, cents(q1.total));
    assert.equal(r1.quote.miles, q1.miles);
    assert.equal(r1.quote.minutes, q1.minutes);
    const r2 = await rideFor(worker, fleet.session, "Air Rider");
    assert.equal(r2.airport.code, "ATL");
    assert.equal(r2.airport.spot, "international");
    assert.equal(r2.airport.terminalSource, "flight_lookup");
    assert.equal(r2.airport.gate, "E12");
    assert.equal(r2.airport.flight, "DL1234");
    assert.equal(r2.landing.gate, "E12");
    assert.ok(r2.landing.freeWaitEndsAt - r2.landing.at === 30 * 60000);

    // Rate change later: the saved quote does not move.
    const changed = await call(worker, "/api/rate-sheet", { method: "PUT", session: fleet.session, body: { enabled: true, rateSheet: { vehicles: [SUV], distance: { ...DISTANCE, perMile: "9" } } } });
    assert.equal(changed.status, 200);
    assert.equal((await rideFor(worker, fleet.session, "Plain Rider")).quote.totalCents, cents(q1.total));

    // Approve at the quote: that price is the saved fare (what invoices use).
    const approve = await call(worker, `/api/rides/${r1.id}/approve`, { method: "POST", session: fleet.session, body: { fare: (cents(q1.total) / 100).toFixed(2) } });
    assert.equal(approve.status, 200, JSON.stringify(approve.data));
    assert.equal(approve.data.ride.fareCents, cents(q1.total));
  } finally {
    if (worker) await worker.stop();
    await new Promise((resolve) => flightServer.close(resolve));
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("Google unavailable (daily cap reached): booking goes through as manual, owner sees Price needed", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-distance-cap-"));
  let worker;
  try {
    worker = await startWorker(persistTo, { ROUTES_DAILY_CAP: "0", FLIGHT_PROVIDER: "off" });
    const fleet = await setUpFleet(worker, "cap@example.test");
    const page = await call(worker, "/api/public/book/" + fleet.slug);
    assert.equal(page.data.mapsKey, "", "no browser key: plain address fields");
    assert.equal((await call(worker, "/api/me", { session: fleet.session })).data.maps, null);
    const html = await worker.fetch(`http://127.0.0.1/book/${fleet.slug}/`);
    assert.doesNotMatch(html.headers.get("content-security-policy"), /googleapis/);
    assert.equal(html.headers.get("referrer-policy"), "no-referrer");

    const q = await call(worker, `/api/public/book/${fleet.slug}/quote`, { method: "POST", body: { tripType: "one-way", vehicle: "suv", pickup: "100 Main St, Alpharetta, GA", dropoff: "200 Peachtree St, Atlanta, GA" } });
    assert.equal(q.data.quote.available, false);
    assert.equal(q.data.quote.message, "We'll confirm your price shortly.");
    assert.equal(q.data.quote.total, undefined);

    const booked = await call(worker, "/api/public/book/" + fleet.slug, { method: "POST", body: { name: "Cap Rider", phone: "404-555-0199", date: futureDate(2), time: "09:00", passengers: 1, vehicle: "suv", tripType: "one-way", pickup: "100 Main St, Alpharetta, GA", dropoff: "200 Peachtree St, Atlanta, GA", quote_cents: 100 } });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    assert.equal(booked.data.estimate, null);
    assert.equal(booked.data.priceMessage, "We'll confirm your price shortly.");
    const ride = await rideFor(worker, fleet.session, "Cap Rider");
    assert.equal(ride.quoteStatus, "manual");
    assert.equal(ride.priceNeeded, true);
    assert.equal(ride.quote, null);
    // Flight lookup off: airline table only, never an error.
    const fs = await call(worker, `/api/public/book/${fleet.slug}/flight-status`, { method: "POST", body: { code: "ATL", flight: "UA10" } });
    assert.equal(fs.data.ok, true);
    assert.equal(fs.data.terminal, "domestic-north");
    // The owner's typed price becomes the saved fare.
    const approve = await call(worker, `/api/rides/${ride.id}/approve`, { method: "POST", session: fleet.session, body: { fare: "140" } });
    assert.equal(approve.status, 200, JSON.stringify(approve.data));
    assert.equal(approve.data.ride.fareCents, 14000);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
