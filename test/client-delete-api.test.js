// Owner "Delete client" (Nov 20, 2026): hard delete with no history, archive + restore with history,
// schedule pause, drivers refused, cross-company isolation, and the pre-0018 (no archived_at) path.
// Local wrangler dev + local D1 only. Synthetic data.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;

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
const sessionOf = (r) => ({ cookie: r.cookie, csrf: r.data.csrf || "" });
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("wrangler " + args[0] + " exited " + code))));
  });
}
const applyMigrations = (persistTo) => run(["d1", "migrations", "apply", "nudge-app-local", "--local", "-c", "wrangler.toml", "--persist-to", persistTo]);
async function openOwner(worker, email, companyName, accountKind = "fleet") {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const session = sessionOf(accepted);
  const settings = await call(worker, "/api/settings", { session });
  return { session, slug: settings.data.settings.bookingSlug };
}
async function boot(persistTo) {
  return unstable_dev("app/index.js", {
    config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_DATA_PROVIDER: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
}
function etDay(offset) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
}
const newClient = async (worker, session, name) => {
  const r = await call(worker, "/api/clients", { method: "POST", session, body: { name, phone: "404-555-0100" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.client.id;
};

test("delete client: hard delete, archive, restore, schedule pause, roles, cross-company", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-client-delete-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await boot(persistTo);
    const A = await openOwner(worker, "owner-a@example.test", "Fleet A");
    const B = await openOwner(worker, "owner-b@example.test", "Fleet B");

    // ---- hard delete: no rides, invoices or schedules ----
    const empty = await newClient(worker, A.session, "Test Nobody");
    let got = await call(worker, "/api/clients/" + empty, { session: A.session });
    assert.equal(got.data.history.hardDelete, true);
    assert.equal(got.data.client.archived, false);
    let del = await call(worker, "/api/clients/" + empty, { method: "DELETE", session: A.session });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.equal(del.data.deleted, true);
    assert.equal((await call(worker, "/api/clients/" + empty, { session: A.session })).status, 404);

    // ---- archive: client with a past ride, an upcoming ride and an active schedule ----
    const rita = await newClient(worker, A.session, "Rita Regular");
    for (const date of [etDay(-3), etDay(5)]) {
      const ride = await call(worker, "/api/rides", { method: "POST", session: A.session, body: { clientId: rita, date, time: "09:30", pickup: "Hotel", dropoff: "Airport", passengers: 1, fare: "40" } });
      assert.equal(ride.status, 201, JSON.stringify(ride.data));
    }
    const sched = await call(worker, "/api/schedules", { method: "POST", session: A.session, body: { clientId: rita, time: "05:30", pickup: "100 Main St", dropoff: "ATL Airport", startDate: etDay(0), weekDays: [1, 3] } });
    assert.equal(sched.status, 201, JSON.stringify(sched.data));
    const sid = sched.data.schedule.id;
    got = await call(worker, "/api/clients/" + rita, { session: A.session });
    assert.deepEqual({ ...got.data.history }, { rides: 2, upcomingRides: 1, invoices: 0, schedules: 1, activeSchedules: 1, hardDelete: false });

    // ---- company B cannot see, delete or restore company A's client ----
    assert.equal((await call(worker, "/api/clients/" + rita, { session: B.session })).status, 404);
    assert.equal((await call(worker, "/api/clients/" + rita, { method: "DELETE", session: B.session })).status, 404);
    assert.equal((await call(worker, "/api/clients/" + rita + "/restore", { method: "POST", session: B.session, body: {} })).status, 404);
    assert.equal((await call(worker, "/api/clients/" + rita, { session: A.session })).data.client.archived, false);

    // ---- signed out / no CSRF refused ----
    assert.equal((await call(worker, "/api/clients/" + rita, { method: "DELETE" })).status, 401);
    assert.equal((await call(worker, "/api/clients/" + rita, { method: "DELETE", session: { cookie: A.session.cookie } })).status, 403);

    // ---- a driver of company A is refused ----
    const drv = await call(worker, "/api/drivers", { method: "POST", session: A.session, body: { name: "Sam Lee" } });
    assert.equal(drv.status, 201, JSON.stringify(drv.data));
    assert.equal((await call(worker, "/api/drivers/" + drv.data.driver.id + "/passcode", { method: "PUT", session: A.session, body: { passcode: "lake48" } })).status, 200);
    const signedIn = await call(worker, "/api/driver-login", { method: "POST", body: { company: A.slug, name: "Sam Lee", passcode: "lake48" } });
    assert.equal(signedIn.data.role, "driver");
    const driver = sessionOf(signedIn);
    const spare = await newClient(worker, A.session, "Spare Empty");
    for (const [p, m] of [["/api/clients/" + spare, "DELETE"], ["/api/clients/" + rita, "DELETE"], ["/api/clients/" + rita + "/restore", "POST"]]) {
      const r = await call(worker, p, { method: m, session: driver, body: m === "POST" ? {} : undefined });
      assert.equal(r.status, 403, p + " " + JSON.stringify(r.data));
    }
    assert.equal((await call(worker, "/api/clients/" + spare, { session: A.session })).status, 200, "driver attempt changed nothing");

    // ---- archive ----
    del = await call(worker, "/api/clients/" + rita, { method: "DELETE", session: A.session });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.equal(del.data.archived, true);
    assert.equal(del.data.pausedSchedules, 1);
    const sAfter = await call(worker, "/api/schedules/" + sid, { session: A.session });
    assert.equal(sAfter.data.schedule.active, false);
    const rides = (await call(worker, "/api/rides", { session: A.session })).data.rides.filter((r) => r.clientId === rita);
    assert.equal(rides.length, 2, "rides kept");
    let list = await call(worker, "/api/clients", { session: A.session });
    assert.equal(list.data.clients.some((c) => c.id === rita), false, "hidden from the default list / new-ride picker");
    assert.equal(list.data.archivedCount, 1);
    const arch = await call(worker, "/api/clients?archived=1", { session: A.session });
    assert.deepEqual(arch.data.clients.map((c) => c.id), [rita]);
    assert.equal(arch.data.clients[0].archived, true);
    assert.equal((await call(worker, "/api/clients?archived=1", { session: B.session })).data.clients.length, 0, "B sees none of A's archived clients");
    assert.equal((await call(worker, "/api/clients/" + rita, { method: "DELETE", session: A.session })).data.already, true);

    // ---- restore ----
    const res = await call(worker, "/api/clients/" + rita + "/restore", { method: "POST", session: A.session, body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.restored, true);
    list = await call(worker, "/api/clients", { session: A.session });
    assert.equal(list.data.clients.some((c) => c.id === rita), true);
    assert.equal(list.data.archivedCount, 0);
    assert.equal((await call(worker, "/api/schedules/" + sid, { session: A.session })).data.schedule.active, false, "restore leaves the schedule paused");

    // ---- company B's own delete is unaffected by A ----
    const bc = await newClient(worker, B.session, "B Client");
    assert.equal((await call(worker, "/api/clients/" + bc, { method: "DELETE", session: A.session })).status, 404);
    assert.equal((await call(worker, "/api/clients/" + bc, { method: "DELETE", session: B.session })).data.deleted, true);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("delete client before migration 0018: list/get work, hard delete works, archive answers 409 and changes nothing", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-client-delete-pre-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    await run(["d1", "execute", "nudge-app-local", "--local", "-c", "wrangler.toml", "--persist-to", persistTo, "--command", "DROP INDEX clients_company_archived; ALTER TABLE clients DROP COLUMN archived_at;"]);
    worker = await boot(persistTo);
    const A = await openOwner(worker, "pre@example.test", "Pre Cars");
    const empty = await newClient(worker, A.session, "Empty");
    const busy = await newClient(worker, A.session, "Busy");
    const ride = await call(worker, "/api/rides", { method: "POST", session: A.session, body: { clientId: busy, date: etDay(2), time: "10:00", pickup: "A", dropoff: "B", passengers: 1, fare: "40" } });
    assert.equal(ride.status, 201, JSON.stringify(ride.data));
    const list = await call(worker, "/api/clients", { session: A.session });
    assert.equal(list.status, 200);
    assert.equal(list.data.archiveOn, false);
    assert.equal(list.data.clients.length, 2);
    assert.equal((await call(worker, "/api/clients/" + busy, { session: A.session })).data.client.archived, false);
    assert.equal((await call(worker, "/api/clients/" + empty, { method: "DELETE", session: A.session })).data.deleted, true);
    const r = await call(worker, "/api/clients/" + busy, { method: "DELETE", session: A.session });
    assert.equal(r.status, 409);
    assert.equal(r.data.needsMigration, true);
    assert.equal((await call(worker, "/api/clients/" + busy, { session: A.session })).status, 200);
    assert.equal((await call(worker, "/api/clients/" + busy + "/restore", { method: "POST", session: A.session, body: {} })).status, 409);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
