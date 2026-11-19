import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { b64urlDecode, b64urlEncode, decryptPayload } from "../app/push.js";

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
const sessionOf = (r) => ({ cookie: r.cookie, csrf: r.data.csrf || "" });
async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}
async function localSql(persistTo, command) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--command", command],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local sql exited " + code))));
  });
}
async function owner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  const session = sessionOf(accepted);
  const settings = await call(worker, "/api/settings", { session });
  return { session, slug: settings.data.settings.bookingSlug };
}
// A browser-side subscription: P-256 key pair + 16-byte auth secret.
async function deviceKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;
  return { p256dh: pub, priv, auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}
async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { pub: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), priv: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d, key: pair.publicKey };
}
// Mock push service: records each delivery; status per path can be forced (e.g. 410 Gone).
function mockPushService() {
  const received = [];
  const forced = new Map();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url, headers: req.headers, body: new Uint8Array(Buffer.concat(chunks)) });
      res.statusCode = forced.get(req.url) || 201;
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, received, forced, origin: `http://127.0.0.1:${server.address().port}` })));
}
async function waitFor(fn, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

test("driver ride alerts: subscribe, assign/reassign/cancel/schedule push, 410 cleanup, guards", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-push-"));
  const push = await mockPushService();
  const vapid = await vapidKeys();
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "off", VAPID_PUBLIC_KEY: vapid.pub, VAPID_PRIVATE_KEY: vapid.priv, VAPID_SUBJECT: "mailto:ops@example.test", PUSH_TEST_ENDPOINT_ORIGIN: push.origin },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const fleet = await owner(worker, "push-owner@example.test", "Push Fleet");
    const s = fleet.session;
    const addDriver = async (name, passcode) => {
      const d = await call(worker, "/api/drivers", { method: "POST", session: s, body: { name } });
      assert.equal(d.status, 201, JSON.stringify(d.data));
      assert.equal((await call(worker, `/api/drivers/${d.data.driver.id}/passcode`, { method: "PUT", session: s, body: { passcode } })).status, 200);
      const login = await call(worker, "/api/driver-login", { method: "POST", body: { company: fleet.slug, name, passcode } });
      assert.equal(login.status, 200, JSON.stringify(login.data));
      return { id: d.data.driver.id, session: sessionOf(login) };
    };
    const sam = await addDriver("Sam Lee", "lake48");
    const kim = await addDriver("Kim Ortiz", "pine73");

    // Config: drivers see the public key; owners do not get alerts.
    const cfg = await call(worker, "/api/push/config", { session: sam.session });
    assert.equal(cfg.data.enabled, true);
    assert.equal(cfg.data.publicKey, vapid.pub);
    assert.equal(cfg.data.devices, 0);
    assert.equal((await call(worker, "/api/push/config", { session: s })).data.enabled, false);

    const samDev = await deviceKeys();
    const kimDev = await deviceKeys();
    const sub = (dev, path) => ({ endpoint: push.origin + path, keys: { p256dh: dev.p256dh, auth: dev.auth }, platform: "android" });
    // Guards: auth, CSRF, owner, bad service, bad keys.
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", body: sub(samDev, "/p/sam") })).status, 401);
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: { cookie: sam.session.cookie }, body: sub(samDev, "/p/sam") })).status, 403);
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: s, body: sub(samDev, "/p/owner") })).status, 403);
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: sam.session, body: { ...sub(samDev, ""), endpoint: "https://evil.example/p" } })).status, 400);
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: sam.session, body: { ...sub(samDev, "/p/sam"), keys: { p256dh: "short", auth: samDev.auth } } })).status, 400);
    // Test alert before subscribing.
    assert.equal((await call(worker, "/api/push/test", { method: "POST", session: sam.session, body: {} })).status, 409);

    const ok = await call(worker, "/api/push/subscribe", { method: "POST", session: sam.session, body: sub(samDev, "/p/sam") });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.devices, 1);
    // Same endpoint again updates in place.
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: sam.session, body: sub(samDev, "/p/sam") })).data.devices, 1);
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: kim.session, body: sub(kimDev, "/p/kim") })).status, 201);

    const decode = async (hit, dev) => JSON.parse(await decryptPayload(hit.body, dev.p256dh, dev.priv, dev.auth));
    const nextFor = async (path, after) => waitFor(() => push.received.slice(after).find((r) => r.path === path));

    // Test alert reaches the device with a valid VAPID header.
    let mark = push.received.length;
    const t = await call(worker, "/api/push/test", { method: "POST", session: sam.session, body: {} });
    assert.equal(t.status, 200, JSON.stringify(t.data));
    assert.equal(t.data.sent, 1);
    const testHit = push.received[mark];
    assert.equal(testHit.path, "/p/sam");
    assert.equal(testHit.headers["content-encoding"], "aes128gcm");
    assert.equal(testHit.headers.urgency, "high");
    const auth = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(testHit.headers.authorization);
    assert.ok(auth);
    assert.equal(auth[4], vapid.pub);
    assert.equal(JSON.parse(Buffer.from(b64urlDecode(auth[2])).toString()).aud, push.origin);
    assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapid.key, b64urlDecode(auth[3]), new TextEncoder().encode(`${auth[1]}.${auth[2]}`)), true);
    assert.equal((await decode(testHit, samDev)).kind, "test");

    // Owner assigns a ride to Sam -> Sam's phone gets "New ride assigned" (no rider phone/name).
    const client = await call(worker, "/api/clients", { method: "POST", session: s, body: { name: "Avery Cole", phone: "404-555-0199" } });
    const ride = await call(worker, "/api/rides", { method: "POST", session: s, body: { clientId: client.data.client.id, date: "2026-11-20", time: "09:30", pickup: "123 Main St, Atlanta, GA 30303", dropoff: "ATL Airport", passengers: 1, fare: "40" } });
    assert.equal(ride.status, 201);
    const rideId = ride.data.ride.id;
    mark = push.received.length;
    const assigned = await call(worker, `/api/rides/${rideId}`, { method: "PATCH", session: s, body: { driverUserId: sam.id } });
    assert.equal(assigned.status, 200);
    const hit = await nextFor("/p/sam", mark);
    assert.ok(hit, "assign produced a push request");
    const payload = await decode(hit, samDev);
    assert.equal(payload.kind, "assigned");
    assert.equal(payload.title, "New ride assigned");
    assert.equal(payload.body, "Pickup Fri Nov 20, 9:30 AM · Atlanta, GA");
    assert.equal(payload.url, "/#/rides/" + rideId);
    assert.equal(payload.requireInteraction, true);
    assert.equal(hit.headers.topic, rideId.replace(/-/g, ""));
    assert.doesNotMatch(JSON.stringify(payload), /555-0199|Avery/);

    // Reassign to Kim: Kim gets assigned, Sam gets unassigned.
    mark = push.received.length;
    await call(worker, `/api/rides/${rideId}`, { method: "PATCH", session: s, body: { driverUserId: kim.id } });
    const kimHit = await nextFor("/p/kim", mark);
    const samHit = await nextFor("/p/sam", mark);
    assert.equal((await decode(kimHit, kimDev)).kind, "assigned");
    assert.equal((await decode(samHit, samDev)).kind, "unassigned");

    // Cancel: Kim gets "Ride cancelled".
    mark = push.received.length;
    assert.equal((await call(worker, `/api/rides/${rideId}/cancel`, { method: "POST", session: s, body: {} })).status, 200);
    assert.equal((await decode(await nextFor("/p/kim", mark), kimDev)).kind, "cancelled");

    // A regular-schedule Confirm with a driver alerts that driver.
    const today = etToday();
    const sched = await call(worker, "/api/schedules", { method: "POST", session: s, body: { clientId: client.data.client.id, time: "05:30", pickup: "100 Main St, Alpharetta", dropoff: "ATL Airport", startDate: today, weekDays: [0, 1, 2, 3, 4, 5, 6], fare: "60", driverUserId: sam.id } });
    assert.equal(sched.status, 201, JSON.stringify(sched.data));
    mark = push.received.length;
    const confirmed = await call(worker, `/api/schedules/${sched.data.schedule.id}/occurrences/${today}/confirm`, { method: "POST", session: s, body: {} });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
    const schedHit = await nextFor("/p/sam", mark);
    const sp = await decode(schedHit, samDev);
    assert.equal(sp.kind, "assigned");
    assert.equal(sp.rideId, confirmed.data.ride.id);

    // A dead subscription (410) never fails the assignment and is deleted.
    push.forced.set("/p/sam", 410);
    const ride2 = await call(worker, "/api/rides", { method: "POST", session: s, body: { clientId: client.data.client.id, date: "2026-11-22", time: "14:00", pickup: "ATL Airport", dropoff: "Hotel", passengers: 1, fare: "40" } });
    mark = push.received.length;
    const a2 = await call(worker, `/api/rides/${ride2.data.ride.id}`, { method: "PATCH", session: s, body: { driverUserId: sam.id } });
    assert.equal(a2.status, 200);
    assert.equal(a2.data.ride.driverUserId, sam.id);
    assert.ok(await nextFor("/p/sam", mark));
    // A brand-new subscription survives a 410 (FCM answers 410 for a moment right after subscribing).
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await call(worker, "/api/push/config", { session: sam.session })).data.devices, 1, "new subscription kept after early 410");
    // Once it is older than the grace window, 410 deletes it.
    await localSql(persistTo, "UPDATE push_subscriptions SET created_at = 0");
    mark = push.received.length;
    assert.equal((await call(worker, "/api/push/test", { method: "POST", session: sam.session, body: {} })).status, 200);
    assert.ok(await nextFor("/p/sam", mark));
    let devices = 1;
    for (let i = 0; i < 40 && devices; i++) {
      devices = (await call(worker, "/api/push/config", { session: sam.session })).data.devices;
      if (devices) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(devices, 0, "410 removed the subscription");
    push.forced.delete("/p/sam");

    // Unsubscribe and driver removal clean up.
    assert.equal((await call(worker, "/api/push/unsubscribe", { method: "POST", session: kim.session, body: { endpoint: push.origin + "/p/kim" } })).status, 200);
    assert.equal((await call(worker, "/api/push/config", { session: kim.session })).data.devices, 0);
    assert.equal((await call(worker, "/api/push/subscribe", { method: "POST", session: kim.session, body: sub(kimDev, "/p/kim") })).status, 201);
    const removed = await call(worker, `/api/drivers/${kim.id}`, { method: "DELETE", session: s });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    mark = push.received.length;
    // Even if an owner later points a ride at the removed id, nothing is stored to push to.
    const ride3 = await call(worker, "/api/rides", { method: "POST", session: s, body: { clientId: client.data.client.id, date: "2026-11-23", time: "10:00", pickup: "A", dropoff: "B", passengers: 1, fare: "10" } });
    assert.equal((await call(worker, `/api/rides/${ride3.data.ride.id}`, { method: "PATCH", session: s, body: { driverUserId: kim.id } })).status, 404);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(push.received.slice(mark).filter((r) => r.path === "/p/kim").length, 0);
  } finally {
    if (worker) await worker.stop();
    push.server.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
