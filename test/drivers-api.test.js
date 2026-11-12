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

test("fleet owners add and edit drivers; drivers cannot", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-drivers-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml",
      local: true,
      persist: true,
      persistTo,
      logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });

    const fleet = await openOwner(worker, "owner-a@example.test", "Fleet A", "fleet");
    const other = await openOwner(worker, "owner-b@example.test", "Fleet B", "fleet");
    const solo = await openOwner(worker, "solo@example.test", "Solo Cars", "individual");

    const missing = await call(worker, "/api/drivers", { method: "POST", body: { name: "Sam Lee" } });
    assert.equal(missing.status, 401);

    const soloAdd = await call(worker, "/api/drivers", { method: "POST", session: solo.session, body: { name: "Sam Lee" } });
    assert.equal(soloAdd.status, 403);
    assert.match(soloAdd.data.error, /individual account/);

    const blank = await call(worker, "/api/drivers", { method: "POST", session: fleet.session, body: { name: "  " } });
    assert.equal(blank.status, 400);

    const badPlate = await call(worker, "/api/drivers", {
      method: "POST",
      session: fleet.session,
      body: { name: "Sam Lee", plate: "!!" },
    });
    assert.equal(badPlate.status, 400);

    const created = await call(worker, "/api/drivers", {
      method: "POST",
      session: fleet.session,
      body: { name: "  Sam   Lee ", vehicle: "SUV", plate: "atl 1042" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const driver = created.data.driver;
    assert.equal(driver.name, "Sam Lee");
    assert.equal(driver.vehicle, "SUV");
    assert.equal(driver.plate, "ATL 1042");
    assert.equal(driver.passcodeSet, false);
    assert.equal(driver.email, "");
    assert.equal(driver.role, "driver");

    const again = await call(worker, "/api/drivers", {
      method: "POST",
      session: fleet.session,
      body: { name: "sam lee" },
    });
    assert.equal(again.status, 409);

    const listed = await call(worker, "/api/drivers", { session: fleet.session });
    assert.equal(listed.status, 200);
    assert.ok(listed.data.drivers.some((row) => row.id === driver.id && row.name === "Sam Lee"));

    const otherEdit = await call(worker, "/api/drivers/" + driver.id, {
      method: "PATCH",
      session: other.session,
      body: { name: "Stolen", vehicle: "Van", plate: "NOPE1" },
    });
    assert.equal(otherEdit.status, 404);

    const client = await call(worker, "/api/clients", {
      method: "POST",
      session: fleet.session,
      body: { name: "Avery Cole", phone: "404-555-0199" },
    });
    assert.equal(client.status, 201, JSON.stringify(client.data));
    const ride = await call(worker, "/api/rides", {
      method: "POST",
      session: fleet.session,
      body: {
        clientId: client.data.client.id,
        date: "2026-11-18",
        time: "09:30",
        pickup: "Hotel",
        dropoff: "Airport",
        passengers: 1,
        fare: "40",
      },
    });
    assert.equal(ride.status, 201, JSON.stringify(ride.data));
    const assigned = await call(worker, "/api/rides/" + ride.data.ride.id, {
      method: "PATCH",
      session: fleet.session,
      body: { driverUserId: driver.id },
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    assert.equal(assigned.data.ride.driverUserId, driver.id);

    const edited = await call(worker, "/api/drivers/" + driver.id, {
      method: "PATCH",
      session: fleet.session,
      body: { name: "Samantha Lee", vehicle: "Sedan", plate: "B 12" },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.driver.name, "Samantha Lee");
    assert.equal(edited.data.driver.vehicle, "Sedan");
    assert.equal(edited.data.driver.plate, "B 12");
    assert.equal(edited.data.driver.id, driver.id);
    assert.equal(edited.data.driver.passcodeSet, false);

    const still = await call(worker, "/api/rides/" + ride.data.ride.id, { session: fleet.session });
    assert.equal(still.data.ride.driverUserId, driver.id);

    const weak = await call(worker, "/api/drivers/" + driver.id + "/passcode", {
      method: "PUT",
      session: fleet.session,
      body: { passcode: "samanthalee" },
    });
    assert.equal(weak.status, 400);

    const pass = await call(worker, "/api/drivers/" + driver.id + "/passcode", {
      method: "PUT",
      session: fleet.session,
      body: { passcode: "lake48" },
    });
    assert.equal(pass.status, 200, JSON.stringify(pass.data));
    assert.equal(pass.data.driver.passcodeSet, true);
    assert.equal(JSON.stringify(pass.data).includes("lake48"), false);

    const oldName = await call(worker, "/api/driver-login", {
      method: "POST",
      body: { company: fleet.slug, name: "Sam Lee", passcode: "lake48" },
    });
    assert.equal(oldName.status, 401);

    const signedIn = await call(worker, "/api/driver-login", {
      method: "POST",
      body: { company: fleet.slug, name: "Samantha Lee", passcode: "lake48" },
    });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
    assert.equal(signedIn.data.role, "driver");
    assert.equal(signedIn.data.email, "");
    const driverSession = sessionOf(signedIn);

    const mine = await call(worker, "/api/rides", { session: driverSession });
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    assert.ok(mine.data.rides.some((row) => row.id === ride.data.ride.id));

    const denied = await call(worker, "/api/drivers", {
      method: "POST",
      session: driverSession,
      body: { name: "Extra Driver" },
    });
    assert.equal(denied.status, 403);
    const deniedEdit = await call(worker, "/api/drivers/" + driver.id, {
      method: "PATCH",
      session: driverSession,
      body: { name: "Hacker", vehicle: "", plate: "" },
    });
    assert.equal(deniedEdit.status, 403);
    const deniedPass = await call(worker, "/api/drivers/" + driver.id + "/passcode", {
      method: "PUT",
      session: driverSession,
      body: { passcode: "newpass1" },
    });
    assert.equal(deniedPass.status, 403);

    const emailLogin = await call(worker, "/api/login", {
      method: "POST",
      body: { email: `roster+${driver.id}@drivers.invalid`, password: "lake48" },
    });
    assert.equal(emailLogin.status, 401);

    const cleared = await call(worker, "/api/drivers/" + driver.id + "/passcode", {
      method: "DELETE",
      session: fleet.session,
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    assert.equal(cleared.data.driver.passcodeSet, false);
    const afterClear = await call(worker, "/api/driver-login", {
      method: "POST",
      body: { company: fleet.companyName, name: "Samantha Lee", passcode: "lake48" },
    });
    assert.equal(afterClear.status, 401);
    const sameRide = await call(worker, "/api/rides/" + ride.data.ride.id, { session: fleet.session });
    assert.equal(sameRide.data.ride.driverUserId, driver.id);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("removing a driver keeps completed rides and drops upcoming ones", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-drivers-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml",
      local: true,
      persist: true,
      persistTo,
      logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const fleet = await openOwner(worker, "owner-a@example.test", "Fleet A", "fleet");
    const other = await openOwner(worker, "owner-b@example.test", "Fleet B", "fleet");
    const solo = await openOwner(worker, "solo@example.test", "Solo Cars", "individual");
    const created = await call(worker, "/api/drivers", {
      method: "POST",
      session: fleet.session,
      body: { name: "Riley Cole", vehicle: "SUV", plate: "ATL1042" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const driver = created.data.driver;
    const pass = await call(worker, "/api/drivers/" + driver.id + "/passcode", {
      method: "PUT",
      session: fleet.session,
      body: { passcode: "ride22" },
    });
    assert.equal(pass.status, 200, JSON.stringify(pass.data));
    const signedIn = await call(worker, "/api/driver-login", {
      method: "POST",
      body: { company: fleet.slug, name: "Riley Cole", passcode: "ride22" },
    });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
    const driverSession = sessionOf(signedIn);
    const denied = await call(worker, "/api/drivers/" + driver.id, { method: "DELETE", session: driverSession });
    assert.equal(denied.status, 403);

    const client = await call(worker, "/api/clients", {
      method: "POST",
      session: fleet.session,
      body: { name: "Avery Cole" },
    });
    assert.equal(client.status, 201, JSON.stringify(client.data));
    async function makeRide(time) {
      const ride = await call(worker, "/api/rides", {
        method: "POST",
        session: fleet.session,
        body: {
          clientId: client.data.client.id,
          date: "2026-11-18",
          time,
          pickup: "Hotel",
          dropoff: "Airport",
          passengers: 1,
          fare: "40",
        },
      });
      assert.equal(ride.status, 201, JSON.stringify(ride.data));
      const assigned = await call(worker, "/api/rides/" + ride.data.ride.id, {
        method: "PATCH",
        session: fleet.session,
        body: { driverUserId: driver.id },
      });
      assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
      return ride.data.ride.id;
    }
    const upcomingId = await makeRide("09:30");
    const doneId = await makeRide("16:00");
    for (const [step, from] of [["En route", ""], ["Arrived", "En route"], ["Picked up", "Arrived"], ["Completed", "Picked up"]]) {
      const stepResult = await call(worker, "/api/rides/" + doneId + "/progress", {
        method: "POST",
        session: fleet.session,
        body: { step, from },
      });
      assert.equal(stepResult.status, 200, JSON.stringify(stepResult.data));
    }

    const soloDelete = await call(worker, "/api/drivers/" + driver.id, { method: "DELETE", session: solo.session });
    assert.equal(soloDelete.status, 403);
    const otherDelete = await call(worker, "/api/drivers/" + driver.id, { method: "DELETE", session: other.session });
    assert.equal(otherDelete.status, 404);

    const removed = await call(worker, "/api/drivers/" + driver.id, { method: "DELETE", session: fleet.session });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.equal(removed.data.unassignedRides, 1);

    const listed = await call(worker, "/api/drivers", { session: fleet.session });
    assert.equal(listed.data.drivers.some((row) => row.id === driver.id), false);
    const upcoming = await call(worker, "/api/rides/" + upcomingId, { session: fleet.session });
    assert.equal(upcoming.data.ride.driverUserId, null);
    const done = await call(worker, "/api/rides/" + doneId, { session: fleet.session });
    assert.equal(done.data.ride.driverUserId, driver.id);
    assert.equal(done.data.ride.driverName, "Riley Cole");
    assert.equal(done.data.ride.status, "completed");

    const stillIn = await call(worker, "/api/me", { session: driverSession });
    assert.equal(stillIn.status, 401);
    const signIn = await call(worker, "/api/driver-login", {
      method: "POST",
      body: { company: fleet.slug, name: "Riley Cole", passcode: "ride22" },
    });
    assert.equal(signIn.status, 401);
    const reassign = await call(worker, "/api/rides/" + upcomingId, {
      method: "PATCH",
      session: fleet.session,
      body: { driverUserId: driver.id },
    });
    assert.equal(reassign.status, 404, JSON.stringify(reassign.data));

    const again = await call(worker, "/api/drivers", {
      method: "POST",
      session: fleet.session,
      body: { name: "riley cole", vehicle: "Sedan" },
    });
    assert.equal(again.status, 201, JSON.stringify(again.data));
    assert.notEqual(again.data.driver.id, driver.id);
    const history = await call(worker, "/api/rides/" + doneId, { session: fleet.session });
    assert.equal(history.data.ride.driverUserId, driver.id);
    assert.equal(history.data.ride.driverName, "Riley Cole");
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
