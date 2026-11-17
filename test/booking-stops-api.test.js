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

async function call(worker, path, { method = "GET", body, session, admin = false, raw = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (raw) return { status: response.status, text };
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || "") };
}

async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

function futureDate(days) {
  return new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

test("multi-stop booking: price on request, stored stops, owner views, CSV, invoice", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-stops-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_DATA_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "stops@example.test", companyName: "Stops Cars", accountKind: "fleet" } });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
    const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
    const settings = await call(worker, "/api/settings", { session });
    const slug = settings.data.settings.bookingSlug;
    const rates = await call(worker, "/api/rate-sheet", { method: "PUT", session, body: { enabled: true, rateSheet: {
      vehicles: [{ name: "SUV", seats: 6, base: "20", perMile: "3", hourlyRate: "90", minHours: 2 }],
      flatFares: [{ place: "ATL Airport", placeKeywords: "atl, airport", prices: { SUV: { oneWay: "145" } } }],
    } } });
    assert.equal(rates.status, 200, JSON.stringify(rates.data));
    const quotePath = `/api/public/book/${slug}/quote`;

    // No stops: unchanged instant estimate.
    const plain = await call(worker, quotePath, { method: "POST", body: { tripType: "one-way", passengers: 2, pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport" } });
    assert.equal(plain.status, 200, JSON.stringify(plain.data));
    assert.equal(plain.data.quote.available, true);
    assert.equal(plain.data.quote.total, "$145");
    const emptyStops = await call(worker, quotePath, { method: "POST", body: { tripType: "one-way", passengers: 2, pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport", stops: ["", "  "] } });
    assert.equal(emptyStops.data.quote.total, "$145", "blank stop rows do not count");

    // With a stop: never an instant estimate.
    const withStop = await call(worker, quotePath, { method: "POST", body: { tripType: "one-way", passengers: 2, pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport", stops: ["Lenox Square"] } });
    assert.equal(withStop.status, 200);
    assert.equal(withStop.data.quote.available, false);
    assert.match(withStop.data.quote.message, /confirm your fare/);
    assert.equal(withStop.data.quote.total, undefined);
    const sixQuote = await call(worker, quotePath, { method: "POST", body: { pickup: "A street", dropoff: "B street", stops: ["1", "2", "3", "4", "5", "6"] } });
    assert.equal(sixQuote.status, 400);

    const base = { name: "Pat Rider", phone: "404-555-0123", date: futureDate(7), time: "15:30", tripType: "one-way", passengers: 2, vehicle: "suv", pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport" };
    const book = (body) => call(worker, "/api/public/book/" + slug, { method: "POST", body });

    // Validation: count, length, type. Nothing stored.
    assert.equal((await book({ ...base, stops: ["1", "2", "3", "4", "5", "6"] })).status, 400);
    const long = await book({ ...base, stops: ["x".repeat(201)] });
    assert.equal(long.status, 400);
    assert.match(long.data.error, /200 characters/);
    assert.equal((await book({ ...base, stops: "Lenox Square" })).status, 400);
    assert.equal((await book({ ...base, stops: [{ nested: true }] })).status, 201, "an object without an address is skipped");

    // A no-stop booking keeps its stored estimate.
    const plainBooked = await book({ ...base, phone: "404-555-0124" });
    assert.equal(plainBooked.status, 201, JSON.stringify(plainBooked.data));
    assert.equal(plainBooked.data.estimate.total, "$145");
    assert.deepEqual(plainBooked.data.trip.stops, []);

    // Multi-stop booking: stops saved in order, no estimate stored, even if the body claims a price.
    const tricky = "<img src=x onerror=alert(1)> & \"Co\"";
    const booked = await book({ ...base, phone: "404-555-0125", stops: [" Lenox Square ", "", tricky, "=HYPERLINK(\"http://x\")"], quote: { totalCents: 100 }, quote_cents: 100 });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    assert.equal(booked.data.estimate, null);
    assert.deepEqual(booked.data.trip.stops, ["Lenox Square", tricky, "=HYPERLINK(\"http://x\")"]);

    const rides = await call(worker, "/api/rides", { session });
    const plainRide = rides.data.rides.find((r) => r.clientPhone === "404-555-0124");
    const stopRide = rides.data.rides.find((r) => r.clientPhone === "404-555-0125");
    assert.deepEqual(plainRide.stops, []);
    assert.equal(plainRide.quote && plainRide.quote.totalCents, 14500);
    assert.equal(stopRide.status, "requested");
    assert.equal(stopRide.quote, null, "no auto quote stored for a multi-stop request");
    assert.deepEqual(stopRide.stops, ["Lenox Square", tricky, "=HYPERLINK(\"http://x\")"]);

    // Approve with a typed price, then edit stops (add, remove) as the owner.
    const approved = await call(worker, `/api/rides/${stopRide.id}/approve`, { method: "POST", session, body: { fare: "210" } });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.deepEqual(approved.data.ride.stops, stopRide.stops);
    const edited = await call(worker, `/api/rides/${stopRide.id}`, { method: "PATCH", session, body: { stops: ["Lenox Square", "Phipps Plaza"] } });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.deepEqual(edited.data.ride.stops, ["Lenox Square", "Phipps Plaza"]);
    const payOnly = await call(worker, `/api/rides/${stopRide.id}`, { method: "PATCH", session, body: { payment: "unpaid" } });
    assert.deepEqual(payOnly.data.ride.stops, ["Lenox Square", "Phipps Plaza"], "a payment-only edit keeps stops");
    const tooMany = await call(worker, `/api/rides/${stopRide.id}`, { method: "PATCH", session, body: { stops: ["1", "2", "3", "4", "5", "6"] } });
    assert.equal(tooMany.status, 400);

    // Owner-created ride with stops; then clear them.
    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199", email: "avery@example.test" } });
    const created = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: futureDate(3), time: "09:30", pickup: "Hotel", dropoff: "Airport", passengers: 1, fare: "125", stops: ["Office", "Gym"] } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.deepEqual(created.data.ride.stops, ["Office", "Gym"]);
    const rideId = created.data.ride.id;
    const badCreate = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: futureDate(3), time: "09:30", pickup: "Hotel", dropoff: "Airport", passengers: 1, fare: "125", stops: ["y".repeat(201)] } });
    assert.equal(badCreate.status, 400);
    const noStops = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: futureDate(4), time: "09:30", pickup: "Hotel", dropoff: "Airport", passengers: 1, fare: "99" } });
    assert.deepEqual(noStops.data.ride.stops, []);
    assert.equal(noStops.data.ride.schedule.nav.url, "https://www.google.com/maps/dir/?api=1&destination=Hotel");

    // Driver navigation after pickup goes via the stops.
    let from = "";
    for (const step of ["En route", "Arrived", "Picked up"]) {
      const moved = await call(worker, `/api/rides/${rideId}/progress`, { method: "POST", session, body: { step, from } });
      assert.equal(moved.status, 200, step + " " + JSON.stringify(moved.data));
      from = step;
    }
    const picked = await call(worker, `/api/rides/${rideId}`, { session });
    assert.equal(picked.data.ride.schedule.nav.label, "Navigate to drop-off via 2 stops");
    assert.equal(picked.data.ride.schedule.nav.url, "https://www.google.com/maps/dir/?api=1&destination=Airport&waypoints=" + encodeURIComponent("Office|Gym"));
    await call(worker, `/api/rides/${rideId}/progress`, { method: "POST", session, body: { step: "Completed", from } });

    // Invoice: stops in the trip table data and the text.
    await call(worker, "/api/settings", { method: "PUT", session, body: { businessName: "Stops Cars", prefix: "SC-" } });
    const inv = await call(worker, `/api/rides/${rideId}/invoice`, { method: "POST", session, body: {} });
    assert.equal(inv.status, 200, JSON.stringify(inv.data));
    assert.deepEqual(inv.data.invoice.trip.stops, ["Office", "Gym"]);
    assert.match(inv.data.invoice.snapshotText, /Pickup: Hotel\nStop 1: Office\nStop 2: Gym\nDrop-off: Airport/);

    // CSV: a Stops column at the end; formula-looking stops are neutralized.
    const csv = await call(worker, "/api/export/rides.csv", { session, raw: true });
    assert.equal(csv.status, 200);
    const [header, ...lines] = csv.text.trim().split("\r\n");
    assert.match(header, /,Source,Stops$/);
    assert.ok(lines.some((l) => l.endsWith(",1) Office | 2) Gym")), csv.text);
    assert.ok(lines.some((l) => l.includes("Hotel,Airport") && l.endsWith(",")), "no-stop rides get an empty Stops cell");
    // Clear stops on the stop request; the owner app escapes values (served as JSON text only).
    const cleared = await call(worker, `/api/rides/${stopRide.id}`, { method: "PATCH", session, body: { stops: [] } });
    assert.deepEqual(cleared.data.ride.stops, []);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
