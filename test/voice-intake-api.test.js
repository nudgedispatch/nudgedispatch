import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { inboundCall, agentCall, FLEET_NUMBER } from "./fixtures/bland-voice.js";

const ADMIN = "test-admin-token";
const TEXT_TOKEN = "test-intake-token-0123456789";
const VOICE_TOKEN = "test-voice-token-0123456789";
const SECRET = "test-bland-signing-secret";

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
// Exactly what Bland sends for a post-call webhook: raw JSON, X-Webhook-Signature = hex HMAC-SHA256(secret, body).
async function blandVoice(worker, payload, { token = VOICE_TOKEN, secret = SECRET, headers: extra = {} } = {}) {
  const raw = JSON.stringify(payload);
  const headers = { "content-type": "application/json", ...extra };
  if (secret) headers["x-webhook-signature"] = createHmac("sha256", secret).update(raw).digest("hex");
  const response = await worker.fetch("http://127.0.0.1/api/inbound/bland/voice/" + token, { method: "POST", headers, body: raw });
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

test("voice-to-ride: post-call webhook auth, routing, draft with suggested driver, idempotent, owner switch, approve, never calls out", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-voice-"));
  const blandHits = [];
  const fake = createServer((req, res) => { blandHits.push(req.url); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "live", BLAND_API_KEY: "fake-key", BLAND_FROM_NUMBER: FLEET_NUMBER, BLAND_API_BASE: "http://127.0.0.1:" + fake.address().port,
        TEXT_INTAKE_TOKEN: TEXT_TOKEN, VOICE_INTAKE_TOKEN: VOICE_TOKEN, BLAND_WEBHOOK_SECRET: SECRET, FLIGHT_DATA_PROVIDER: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "voice@example.test", companyName: "Voice Cars", accountKind: "fleet" } });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
    const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
    const ana = await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Ana Diaz", vehicle: "Suburban" } });
    const ben = await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Ben Ortiz", vehicle: "Escalade" } });
    const trials = await call(worker, "/api/admin/trials", { admin: true });
    const me = await call(worker, "/api/me", { session });
    const cid = me.data.companyId || me.data.user?.companyId || (trials.data.companies || trials.data.trials || []).find((c) => /Voice Cars/.test(c.name || c.companyName))?.id;
    assert.ok(cid);

    // Owner cannot turn voice on before Nudge assigns a number.
    const early = await call(worker, "/api/voice-intake", { method: "PUT", session, body: { enabled: true } });
    assert.equal(early.status, 409);
    // Admin assigns the number for texts only; voice stays off by default.
    const set = await call(worker, `/api/admin/companies/${cid}/text-intake`, { method: "PUT", admin: true, body: { inboundNumber: FLEET_NUMBER } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.textIntake.voiceEnabled, false);

    // Ana is busy tomorrow 7:30 PM, so Ben is suggested for an 8:15 PM pickup.
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Existing Rider", phone: "404-555-0146" } });
    const busy = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: tomorrow, time: "19:30", pickup: "Home", dropoff: "Office", passengers: 1, fare: "80", driverUserId: ana.data.driver.id } });
    if (!busy.data.ride.driverUserId) await call(worker, "/api/rides/" + busy.data.ride.id, { method: "PATCH", session, body: { driverUserId: ana.data.driver.id } });

    const payload = inboundCall();
    // Voice off: the number is not routed for calls, so the call is ignored (200, no draft).
    const off = await blandVoice(worker, payload);
    assert.equal(off.status, 200);
    assert.equal(off.data.ignored, "unknown number");

    // Owner turns voice on from More > Phone booking.
    const on = await call(worker, "/api/voice-intake", { method: "PUT", session, body: { enabled: true } });
    assert.equal(on.status, 200, JSON.stringify(on.data));
    assert.equal(on.data.textIntake.voiceEnabled, true);
    assert.equal(on.data.textIntake.voiceReady, true);
    assert.equal((await call(worker, "/api/voice-intake", { method: "PUT", session, body: { enabled: "yes" } })).status, 400);

    // Auth: wrong token 404, bad or missing signature 401, garbage 400.
    assert.equal((await blandVoice(worker, payload, { token: "wrong-token-0123456789" })).status, 404);
    assert.equal((await blandVoice(worker, payload, { secret: "not-the-secret" })).status, 401);
    assert.equal((await blandVoice(worker, payload, { secret: "" })).status, 401);

    const first = await blandVoice(worker, payload);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.draft, true);
    const rideId = first.data.rideId;
    // Bland retries the same call: same ride, no second draft.
    const again = await blandVoice(worker, payload);
    assert.equal(again.data.duplicate, true);
    assert.equal(again.data.rideId, rideId);
    // Outbound calls and calls to other numbers are ignored with 200.
    assert.equal((await blandVoice(worker, inboundCall({ call_id: "outbound-1234567", inbound: false }))).data.ignored, "not an inbound call");
    assert.equal((await blandVoice(worker, inboundCall({ call_id: "other-num-1234567", to: "+14045550999" }))).data.ignored, "unknown number");
    // A hang-up with no words makes no draft.
    const hang = await blandVoice(worker, inboundCall({ call_id: "hangup-1234567", transcripts: [{ user: "assistant", text: "Thanks for calling." }], summary: "" }));
    assert.equal(hang.data.ignored, "no ride details");

    // Owner sees the voice draft with summary, transcript, recording, and the suggested driver.
    const list = await call(worker, "/api/rides", { session });
    const draft = list.data.rides.find((r) => r.id === rideId);
    assert.equal(draft.status, "requested");
    assert.equal(draft.source, "voice");
    assert.equal(draft.pickup, "ATL Domestic Terminal");
    assert.equal(draft.dropoff, "3500 Lenox Rd NE, Atlanta");
    assert.equal(draft.date, tomorrow);
    assert.equal(draft.time, "20:15");
    assert.equal(draft.flight, "DL1742");
    assert.equal(draft.clientName, "Dana Lee");
    assert.equal(draft.clientPhone, "(404) 555-0123");
    assert.equal(draft.intake.channel, "voice");
    assert.equal(draft.intake.callId, payload.call_id);
    assert.match(draft.intake.summary, /Dana Lee/);
    assert.equal(draft.intake.transcript.length, 10);
    assert.match(draft.intake.recordingUrl, /^https:\/\//);
    assert.equal(draft.intake.callbackDisplay, "(404) 555-0123");
    assert.equal(draft.intake.suggested.name, "Ben Ortiz");
    assert.equal(draft.driverUserId, ben.data.driver.id);
    assert.equal(draft.fareCents, 0, "no price from a call");

    // A Bland Agents call from a known client's callback number matches that client; dispositions win.
    const agent = await blandVoice(worker, agentCall());
    assert.equal(agent.data.draft, true, JSON.stringify(agent.data));
    const agentRide = (await call(worker, "/api/rides/" + agent.data.rideId, { session })).data.ride;
    assert.equal(agentRide.clientName, "Existing Rider");
    assert.equal(agentRide.intake.matchedClient, true);
    assert.equal(agentRide.passengers, 2);
    assert.equal(agentRide.time, "06:40");
    assert.match(agentRide.notes, /Child seat/);
    assert.ok(agentRide.intake.warnings.includes("Callback number is different from caller ID."));

    // Disposition follow-up fills a blank on the open draft; same idempotency key twice is a duplicate.
    const sparse = await blandVoice(worker, inboundCall({ call_id: "sparse-1234567", from: "+14045550160", transcripts: [{ user: "user", text: "I need a car from the Ritz Carlton Buckhead to Midtown" }], summary: "Caller needs a ride; time not given." }));
    assert.equal(sparse.data.draft, true);
    const disp = { event_type: "dispositions", timestamp: "2026-11-19T19:40:00Z", call_id: "sparse-1234567", agent_dispositions: [{ disposition_key: "ride_request", payload: { pickup_time: "7:00 PM", pickup_date: "tomorrow" } }] };
    const upd = await blandVoice(worker, disp, { headers: { "x-webhook-idempotency-key": "idem-1" } });
    assert.equal(upd.data.updated, true, JSON.stringify(upd.data));
    assert.equal((await blandVoice(worker, disp, { headers: { "x-webhook-idempotency-key": "idem-1" } })).data.duplicate, true);
    const sparseRide = (await call(worker, "/api/rides/" + sparse.data.rideId, { session })).data.ride;
    assert.equal(sparseRide.time, "19:00");
    assert.equal(sparseRide.date, tomorrow);

    // Approving needs a complete draft; owner edits then approves with a price and a driver.
    const noDrop = await blandVoice(worker, inboundCall({ call_id: "nodrop-1234567", from: "+14045550170", transcripts: [{ user: "user", text: "Pick me up at 55 Main Street tomorrow at 9 am" }], summary: "" }));
    const refused = await call(worker, "/api/rides/" + noDrop.data.rideId + "/approve", { method: "POST", session, body: { fare: "100" } });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /drop-off/);
    const edit = await call(worker, "/api/rides/" + rideId + "/draft", { method: "PATCH", session, body: { time: "20:30", driverUserId: ana.data.driver.id } });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    const approved = await call(worker, "/api/rides/" + rideId + "/approve", { method: "POST", session, body: { fare: "145", driverUserId: ben.data.driver.id } });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.ride.status, "scheduled");
    assert.equal(approved.data.ride.fareCents, 14500);
    // A follow-up after the owner edited/approved does not touch the ride.
    const late = await blandVoice(worker, { ...disp, call_id: payload.call_id }, { headers: { "x-webhook-idempotency-key": "idem-2" } });
    assert.ok(late.data.ignored);

    // Owner turns voice off: new calls are ignored again.
    await call(worker, "/api/voice-intake", { method: "PUT", session, body: { enabled: false } });
    assert.equal((await blandVoice(worker, inboundCall({ call_id: "after-off-1234567" }))).data.ignored, "unknown number");
    // Texts on the same number keep working independently of the voice switch.
    const sms = { conversation_id: "conv-v", to: FLEET_NUMBER, from: "+14045550188", channel: "sms", sender: "USER", message: "landing ATL tomorrow 8:15pm DL1742" };
    const raw = JSON.stringify(sms);
    const t = await worker.fetch("http://127.0.0.1/api/inbound/bland/sms/" + TEXT_TOKEN, { method: "POST", headers: { "content-type": "application/json", "x-webhook-signature": createHmac("sha256", SECRET).update(raw).digest("hex") }, body: raw });
    assert.equal((await t.json()).draft, true);

    // Never called, texted, or charged anyone.
    assert.deepEqual(blandHits, []);
  } finally {
    if (worker) await worker.stop();
    fake.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("voice-to-ride: webhook is hidden without VOICE_INTAKE_TOKEN", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-voice-off-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "off", TEXT_INTAKE_TOKEN: TEXT_TOKEN },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    assert.equal((await blandVoice(worker, inboundCall(), { token: TEXT_TOKEN })).status, 404);
    assert.equal((await blandVoice(worker, inboundCall())).status, 404);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
