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
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || "") };
}

async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo, "--config", "wrangler.toml"],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

function futureDate(days) {
  return new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function completeRide(worker, session, rideId) {
  let from = "";
  for (const step of ["En route", "Arrived", "Picked up", "Completed"]) {
    const moved = await call(worker, `/api/rides/${rideId}/progress`, { method: "POST", session, body: { step, from } });
    assert.equal(moved.status, 200, step + " " + JSON.stringify(moved.data));
    from = step;
  }
}

test("round-trip booking: same-day stays one ride, different-date splits, invoices per ride, trial counts 1", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-rt-legs-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_DATA_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "rtlegs@example.test", companyName: "Round Trip Cars", accountKind: "fleet" } });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
    const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
    const settings = await call(worker, "/api/settings", { session });
    const slug = settings.data.settings.bookingSlug;
    const rates = await call(worker, "/api/rate-sheet", { method: "PUT", session, body: { enabled: true, rateSheet: {
      vehicles: [{ name: "SUV", seats: 6, base: "20", perMile: "3" }],
      flatFares: [{ place: "ATL Airport", placeKeywords: "atl, airport", prices: { SUV: { oneWay: "145" } } }],
      roundTripFactor: 2,
    } } });
    assert.equal(rates.status, 200, JSON.stringify(rates.data));

    const outDate = futureDate(7);
    const backDate = futureDate(10);
    const base = { name: "Pat Rider", phone: "404-555-0201", date: outDate, time: "09:00", tripType: "round-trip", passengers: 2, vehicle: "suv", pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport" };
    const book = (body) => call(worker, "/api/public/book/" + slug, { method: "POST", body });

    const sameDay = await book({ ...base, phone: "404-555-0201", returnDate: outDate, returnTime: "17:00" });
    assert.equal(sameDay.status, 201, JSON.stringify(sameDay.data));
    assert.equal(sameDay.data.estimate.total, "$290");

    const splitBook = await book({ ...base, phone: "404-555-0202", returnDate: backDate, returnTime: "17:00" });
    assert.equal(splitBook.status, 201, JSON.stringify(splitBook.data));
    assert.equal(splitBook.data.estimate.total, "$290");

    const badReturn = await book({ ...base, phone: "404-555-0203", returnDate: futureDate(1), returnTime: "17:00" });
    assert.equal(badReturn.status, 400);
    assert.match(badReturn.data.error || "", /on or after/i);

    const rides = await call(worker, "/api/rides", { session });
    const same = (rides.data.rides || []).filter((r) => r.clientPhone === "404-555-0201");
    const split = (rides.data.rides || []).filter((r) => r.clientPhone === "404-555-0202");
    assert.equal(same.length, 1, "same-day stays one requested ride");
    assert.equal(same[0].isSplitLeg, false);
    assert.equal(same[0].returnDate, outDate);
    assert.equal(same[0].returnTime, "17:00");
    assert.equal(same[0].tripType, "round-trip");
    assert.equal(same[0].quote.totalCents, 29000);

    assert.equal(split.length, 2, "different-date creates two requested rides");
    split.sort((a, b) => a.leg - b.leg);
    assert.equal(split[0].leg, 1);
    assert.equal(split[1].leg, 2);
    assert.equal(split[0].groupId, split[1].groupId);
    assert.ok(split[0].groupId.startsWith("RT-"));
    assert.equal(split[0].pickup, split[1].dropoff);
    assert.equal(split[0].dropoff, split[1].pickup);
    assert.equal(split[0].date, outDate);
    assert.equal(split[1].date, backDate);
    assert.equal(split[0].time, "09:00");
    assert.equal(split[1].time, "17:00");
    assert.equal(split[0].returnDate, "");
    assert.equal(split[1].returnDate, "");
    assert.equal(split[0].quote.totalCents + split[1].quote.totalCents, 29000);
    assert.equal(split[0].status, "requested");
    assert.equal(split[1].status, "requested");

    const approvedOut = await call(worker, `/api/rides/${split[0].id}/approve`, { method: "POST", session, body: { fare: (split[0].quote.totalCents / 100).toFixed(2) } });
    const approvedBack = await call(worker, `/api/rides/${split[1].id}/approve`, { method: "POST", session, body: { fare: (split[1].quote.totalCents / 100).toFixed(2) } });
    assert.equal(approvedOut.status, 200, JSON.stringify(approvedOut.data));
    assert.equal(approvedBack.status, 200, JSON.stringify(approvedBack.data));
    const fareSum = approvedOut.data.ride.fareCents + approvedBack.data.ride.fareCents;
    assert.equal(fareSum, 29000);

    const sameApproved = await call(worker, `/api/rides/${same[0].id}/approve`, { method: "POST", session, body: { fare: "290" } });
    assert.equal(sameApproved.status, 200, JSON.stringify(sameApproved.data));
    assert.equal(sameApproved.data.returnRide, undefined);
    assert.equal(sameApproved.data.ride.fareCents, 29000);
    assert.equal(sameApproved.data.ride.returnDate, outDate);

    await completeRide(worker, session, split[0].id);
    await completeRide(worker, session, split[1].id);
    const trialAfterPair = await call(worker, "/api/trial", { session });
    assert.equal(trialAfterPair.data.trial.ridesUsed, 1, "both completed legs of one booking count as 1 toward the 15-ride trial");

    await call(worker, "/api/settings", { method: "PUT", session, body: { businessName: "Round Trip Cars", prefix: "RT-" } });
    const inv1 = await call(worker, `/api/rides/${split[0].id}/invoice`, { method: "POST", session, body: {} });
    const inv2 = await call(worker, `/api/rides/${split[1].id}/invoice`, { method: "POST", session, body: {} });
    assert.equal(inv1.status, 200, JSON.stringify(inv1.data));
    assert.equal(inv2.status, 200, JSON.stringify(inv2.data));
    assert.notEqual(inv1.data.invoice.id, inv2.data.invoice.id);
    assert.equal(inv1.data.invoice.rideId, split[0].id);
    assert.equal(inv2.data.invoice.rideId, split[1].id);
    assert.equal(inv1.data.invoice.trip.leg, 1);
    assert.equal(inv2.data.invoice.trip.leg, 2);
    assert.match(inv1.data.invoice.snapshotText, /Round trip leg 1 of 2/);
    assert.match(inv2.data.invoice.snapshotText, /Round trip leg 2 of 2/);
    assert.equal(inv1.data.invoice.amountCents ?? inv1.data.invoice.trip.fareCents, approvedOut.data.ride.fareCents);
    assert.equal(inv2.data.invoice.amountCents ?? inv2.data.invoice.trip.fareCents, approvedBack.data.ride.fareCents);

    // Owner New ride: different-date round trip also splits the typed fare.
    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0299", email: "avery@example.test" } });
    const created = await call(worker, "/api/rides", { method: "POST", session, body: {
      clientId: client.data.client.id, date: futureDate(14), time: "08:00", pickup: "Hotel", dropoff: "Airport",
      passengers: 1, fare: "200.00", tripType: "round-trip", returnDate: futureDate(16), returnTime: "18:30"
    } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.ok(created.data.returnRide);
    assert.equal(created.data.ride.leg, 1);
    assert.equal(created.data.returnRide.leg, 2);
    assert.equal(created.data.ride.pickup, "Hotel");
    assert.equal(created.data.returnRide.pickup, "Airport");
    assert.equal(created.data.ride.fareCents + created.data.returnRide.fareCents, 20000);
    assert.equal(created.data.ride.groupId, created.data.returnRide.groupId);

    // Declining one requested split leg declines the other still-requested sibling.
    const toDecline = await book({ ...base, phone: "404-555-0204", returnDate: backDate, returnTime: "16:00" });
    assert.equal(toDecline.status, 201);
    const pending = (await call(worker, "/api/rides", { session })).data.rides.filter((r) => r.clientPhone === "404-555-0204");
    assert.equal(pending.length, 2);
    const declined = await call(worker, `/api/rides/${pending[0].id}/decline`, { method: "POST", session, body: {} });
    assert.equal(declined.status, 200, JSON.stringify(declined.data));
    const after = (await call(worker, "/api/rides", { session })).data.rides.filter((r) => r.clientPhone === "404-555-0204");
    assert.equal(after.every((r) => r.status === "declined"), true);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
