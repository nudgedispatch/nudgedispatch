import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";
const TOKEN = "test-intake-token-0123456789";
const SECRET = "test-bland-signing-secret";
const NUMBER = "+14406442454";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session=")) || previous;
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

// Exactly what Bland sends: raw JSON body, X-Webhook-Signature = hex HMAC-SHA256(secret, body). No Nudge headers.
async function bland(worker, payload, { token = TOKEN, secret = SECRET } = {}) {
  const raw = JSON.stringify(payload);
  const headers = { "content-type": "application/json" };
  if (secret) headers["x-webhook-signature"] = createHmac("sha256", secret).update(raw).digest("hex");
  const response = await worker.fetch("http://127.0.0.1/api/inbound/bland/sms/" + token, { method: "POST", headers, body: raw });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}

async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

test("text-to-ride: webhook auth, draft in owner queue, suggested driver, merge, edit, approve, never texts", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-ttr-"));
  // A fake Bland API that records any call. Text-to-ride must never call it.
  const blandHits = [];
  const fake = createServer((req, res) => { blandHits.push(req.url); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const blandBase = "http://127.0.0.1:" + fake.address().port;
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "live", BLAND_API_KEY: "fake-key", BLAND_FROM_NUMBER: NUMBER, BLAND_API_BASE: blandBase,
        TEXT_INTAKE_TOKEN: TOKEN, BLAND_WEBHOOK_SECRET: SECRET, FLIGHT_DATA_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "ttr@example.test", companyName: "Text Cars", accountKind: "fleet" } });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
    const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
    const ana = await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Ana Diaz", vehicle: "Suburban" } });
    const ben = await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Ben Ortiz", vehicle: "Escalade" } });
    assert.equal(ana.status, 201);
    assert.equal(ben.status, 201);
    const me = await call(worker, "/api/me", { session });
    const companyId = me.data.companyId || me.data.user?.companyId;

    // Company setting: inbound number. Admin/platform only.
    const trials = await call(worker, "/api/admin/trials", { admin: true });
    const cid = companyId || (trials.data.companies || trials.data.trials || []).find((c) => /Text Cars/.test(c.name || c.companyName))?.id;
    assert.ok(cid, "company id");
    assert.equal((await call(worker, `/api/admin/companies/${cid}/text-intake`, { method: "PUT", body: { inboundNumber: NUMBER } })).status, 404, "needs admin token");
    const set = await call(worker, `/api/admin/companies/${cid}/text-intake`, { method: "PUT", admin: true, body: { inboundNumber: "(440) 644-2454" } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.textIntake.inboundNumber, NUMBER);
    const ownerView = await call(worker, "/api/text-intake", { session });
    assert.equal(ownerView.data.textIntake.display, "(440) 644-2454");

    // Ana already has a ride at 7:30 PM tomorrow, so she is busy for an 8:15 PM pickup that day.
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Existing Rider", phone: "404-555-0188" } });
    const busy = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: tomorrow, time: "19:30", pickup: "Home", dropoff: "Office", passengers: 1, fare: "80", driverUserId: ana.data.driver.id } });
    assert.equal(busy.status, 201, JSON.stringify(busy.data));
    if (!busy.data.ride.driverUserId) await call(worker, "/api/rides/" + busy.data.ride.id, { method: "PATCH", session, body: { driverUserId: ana.data.driver.id } });

    const msg = { conversation_id: "conv-1", to: NUMBER, from: "+14045550123", channel: "sms", sender: "USER", message: "landing ATL tomorrow 8:15pm DL1742" };
    // Auth: wrong token 404, bad or missing signature 401.
    assert.equal((await bland(worker, msg, { token: "wrong-token-0123456789" })).status, 404);
    assert.equal((await bland(worker, msg, { secret: "not-the-secret" })).status, 401);
    assert.equal((await bland(worker, msg, { secret: "" })).status, 401);

    const first = await bland(worker, msg);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.draft, true);
    const rideId = first.data.rideId;
    // Bland retry of the same delivery: no second draft.
    const again = await bland(worker, msg);
    assert.equal(again.data.duplicate, true);
    assert.equal(again.data.rideId, rideId);
    // Agent echo, status events, unknown numbers: ignored with 200.
    assert.ok((await bland(worker, { ...msg, sender: "AGENT", to: "+14045550123", from: NUMBER, message: "ok" })).data.ignored);
    assert.ok((await bland(worker, { type: "status", status: "ended", conversation_id: "conv-1", phone_number: "+14045550123", agent_number: NUMBER })).data.ignored);
    assert.ok((await bland(worker, { ...msg, to: "+14045559999" })).data.ignored);

    // Owner queue shows the draft with the original text and the suggested driver (Ben, Ana is busy).
    const list = await call(worker, "/api/rides", { session });
    const draft = list.data.rides.find((r) => r.id === rideId);
    assert.equal(draft.status, "requested");
    assert.equal(draft.source, "text");
    assert.equal(draft.flight, "DL1742");
    assert.equal(draft.pickup, "ATL Airport");
    assert.equal(draft.time, "20:15");
    assert.equal(draft.clientName, "Text from (404) 555-0123");
    assert.equal(draft.intake.messages[0].body, "landing ATL tomorrow 8:15pm DL1742");
    assert.equal(draft.date, tomorrow);
    assert.equal(draft.intake.matchedClient, false);
    assert.equal(draft.intake.suggested.name, "Ben Ortiz");
    assert.equal(draft.driverUserId, ben.data.driver.id);
    assert.ok(draft.intake.warnings.some((w) => /Drop-off/.test(w)));

    // Follow-up text fills the drop-off and terminal on the same draft.
    const follow = await bland(worker, { ...msg, message: "Domestic. going to 3500 Lenox Rd NE. This is Dana Lee" });
    assert.equal(follow.data.merged, true);
    assert.equal(follow.data.rideId, rideId);
    let one = await call(worker, "/api/rides/" + rideId, { session });
    assert.equal(one.data.ride.dropoff, "3500 Lenox Rd NE");
    assert.equal(one.data.ride.pickup, "ATL · Domestic Terminal");
    assert.equal(one.data.ride.intake.messages.length, 2);
    assert.equal(one.data.ride.clientName, "Dana Lee", "name from the follow-up text replaces the placeholder");

    // A text from a known client's phone matches that client.
    const known = await bland(worker, { ...msg, conversation_id: "conv-2", from: "+14045550188", message: "Pick me up at ATL tomorrow 6:40am UA 1189 to 10 Park Pl" });
    const knownRide = (await call(worker, "/api/rides/" + known.data.rideId, { session })).data.ride;
    assert.equal(knownRide.clientName, "Existing Rider");
    assert.equal(knownRide.intake.matchedClient, true);

    // Card approve with missing pieces is refused; owner edits the draft, then approves with a driver.
    const noTime = await bland(worker, { ...msg, conversation_id: "conv-3", from: "+14045550177", message: "need a car friday" });
    const refused = await call(worker, "/api/rides/" + noTime.data.rideId + "/approve", { method: "POST", session, body: { fare: "100" } });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /pickup time/);

    const edit = await call(worker, "/api/rides/" + rideId + "/draft", { method: "PATCH", session, body: { time: "20:30", clientName: "Dana M. Lee", passengers: 2, driverUserId: ana.data.driver.id } });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal(edit.data.ride.time, "20:30");
    assert.equal(edit.data.ride.clientName, "Dana M. Lee");
    assert.equal((await call(worker, "/api/rides/" + rideId + "/draft", { method: "PATCH", session, body: { time: "25:99" } })).status, 400);
    const approved = await call(worker, "/api/rides/" + rideId + "/approve", { method: "POST", session, body: { fare: "145", driverUserId: ben.data.driver.id } });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.ride.status, "scheduled");
    assert.equal(approved.data.ride.driverUserId, ben.data.driver.id);
    assert.equal(approved.data.ride.fareCents, 14500);
    assert.equal((await call(worker, "/api/rides/" + rideId + "/draft", { method: "PATCH", session, body: { time: "21:00" } })).status, 409, "approved rides are no longer drafts");

    // Never texted anyone, even with SMS_MODE live and a Bland key configured.
    assert.deepEqual(blandHits, []);
  } finally {
    if (worker) await worker.stop();
    fake.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("text-to-ride: webhook is hidden without TEXT_INTAKE_TOKEN", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-ttr-off-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const r = await bland(worker, { to: NUMBER, from: "+14045550123", sender: "USER", message: "hi" });
    assert.equal(r.status, 404);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
