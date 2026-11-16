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

function etDay(offset) {
  return new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function owner(worker, email, companyName, accountKind = "fleet") {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass" } });
  return { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
}

test("regular schedules: upcoming list, confirm creates exactly one ride, skip persists, validation", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-sched-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_DATA_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const session = await owner(worker, "sched@example.test", "Sched Cars");
    const other = await owner(worker, "other@example.test", "Other Cars");
    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Dana Flyer", phone: "404-555-0199" } });
    assert.equal(client.status, 201);
    const clientId = client.data.client.id;
    const driver = await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Sam Lee" } });
    assert.equal(driver.status, 201, JSON.stringify(driver.data));
    const driverId = driver.data.driver.id;

    const today = etDay(0);
    const base = { clientId, time: "05:30", pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport", startDate: today };

    // Validation (nothing stored).
    assert.equal((await call(worker, "/api/schedules", { method: "POST", session, body: { ...base } })).status, 400, "needs a day");
    assert.equal((await call(worker, "/api/schedules", { method: "POST", session, body: { ...base, weekDays: [9] } })).status, 400);
    assert.equal((await call(worker, "/api/schedules", { method: "POST", session, body: { ...base, monthDays: [1], clientId: "00000000-0000-4000-8000-000000000000" } })).status, 404);
    assert.equal((await call(worker, "/api/schedules", { method: "POST", session, body: { ...base, monthDays: [1], driverUserId: "00000000-0000-4000-8000-000000000000" } })).status, 404);
    assert.equal((await call(worker, "/api/schedules", { method: "POST", body: { ...base, monthDays: [1] } })).status, 401);
    assert.equal((await call(worker, "/api/schedules", { method: "POST", session: { cookie: session.cookie }, body: { ...base, monthDays: [1] } })).status, 403, "CSRF required");

    // Daily schedule (all weekdays), 3 days ahead, default fare, preferred driver, a stop, hostile label text.
    const tricky = "<img src=x onerror=alert(1)>";
    const s1 = await call(worker, "/api/schedules", { method: "POST", session, body: { ...base, label: tricky, weekDays: [0, 1, 2, 3, 4, 5, 6], fare: "95", driverUserId: driverId, stops: ["Lenox Square"], lookaheadDays: 3, flight: "dl 123" } });
    assert.equal(s1.status, 201, JSON.stringify(s1.data));
    const sid = s1.data.schedule.id;
    assert.equal(s1.data.schedule.label, tricky, "stored as text; the SPA escapes on output");
    assert.equal(s1.data.schedule.flight, "DL 123");
    assert.equal(s1.data.schedule.driverName, "Sam Lee");
    assert.deepEqual(s1.data.schedule.upcoming.map((o) => o.date), [etDay(0), etDay(1), etDay(2), etDay(3)]);

    // Monthly schedule on the day-of-month two days out, no default fare.
    const d2 = etDay(2);
    const s2 = await call(worker, "/api/schedules", { method: "POST", session, body: { ...base, monthDays: [Number(d2.slice(8))], time: "16:00" } });
    assert.equal(s2.status, 201, JSON.stringify(s2.data));
    const sid2 = s2.data.schedule.id;

    let upcoming = await call(worker, "/api/schedules/upcoming", { session });
    assert.equal(upcoming.status, 200);
    assert.equal(upcoming.data.count, 5);
    assert.equal(upcoming.data.today, today);
    assert.ok(upcoming.data.occurrences.some((o) => o.scheduleId === sid2 && o.date === d2 && o.fare === ""));
    assert.equal((await call(worker, "/api/schedules/upcoming", { session: other })).data.count, 0, "other companies see nothing");
    assert.equal((await call(worker, `/api/schedules/${sid}`, { session: other })).status, 404);
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(1)}/confirm`, { method: "POST", session: other, body: {} })).status, 404);

    // No ride exists until Confirm.
    assert.equal((await call(worker, "/api/rides", { session })).data.rides.length, 0);

    // Confirm creates one normal scheduled ride prefilled from the schedule.
    const c1 = await call(worker, `/api/schedules/${sid}/occurrences/${etDay(1)}/confirm`, { method: "POST", session, body: {} });
    assert.equal(c1.status, 201, JSON.stringify(c1.data));
    const ride = c1.data.ride;
    assert.equal(ride.date, etDay(1));
    assert.equal(ride.time, "05:30");
    assert.equal(ride.status, "scheduled");
    assert.equal(ride.fareCents, 9500);
    assert.equal(ride.source, "schedule");
    assert.deepEqual(ride.stops, ["Lenox Square"]);
    assert.equal(ride.driverUserId, driverId);
    assert.equal(ride.flight, "DL 123");

    // The same date again: refused, still one ride.
    const again = await call(worker, `/api/schedules/${sid}/occurrences/${etDay(1)}/confirm`, { method: "POST", session, body: {} });
    assert.equal(again.status, 409);
    assert.equal(again.data.rideId, ride.id);

    // Two confirms at once for one date: exactly one wins.
    const race = await Promise.all([0, 1, 2].map(() => call(worker, `/api/schedules/${sid}/occurrences/${etDay(2)}/confirm`, { method: "POST", session, body: {} })));
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409, 409], JSON.stringify(race.map((r) => r.data)));
    let rides = (await call(worker, "/api/rides", { session })).data.rides;
    assert.equal(rides.filter((r) => r.date === etDay(2) && r.source === "schedule").length, 1);
    assert.equal(rides.length, 2);

    // Skip persists, and a skipped date cannot be confirmed until the skip is undone.
    const skip = await call(worker, `/api/schedules/${sid}/occurrences/${etDay(3)}/skip`, { method: "POST", session, body: {} });
    assert.equal(skip.status, 200, JSON.stringify(skip.data));
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(3)}/skip`, { method: "POST", session, body: {} })).status, 409);
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(3)}/confirm`, { method: "POST", session, body: {} })).status, 409);
    upcoming = await call(worker, "/api/schedules/upcoming", { session });
    assert.deepEqual(upcoming.data.occurrences.filter((o) => o.scheduleId === sid).map((o) => o.date), [etDay(0)]);
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(1)}`, { method: "DELETE", session })).status, 409, "a confirmed date stays");
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(3)}`, { method: "DELETE", session })).status, 200);
    upcoming = await call(worker, "/api/schedules/upcoming", { session });
    assert.deepEqual(upcoming.data.occurrences.filter((o) => o.scheduleId === sid).map((o) => o.date), [etDay(0), etDay(3)]);

    // No default fare: Confirm asks for Edit; Edit-then-confirm with overrides works once.
    const noFare = await call(worker, `/api/schedules/${sid2}/occurrences/${d2}/confirm`, { method: "POST", session, body: {} });
    assert.equal(noFare.status, 400);
    assert.match(noFare.data.error, /no default fare/);
    assert.equal((await call(worker, `/api/schedules/${sid2}/occurrences/${d2}/confirm`, { method: "POST", session, body: { fare: "abc" } })).status, 400);
    const edited = await call(worker, `/api/schedules/${sid2}/occurrences/${d2}/confirm`, { method: "POST", session, body: { fare: "120", time: "07:15", notes: "Gate B", stops: [] } });
    assert.equal(edited.status, 201, JSON.stringify(edited.data));
    assert.equal(edited.data.ride.time, "07:15");
    assert.equal(edited.data.ride.fareCents, 12000);
    assert.equal(edited.data.ride.notes, "Gate B");
    assert.equal(edited.data.ride.driverUserId, null);

    // Dates that are not on the schedule, or bad paths.
    assert.equal((await call(worker, `/api/schedules/${sid2}/occurrences/${etDay(1)}/confirm`, { method: "POST", session, body: { fare: "1" } })).status, 400);
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/2026-02-30/confirm`, { method: "POST", session, body: {} })).status, 400);
    assert.equal((await call(worker, `/api/schedules/${sid}`, { method: "PATCH", session, body: { startDate: etDay(-40) } })).status, 200);
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(-30)}/confirm`, { method: "POST", session, body: {} })).status, 409, "long past");

    // Pause: nothing to confirm, confirm refused; resume brings dates back.
    const paused = await call(worker, `/api/schedules/${sid}`, { method: "PATCH", session, body: { active: false } });
    assert.equal(paused.status, 200, JSON.stringify(paused.data));
    assert.equal(paused.data.schedule.active, false);
    assert.equal(paused.data.schedule.fareCents, 9500, "PATCH keeps fields it was not sent");
    assert.equal((await call(worker, `/api/schedules/${sid}/occurrences/${etDay(0)}/confirm`, { method: "POST", session, body: {} })).status, 409);
    assert.equal((await call(worker, "/api/schedules/upcoming", { session })).data.occurrences.filter((o) => o.scheduleId === sid).length, 0);
    await call(worker, `/api/schedules/${sid}`, { method: "PATCH", session, body: { active: true, monthDays: [31], weekDays: [] } });
    const listed = await call(worker, `/api/schedules?clientId=${clientId}`, { session });
    assert.equal(listed.data.schedules.length, 2);
    const s1Now = listed.data.schedules.find((s) => s.id === sid);
    assert.equal(s1Now.summary, "Monthly on the 31st");
    assert.match(s1Now.monthEndNote, /last day of the month/);
    assert.equal((await call(worker, "/api/schedules?clientId=nope", { session })).status, 400);

    // CSV: confirmed rides carry Source = schedule.
    const csv = await call(worker, "/api/export/rides.csv", { session, raw: true });
    assert.equal(csv.status, 200);
    assert.equal(csv.text.split("\n").filter((line) => line.includes(",schedule,")).length, 3);

    // A client with a schedule cannot be deleted out from under it; deleting a schedule keeps its rides.
    assert.equal((await call(worker, `/api/clients/${clientId}`, { method: "DELETE", session })).status, 409);
    assert.equal((await call(worker, `/api/schedules/${sid}`, { method: "DELETE", session })).status, 200);
    assert.equal((await call(worker, `/api/schedules/${sid}`, { session })).status, 404);
    rides = (await call(worker, "/api/rides", { session })).data.rides;
    assert.equal(rides.length, 3);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
