import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { arrivedMessage } from "../app/sms.js";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;
const TEST_PHONE = "+14045550199";

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
      { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

async function d1Execute(persistTo, sql, { json = false } = {}) {
  const file = join(persistTo, "cmd-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".sql");
  await writeFile(file, sql);
  const args = ["wrangler", "d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--file", file];
  if (json) args.push("--json");
  const out = [];
  await new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: ROOT, env: { ...process.env, CI: "1" } });
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => out.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("d1 execute exited " + code + ": " + Buffer.concat(out).toString()))));
  });
  const text = Buffer.concat(out).toString();
  if (!json) return text;
  const start = text.indexOf("[");
  return start >= 0 ? JSON.parse(text.slice(start)) : [];
}

async function companyIdByName(persistTo, name) {
  const rows = await d1Execute(persistTo, `SELECT id FROM companies WHERE name = '${String(name).replace(/'/g, "''")}'`, { json: true });
  const id = rows?.[0]?.results?.[0]?.id;
  assert.ok(id, "company id for " + name);
  return id;
}

async function openOwner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", {
    method: "POST",
    admin: true,
    body: { email, companyName, accountKind: "fleet" },
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
  return { session, slug: settings.data.settings.bookingSlug, companyName, persistTo: null };
}

async function startFakeBland({ fail = false } = {}) {
  const received = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
      received.push({
        url: req.url,
        method: req.method,
        idempotency: req.headers["idempotency-key"],
        body: parsed,
      });
      if (fail) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: ["mock bland failure"] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { message_id: "msg_" + received.length } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    received,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function startWorker(persistTo, vars) {
  return unstable_dev("app/index.js", {
    config: "wrangler.toml",
    local: true,
    persist: true,
    persistTo,
    logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", ...vars },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
}

async function addDriverAndRide(worker, fleet, { phone = TEST_PHONE, flight = "DAL1234" } = {}) {
  const created = await call(worker, "/api/drivers", {
    method: "POST",
    session: fleet.session,
    body: { name: "Riley Cole", vehicle: "SUV", plate: "ATL1042" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const driver = created.data.driver;
  const client = await call(worker, "/api/clients", {
    method: "POST",
    session: fleet.session,
    body: { name: "Avery Cole", phone },
  });
  assert.equal(client.status, 201, JSON.stringify(client.data));
  const ride = await call(worker, "/api/rides", {
    method: "POST",
    session: fleet.session,
    body: {
      clientId: client.data.client.id,
      date: "2026-11-18",
      time: "09:30",
      pickup: "Northside Sample Hotel, Midtown",
      dropoff: "ATL Airport",
      passengers: 1,
      fare: "145",
      flight,
    },
  });
  assert.equal(ride.status, 201, JSON.stringify(ride.data));
  const assigned = await call(worker, "/api/rides/" + ride.data.ride.id, {
    method: "PATCH",
    session: fleet.session,
    body: { driverUserId: driver.id },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  return { driver, ride: assigned.data.ride };
}

async function enablePayingSms(persistTo, companyId) {
  const id = String(companyId).replace(/'/g, "''");
  await d1Execute(
    persistTo,
    `UPDATE companies SET billing_plan = 'fleet', sms_addon_enabled = 1, stripe_subscription_id = 'sub_test_local', billing_status = 'active' WHERE id = '${id}'`,
  );
}

async function stepRide(worker, session, rideId, step, from, undo = false) {
  return call(worker, "/api/rides/" + rideId + "/progress", {
    method: "POST",
    session,
    body: undo ? { step, from, undo: true } : { step, from },
  });
}

test("Arrived sits between En route and Picked up, undo works, and old picked-up rides stay valid", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-arrived-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await startWorker(persistTo, { SMS_MODE: "off" });
    const fleet = await openOwner(worker, "owner-arrived@example.test", "Arrived Fleet");
    const { ride } = await addDriverAndRide(worker, fleet, { flight: "" });
    const companyId = await companyIdByName(persistTo, fleet.companyName);
    const id = ride.id;

    assert.equal(ride.schedule.progress, "");
    assert.equal(ride.schedule.now, "Not started");
    assert.equal(ride.schedule.nextStep, "En route");
    assert.equal(ride.schedule.nextLabel, "On my way");
    assert.equal(ride.schedule.nav.label, "Navigate to pickup");
    assert.match(ride.schedule.nav.url, /Northside%20Sample%20Hotel/);
    assert.equal(ride.schedule.arrivedAt, null);
    assert.equal(ride.schedule.waitingMinutes, null);

    const skip = await stepRide(worker, fleet.session, id, "Arrived", "");
    assert.equal(skip.status, 409, JSON.stringify(skip.data));

    const enRoute = await stepRide(worker, fleet.session, id, "En route", "");
    assert.equal(enRoute.status, 200, JSON.stringify(enRoute.data));
    const afterEnRoute = enRoute.data.ride.schedule;
    assert.equal(afterEnRoute.progress, "En route");
    assert.equal(afterEnRoute.now, "On the way to pickup");
    assert.equal(afterEnRoute.nextStep, "Arrived");
    assert.equal(afterEnRoute.nextLabel, "Arrived");
    assert.equal(afterEnRoute.nav.label, "Navigate to pickup");
    assert.equal(afterEnRoute.undoStep, "");

    const jumped = await stepRide(worker, fleet.session, id, "Picked up", "En route");
    assert.equal(jumped.status, 409, JSON.stringify(jumped.data));

    const arrived = await stepRide(worker, fleet.session, id, "Arrived", "En route");
    assert.equal(arrived.status, 200, JSON.stringify(arrived.data));
    const afterArrived = arrived.data.ride.schedule;
    assert.equal(afterArrived.progress, "Arrived");
    assert.equal(afterArrived.now, "Driver arrived");
    assert.equal(afterArrived.nextStep, "Picked up");
    assert.equal(afterArrived.nextLabel, "Picked up");
    assert.equal(afterArrived.nav.label, "Navigate to pickup");
    assert.ok(afterArrived.arrivedAt);
    assert.equal(afterArrived.arrivedLabel, afterArrived.arrivedLabel);
    assert.equal(afterArrived.undoStep, "En route");

    const listed = await call(worker, "/api/rides", { session: fleet.session });
    const card = listed.data.rides.find((row) => row.id === id);
    assert.equal(card.schedule.now, "Driver arrived");

    const picked = await stepRide(worker, fleet.session, id, "Picked up", "Arrived");
    assert.equal(picked.status, 200, JSON.stringify(picked.data));
    const afterPicked = picked.data.ride.schedule;
    assert.equal(afterPicked.progress, "Picked up");
    assert.equal(afterPicked.now, "Rider on board");
    assert.equal(afterPicked.nextStep, "Completed");
    assert.equal(afterPicked.nextLabel, "Dropped off · complete ride");
    assert.equal(afterPicked.nav.label, "Navigate to drop-off");
    assert.match(afterPicked.nav.url, /ATL%20Airport/);
    assert.equal(afterPicked.waitingMinutes, 0);

    const undone = await stepRide(worker, fleet.session, id, "Arrived", "Picked up", true);
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    assert.equal(undone.data.ride.schedule.progress, "Arrived");
    assert.equal(undone.data.ride.schedule.pickedUpAt, null);
    assert.ok(undone.data.ride.schedule.arrivedAt);
    assert.equal(undone.data.ride.schedule.waitingMinutes, null);
    assert.equal(undone.data.ride.schedule.nav.label, "Navigate to pickup");

    const backToEnRoute = await stepRide(worker, fleet.session, id, "En route", "Arrived", true);
    assert.equal(backToEnRoute.status, 200, JSON.stringify(backToEnRoute.data));
    assert.equal(backToEnRoute.data.ride.schedule.progress, "En route");
    assert.equal(backToEnRoute.data.ride.schedule.arrivedAt, null);

    const oldId = crypto.randomUUID();
    const clientId = (await call(worker, "/api/rides/" + id, { session: fleet.session })).data.ride.clientId;
    const now = Date.now();
    await d1Execute(
      persistTo,
      `INSERT INTO rides (id, company_id, client_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at, progress, en_route_at, picked_up_at, approval)
       VALUES ('${oldId}', '${companyId}', '${clientId}', '2026-11-10', '08:00', 'Hotel', 'Airport', 1, '', 4000, '', 'scheduled', 'unpaid', ${now}, ${now}, 'Picked up', ${now - 120000}, ${now - 60000}, 'none')`,
    );
    const oldRide = await call(worker, "/api/rides/" + oldId, { session: fleet.session });
    assert.equal(oldRide.status, 200, JSON.stringify(oldRide.data));
    assert.equal(oldRide.data.ride.schedule.progress, "Picked up");
    assert.equal(oldRide.data.ride.schedule.arrivedAt, null);
    assert.equal(oldRide.data.ride.schedule.waitingMinutes, null);
    assert.equal(oldRide.data.ride.schedule.toPickupMinutes, 1);
    assert.equal(oldRide.data.ride.schedule.nav.label, "Navigate to drop-off");
    assert.equal(oldRide.data.ride.schedule.undoStep, "Arrived");
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("Arrived texts the passenger once through Bland; gates off skip send; failure does not block the step", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-arrived-sms-"));
  const bland = await startFakeBland();
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await startWorker(persistTo, {
      SMS_MODE: "test",
      BLAND_API_KEY: "test-bland-key",
      BLAND_FROM_NUMBER: "+14045550100",
      BLAND_API_BASE: bland.url,
      SMS_TEST_ALLOWLIST: TEST_PHONE,
    });
    const fleet = await openOwner(worker, "owner-sms@example.test", "Texting Fleet");
    const { ride } = await addDriverAndRide(worker, fleet);
    const id = ride.id;
    const companyId = await companyIdByName(persistTo, fleet.companyName);
    const airportJson = JSON.stringify({
      code: "ATL",
      name: "ATL Airport",
      side: "pickup",
      spot: "domestic-north",
      spotLabel: "Domestic Terminal North",
      meet: { id: "legacy-west-curb", label: "Legacy West Curb (W1 and W2)", detail: "Black SUV pickups at ATL are at the Legacy West Curb, zones W1 and W2." },
    }).replace(/'/g, "''");
    await d1Execute(persistTo, `UPDATE rides SET airport_json = '${airportJson}' WHERE id = '${id}'`);

    const enRouteOff = await stepRide(worker, fleet.session, id, "En route", "");
    assert.equal(enRouteOff.status, 200, JSON.stringify(enRouteOff.data));
    const arrivedOff = await stepRide(worker, fleet.session, id, "Arrived", "En route");
    assert.equal(arrivedOff.status, 200, JSON.stringify(arrivedOff.data));
    assert.equal(arrivedOff.data.ride.schedule.progress, "Arrived");
    assert.equal(bland.received.length, 0, "add-on off should not call Bland");

    await stepRide(worker, fleet.session, id, "En route", "Arrived", true);

    await enablePayingSms(persistTo, companyId);

    const arrivedOn = await stepRide(worker, fleet.session, id, "Arrived", "En route");
    assert.equal(arrivedOn.status, 200, JSON.stringify(arrivedOn.data));
    assert.equal(arrivedOn.data.ride.schedule.progress, "Arrived");
    assert.equal(bland.received.length, 1, JSON.stringify(bland.received));
    const sent = bland.received[0];
    assert.equal(sent.url, "/v1/sms/send");
    assert.equal(sent.idempotency, "nudge-" + id + "-arrived");
    assert.equal(sent.body.user_number, TEST_PHONE);
    const expected = arrivedMessage({
      companyName: "Texting Fleet",
      driverName: "Riley Cole",
      vehicle: "SUV",
      plate: "ATL1042",
      meetingPoint: "Legacy West Curb (W1 and W2)",
    });
    assert.equal(sent.body.agent_message, expected);

    await stepRide(worker, fleet.session, id, "En route", "Arrived", true);
    const arrivedAgain = await stepRide(worker, fleet.session, id, "Arrived", "En route");
    assert.equal(arrivedAgain.status, 200, JSON.stringify(arrivedAgain.data));
    assert.equal(bland.received.length, 1, "undo/redo must not resend a successful arrived text");
  } finally {
    if (worker) await worker.stop();
    await bland.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("a Bland failure leaves the Arrived step in place and does not throw it away", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-arrived-fail-"));
  const bland = await startFakeBland({ fail: true });
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await startWorker(persistTo, {
      SMS_MODE: "test",
      BLAND_API_KEY: "test-bland-key",
      BLAND_FROM_NUMBER: "+14045550100",
      BLAND_API_BASE: bland.url,
      SMS_TEST_ALLOWLIST: TEST_PHONE,
    });
    const fleet = await openOwner(worker, "owner-fail@example.test", "Failing Fleet");
    const { ride } = await addDriverAndRide(worker, fleet);
    const companyId = await companyIdByName(persistTo, fleet.companyName);
    await enablePayingSms(persistTo, companyId);
    const enRoute = await stepRide(worker, fleet.session, ride.id, "En route", "");
    assert.equal(enRoute.status, 200, JSON.stringify(enRoute.data));
    const arrived = await stepRide(worker, fleet.session, ride.id, "Arrived", "En route");
    assert.equal(arrived.status, 200, JSON.stringify(arrived.data));
    assert.equal(arrived.data.ride.schedule.progress, "Arrived");
    assert.ok(arrived.data.ride.schedule.arrivedAt);
    assert.equal(bland.received.length, 1);
  } finally {
    if (worker) await worker.stop();
    await bland.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
