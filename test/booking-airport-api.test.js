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
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "inherit" },
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
    body: { token: invite.data.inviteToken, password: "sample-owner-pass" },
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const session = sessionOf(accepted);
  const settings = await call(worker, "/api/settings", { session });
  assert.equal(settings.status, 200, JSON.stringify(settings.data));
  return { session, slug: settings.data.settings.bookingSlug, companyName };
}


function easternNowPlus(minutes) {
  const at = new Date(Date.now() + minutes * 60000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}`, ms: at.getTime() - (at.getTime() % 60000) };
}

test("airport booking: terminals, Legacy West Curb, topside, SUV-only fleet, flight alerts", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-airport-"));
  const pickupAt = easternNowPlus(60);
  let flightCalls = 0;
  const flightServer = createServer((req, res) => {
    flightCalls++;
    assert.equal(req.headers["x-apikey"], "test-flight-key");
    const sched = new Date(pickupAt.ms).toISOString();
    const est = new Date(pickupAt.ms - 20 * 60000).toISOString();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ flights: [{ ident: "DAL1234", scheduled_in: sched, estimated_in: est, terminal_destination: "S", actual_off: sched }] }));
  });
  await new Promise((resolve) => flightServer.listen(0, "127.0.0.1", resolve));
  const flightPort = flightServer.address().port;
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml",
      local: true,
      persist: true,
      persistTo,
      logLevel: "error",
      testScheduled: true,
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "aeroapi", FLIGHT_DATA_API_KEY: "test-flight-key", FLIGHT_DATA_API_BASE: `http://127.0.0.1:${flightPort}` },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const fleet = await openOwner(worker, "air-owner@example.test", "Airport Fleet", "fleet");
    const slug = fleet.slug;

    // Plain booking page until the owner turns on airports.
    let page = await call(worker, "/api/public/book/" + slug);
    assert.equal(page.status, 200);
    assert.deepEqual(page.data.airports, []);
    assert.equal(page.data.capacities.sedan, 3);

    const rates = await call(worker, "/api/rate-sheet", { method: "PUT", session: fleet.session, body: { enabled: true, rateSheet: {
      vehicles: [{ name: "Sedan", seats: 4, hourlyRate: "70", minHours: 2 }, { name: "SUV", seats: 6, hourlyRate: "90", minHours: 3 }],
      flatFares: [{ place: "ATL Airport", placeKeywords: "atl, airport", prices: { Sedan: { oneWay: "95" }, SUV: { oneWay: "145" } } }],
    } } });
    assert.equal(rates.status, 200, JSON.stringify(rates.data));
    const driver = await call(worker, "/api/drivers", { method: "POST", session: fleet.session, body: { name: "Dee Driver", vehicle: "Black Chevy Suburban" } });
    assert.equal(driver.status, 201, JSON.stringify(driver.data));
    const bad = await call(worker, "/api/booking-settings", { method: "PUT", session: fleet.session, body: { flightRules: { earlyMinutes: 5 } } });
    assert.equal(bad.status, 400);
    const set = await call(worker, "/api/booking-settings", { method: "PUT", session: fleet.session, body: { preset: ["ATL"] } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    const settings = await call(worker, "/api/booking-settings", { session: fleet.session });
    assert.deepEqual(settings.data.fleetClasses, ["suv"]);

    page = await call(worker, "/api/public/book/" + slug);
    assert.equal(page.data.airports[0].code, "ATL");
    assert.deepEqual(page.data.airports[0].spots.map((s) => s.label), ["Domestic Terminal North", "Domestic Terminal South (Delta)", "International Terminal"]);
    // SUV-only roster: the sedan on the rate sheet is not offered.
    assert.deepEqual(page.data.quotes.vehicles.map((v) => v.name), ["SUV"]);
    const suvId = page.data.quotes.vehicles[0].id;

    const quote = await call(worker, `/api/public/book/${slug}/quote`, { method: "POST", body: { tripType: "one-way", passengers: 2, dropoff: "100 Main St, Alpharetta", airport: { code: "ATL", side: "pickup", spot: "domestic-south" } } });
    assert.equal(quote.status, 200, JSON.stringify(quote.data));
    assert.equal(quote.data.pickup, "ATL Airport - Domestic Terminal South (Delta)");
    assert.equal(quote.data.dropoff, "100 Main St, Alpharetta");
    assert.equal(quote.data.quote.total, "$145");

    const base = { name: "Pat Rider", phone: "404-555-0123", date: pickupAt.date, time: pickupAt.time, tripType: "one-way", passengers: 2, luggage: 3, flight: "DL1234" };
    const sedanId = "sedan";
    const noSedan = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { ...base, vehicle: sedanId, dropoff: "1 Main St", airport: { side: "pickup", spot: "international" } } });
    assert.equal(noSedan.status, 400);
    const noTerminal = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { ...base, vehicle: suvId, dropoff: "1 Main St", airport: { side: "pickup" } } });
    assert.equal(noTerminal.status, 400);
    assert.match(noTerminal.data.error, /terminal/);
    const tooMany = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { ...base, passengers: 7, vehicle: suvId, dropoff: "1 Main St", airport: { side: "pickup", spot: "international" } } });
    assert.equal(tooMany.status, 400);

    const booked = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { ...base, vehicle: suvId, pickup: "ATL Airport", dropoff: "100 Main St, Alpharetta", airport: { code: "ATL", side: "pickup", spot: "domestic-south" } } });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    assert.equal(booked.data.trip.pickup, "ATL Airport - Domestic Terminal South (Delta)");
    assert.equal(booked.data.trip.dropoff, "100 Main St, Alpharetta");
    assert.match(booked.data.trip.meeting, /Legacy West Curb \(W1 and W2\)/);

    const dropBooked = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { ...base, phone: "404-555-0124", vehicle: suvId, pickup: "100 Main St, Alpharetta", airport: { side: "dropoff", spot: "domestic-south", style: "curbside" } } });
    assert.equal(dropBooked.status, 201, JSON.stringify(dropBooked.data));
    assert.equal(dropBooked.data.trip.dropoff, "ATL Airport - Domestic Terminal South (Delta)");
    assert.match(dropBooked.data.trip.meeting, /^Drop-off: Curbside/);

    // Flight cron: one early-arrival alert, shown on the ride. A second run does not repeat it.
    const cron = await worker.fetch("http://127.0.0.1/__scheduled?cron=*/5+*+*+*+*");
    assert.equal(cron.status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(flightCalls >= 1, "flight provider was called");
    const rides = await call(worker, "/api/rides", { session: fleet.session });
    const pickupRide = rides.data.rides.find((r) => r.airport && r.airport.side === "pickup");
    assert.equal(pickupRide.airport.meet.id, "legacy-west-curb");
    assert.equal(pickupRide.luggage, 3);
    assert.match(pickupRide.airportLine, /Meet at Legacy West Curb/);
    assert.equal(pickupRide.flightAlert && pickupRide.flightAlert.kind, "early");
    assert.match(pickupRide.flightAlert.message, /20 min ahead/);
    const dropRide = rides.data.rides.find((r) => r.airport && r.airport.side === "dropoff");
    assert.equal(dropRide.airport.style.id, "curbside");
    assert.equal(dropRide.flightAlert, null);
  } finally {
    if (worker) await worker.stop();
    await new Promise((resolve) => flightServer.close(resolve));
    await rm(persistTo, { recursive: true, force: true });
  }
});
