// 15-ride free trial (Nov 17, 2026): counting, automatic conversion at the 15th completed ride (exactly once),
// webhooks, cancel with exit survey, and platform feedback. Local only: Stripe is a mock on 127.0.0.1.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { signForTest } from "../app/stripe_webhook.js";
import { startTrialStripeMock } from "./fixtures/stripe-trial-mock.js";

const WEBHOOK_SECRET = "whsec_trial_test";
const ADMIN = "trial-admin-token";
const PLATFORM_EMAIL = "platform@example.test";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}
async function call(worker, path, { method = "GET", body, session, csrf = true, admin = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (csrf && session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || "") };
}
function run(args) {
  const out = [];
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" } });
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => out.push(c));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(Buffer.concat(out).toString()) : reject(new Error(args.join(" ") + " exited " + code + ": " + Buffer.concat(out).toString()))));
  });
}
async function sql(persistTo, text, json = false) {
  const file = join(persistTo, "q-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".sql");
  await writeFile(file, text);
  const out = await run(["wrangler", "d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--file", file, ...(json ? ["--json"] : [])]);
  if (!json) return out;
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}
async function postWebhook(worker, event) {
  const body = JSON.stringify({ object: "event", livemode: false, created: Math.floor(Date.now() / 1000), ...event });
  const header = await signForTest(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  const response = await worker.fetch("http://127.0.0.1/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body });
  return { status: response.status, data: JSON.parse(await response.text()) };
}

async function boot(t) {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-trial-"));
  const mock = await startTrialStripeMock();
  await run(["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
  const worker = await unstable_dev("app/index.js", {
    config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, PLATFORM_ADMIN_EMAILS: PLATFORM_EMAIL, SMS_MODE: "off", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_API_BASE: mock.url, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_CARD_PAYMENT_CONFIGURATION: "pmc_cardonlytest1" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  t.after(async () => {
    await worker.stop();
    await mock.close();
    await rm(persistTo, { recursive: true, force: true });
  });
  return { worker, mock, persistTo };
}

async function signUp(worker, slug = "peach-state-cars", email = "ada@example.test") {
  const started = await call(worker, "/api/signup", { method: "POST", body: {
    companyName: "Peach State Cars", ownerName: "Ada Owner", email, password: "sample-owner-pass",
    bookingSlug: slug, ownerPhone: "404-555-0100", termsAccepted: true, slugPermanentConfirmed: true,
  } });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  const done = await call(worker, "/api/signup/complete", { method: "POST", body: { sessionId: "cs_test_signupsession1" } });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  return { cookie: done.cookie, csrf: done.data.csrf };
}

async function companyRow(persistTo) {
  return (await sql(persistTo, "SELECT * FROM companies WHERE name = 'Peach State Cars'", true))[0];
}

const clientOf = (companyId) => "c1e00000-0000-4000-8000-" + companyId.slice(-12);
// Rides straight into D1 (fast). status: completed | scheduled | cancelled; approval: none | requested | declined.
async function addRides(persistTo, companyId, n, status = "completed", approval = "none") {
  const now = Date.now();
  const clientId = clientOf(companyId);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    rows.push(`('${id}', '${companyId}', '${clientId}', '2026-11-10', '08:00', 'Hotel', 'Airport', 1, '', 4000, '', '${status}', 'unpaid', ${now}, ${now}, '${status === "completed" ? "Completed" : ""}', '${approval}')`);
  }
  await sql(persistTo, `INSERT OR IGNORE INTO clients (id, company_id, name, phone, email, notes, created_at, updated_at) VALUES ('${clientId}', '${companyId}', 'Sample Rider', '', '', '', ${now}, ${now});
    INSERT INTO rides (id, company_id, client_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at, progress, approval) VALUES ${rows.join(",\n")};`);
}

async function completeRideViaApi(worker, session) {
  const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0123" } });
  assert.equal(client.status, 201, JSON.stringify(client.data));
  const ride = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: "2026-11-18", time: "09:30", pickup: "Midtown", dropoff: "ATL Airport", passengers: 1, fare: "145" } });
  assert.equal(ride.status, 201, JSON.stringify(ride.data));
  const id = ride.data.ride.id;
  let from = "";
  for (const step of ["En route", "Arrived", "Picked up", "Completed"]) {
    const r = await call(worker, `/api/rides/${id}/progress`, { method: "POST", session, body: { step, from } });
    assert.equal(r.status, 200, step + " " + JSON.stringify(r.data));
    from = step;
  }
  return id;
}

const convertHits = (mock) => mock.hits.filter((h) => h.method === "POST" && h.path === "/v1/subscriptions/sub_signup" && /trial_end=now/.test(h.body));

test("15-ride trial: only completed rides count, heads-up at 12, converts automatically at the 15th exactly once, never blocks", { timeout: 240000 }, async (t) => {
  const { worker, mock, persistTo } = await boot(t);
  const owner = await signUp(worker);
  const company = await companyRow(persistTo);
  assert.equal(company.trial_billing, "auto");
  assert.equal(company.trial_status, "trial");

  // Cancelled rides, open requests, declined requests and scheduled rides never count.
  await addRides(persistTo, company.id, 3, "cancelled");
  await addRides(persistTo, company.id, 2, "scheduled", "requested");
  await addRides(persistTo, company.id, 1, "cancelled", "declined");
  await addRides(persistTo, company.id, 2, "scheduled");
  await addRides(persistTo, company.id, 11, "completed");
  let tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  assert.equal(tr.data.trial.ridesUsed, 11);
  assert.equal(tr.data.trial.state, "normal");
  assert.equal(tr.data.trial.timeLimited, false);
  assert.equal(tr.data.trial.daysLeft, null);
  assert.equal(tr.data.trial.canCancel, true);
  assert.match(tr.data.banner.line, /11 of 15 free rides used/);
  assert.equal(tr.data.banner.cancelNote, undefined);

  // $0 invoice when the trialing subscription starts: still on the trial.
  const zero = await postWebhook(worker, { id: "evt_zero", type: "invoice.paid", data: { object: { id: "in_zero", object: "invoice", customer: "cus_signup", subscription: "sub_signup", amount_paid: 0, total: 0, lines: { data: [] } } } });
  assert.equal(zero.status, 200);
  assert.match(zero.data.result, /trial started/);
  assert.equal((await companyRow(persistTo)).trial_status, "trial");

  // Ride 12: heads-up with one plain line about cancelling (no button).
  await addRides(persistTo, company.id, 1, "completed");
  tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.state, "warning");
  assert.match(tr.data.banner.detail, /3 free rides left/);
  assert.match(tr.data.banner.detail, /\$39\/month/);
  assert.equal(tr.data.banner.cancelNote, "You can cancel in Account settings.");

  await addRides(persistTo, company.id, 2, "completed");
  tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.ridesUsed, 14);
  assert.equal(convertHits(mock).length, 0, "no conversion before the 15th ride");

  // The 15th completed ride (through the real ride flow) converts the trial with no prompt.
  await completeRideViaApi(worker, owner);
  assert.equal(convertHits(mock).length, 1);
  assert.match(convertHits(mock)[0].body, /proration_behavior=none/);
  assert.equal(convertHits(mock)[0].idem, "nudge-trial-convert-" + company.id);
  let row = await companyRow(persistTo);
  assert.equal(row.trial_status, "active");
  assert.ok(row.trial_converted_at > 0);

  tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.state, "converted");
  assert.equal(tr.data.trial.open, true);
  assert.equal(tr.data.trial.canCancel, false);
  assert.equal(tr.data.banner.dismissible, true);
  assert.match(tr.data.banner.line, /Solo plan started: \$39\/month/);
  assert.equal(tr.data.banner.actions, undefined, "informational only, no choices");

  // More completions and more checks never convert again.
  await addRides(persistTo, company.id, 3, "completed");
  await call(worker, "/api/trial", { session: owner });
  await completeRideViaApi(worker, owner);
  assert.equal(convertHits(mock).length, 1, "converted exactly once");

  // Booking keeps working after conversion.
  const newRide = await call(worker, "/api/rides", { method: "POST", session: owner, body: { clientId: clientOf(company.id), date: "2026-11-20", time: "10:00", pickup: "A", dropoff: "B", passengers: 1, fare: "90" } });
  assert.equal(newRide.status, 201, JSON.stringify(newRide.data));

  // Card declined on the first charge: past_due with the 7-day grace banner; booking still open.
  const failed = await postWebhook(worker, { id: "evt_fail", type: "invoice.payment_failed", data: { object: { id: "in_first", object: "invoice", customer: "cus_signup", subscription: "sub_signup", amount_due: 3900 } } });
  assert.equal(failed.data.result, "past_due");
  const me = await call(worker, "/api/me", { session: owner });
  assert.equal(me.data.access.banner.state, "grace");
  const duringGrace = await call(worker, "/api/rides", { method: "POST", session: owner, body: { clientId: clientOf(company.id), date: "2026-11-21", time: "10:00", pickup: "A", dropoff: "B", passengers: 1, fare: "90" } });
  assert.equal(duringGrace.status, 201, JSON.stringify(duringGrace.data));
  const paid = await postWebhook(worker, { id: "evt_paid", type: "invoice.paid", data: { object: { id: "in_first", object: "invoice", customer: "cus_signup", subscription: "sub_signup", amount_paid: 3900, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } } });
  assert.equal(paid.data.result, "paying");
  row = await companyRow(persistTo);
  assert.equal(row.billing_status, "active");

  // Dismiss the notice; cancel is no longer offered (plan has started).
  const dismissed = await call(worker, "/api/trial/notice/dismiss", { method: "POST", session: owner, body: {} });
  assert.equal(dismissed.status, 200);
  tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.state, "active");
  assert.equal(tr.data.banner, null);
  assert.equal(tr.data.trial.canCancel, false);
  assert.equal(tr.data.trial.canCancelAccount, true);
  assert.equal(tr.data.trial.cancelKind, "paid");

  // Paid Solo cancel (Profile & account): Stripe sub canceled now, no proration, no final invoice, no further charges.
  const paidCancel = await call(worker, "/api/account/cancel", { method: "POST", session: owner, body: { confirm: true, reasons: ["not_driving"] } });
  assert.equal(paidCancel.status, 200, JSON.stringify(paidCancel.data));
  assert.equal(paidCancel.data.kind, "paid");
  assert.equal(paidCancel.data.charged, false);
  assert.ok(paidCancel.data.accessUntil > Date.now(), "access runs to the paid-through date");
  const dels = mock.hits.filter((h) => h.method === "DELETE" && h.path === "/v1/subscriptions/sub_signup");
  assert.equal(dels.length, 1);
  assert.match(dels[0].query, /invoice_now=false/);
  assert.match(dels[0].query, /prorate=false/);
  assert.equal(convertHits(mock).length, 1);
  row = await companyRow(persistTo);
  assert.equal(row.billing_status, "canceled");
  const meAfter = await call(worker, "/api/me", { session: owner });
  assert.equal(meAfter.data.access.banner.state, "ending");
  const fbPaid = await sql(persistTo, "SELECT plan, reasons FROM cancellation_feedback", true);
  assert.equal(fbPaid[0].plan, "solo");
  assert.deepEqual(JSON.parse(fbPaid[0].reasons), ["not_driving"]);
  const twice = await call(worker, "/api/account/cancel", { method: "POST", session: owner, body: { confirm: true, skip: true } });
  assert.equal(twice.status, 409);
});

test("conversion retries if Stripe is down, still exactly once", { timeout: 180000 }, async (t) => {
  const { worker, mock, persistTo } = await boot(t);
  const owner = await signUp(worker);
  const company = await companyRow(persistTo);
  await addRides(persistTo, company.id, 15, "completed");
  mock.st.failUpdate = true;
  let tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.state, "converting");
  assert.equal(tr.data.trial.open, true, "never blocks while converting");
  let row = await companyRow(persistTo);
  assert.equal(row.trial_converted_at, null);
  assert.equal(row.trial_convert_claimed_at, null, "claim released for a retry");
  assert.match(row.trial_convert_error, /Stripe is down/);
  mock.st.failUpdate = false;
  tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.state, "converted");
  await call(worker, "/api/trial", { session: owner });
  const attempts = convertHits(mock);
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((h) => h.idem === "nudge-trial-convert-" + company.id), "same idempotency key on the retry");
  row = await companyRow(persistTo);
  assert.ok(row.trial_converted_at > 0);

  // trial_will_end is ignored once converted.
  const willEnd = await postWebhook(worker, { id: "evt_twe", type: "customer.subscription.trial_will_end", data: { object: { id: "sub_signup", object: "subscription", customer: "cus_signup", status: "trialing" } } });
  assert.match(willEnd.data.result, /ignored/);
});

test("cancel mid-trial: auth required, exit survey saved, Stripe sub canceled with no invoice, later rides never convert", { timeout: 240000 }, async (t) => {
  const { worker, mock, persistTo } = await boot(t);
  const owner = await signUp(worker);
  const company = await companyRow(persistTo);
  await addRides(persistTo, company.id, 5, "completed");

  // trial_will_end near the 730-day horizon pushes the Stripe trial out again (no time expiry).
  const willEnd = await postWebhook(worker, { id: "evt_twe1", type: "customer.subscription.trial_will_end", data: { object: { id: "sub_signup", object: "subscription", customer: "cus_signup", status: "trialing" } } });
  assert.equal(willEnd.data.result, "trial extended");
  const extend = mock.hits.filter((h) => h.method === "POST" && h.path === "/v1/subscriptions/sub_signup" && /trial_end=\d+/.test(h.body));
  assert.equal(extend.length, 1);

  // Auth: no session, no CSRF, and platform/other roles are refused. Nothing reaches Stripe.
  const anon = await call(worker, "/api/trial/cancel", { method: "POST", body: { confirm: true, skip: true } });
  assert.equal(anon.status, 401, JSON.stringify(anon.data));
  const noCsrf = await call(worker, "/api/trial/cancel", { method: "POST", session: owner, csrf: false, body: { confirm: true, skip: true } });
  assert.equal(noCsrf.status, 403, JSON.stringify(noCsrf.data));
  const noConfirm = await call(worker, "/api/trial/cancel", { method: "POST", session: owner, body: { skip: true } });
  assert.equal(noConfirm.status, 400);
  const badReason = await call(worker, "/api/trial/cancel", { method: "POST", session: owner, body: { confirm: true, reasons: ["bogus"] } });
  assert.equal(badReason.status, 400);
  assert.equal(mock.hits.filter((h) => h.method === "DELETE").length, 0);

  const canceled = await call(worker, "/api/trial/cancel", { method: "POST", session: owner, body: { confirm: true, reasons: ["too_expensive", "other"], details: "Slow season. Maybe in spring." } });
  assert.equal(canceled.status, 200, JSON.stringify(canceled.data));
  assert.equal(canceled.data.charged, false);
  assert.equal(canceled.data.mode, "end_now");
  const del = mock.hits.filter((h) => h.method === "DELETE" && h.path === "/v1/subscriptions/sub_signup");
  assert.equal(del.length, 1);
  assert.match(del[0].query, /invoice_now=false/);
  assert.match(del[0].query, /prorate=false/);
  assert.ok(!mock.hits.some((h) => h.path.startsWith("/v1/invoices")), "no invoice");
  assert.equal(convertHits(mock).length, 0);

  const fb = await sql(persistTo, "SELECT company_id, plan, rides_used, reasons, details, created_at FROM cancellation_feedback", true);
  assert.equal(fb.length, 1);
  assert.equal(fb[0].company_id, company.id);
  assert.equal(fb[0].plan, "solo-trial");
  assert.equal(fb[0].rides_used, 5);
  assert.deepEqual(JSON.parse(fb[0].reasons), ["too_expensive", "other"]);
  assert.equal(fb[0].details, "Slow season. Maybe in spring.");
  assert.ok(fb[0].created_at > 0);

  const row = await companyRow(persistTo);
  assert.equal(row.trial_status, "ended");
  assert.equal(row.trial_end_reason, "canceled");
  assert.equal(row.billing_status, "canceled");
  assert.ok(row.trial_canceled_at > 0);

  // Booking access ends right away; data stays readable.
  const tr = await call(worker, "/api/trial", { session: owner });
  assert.equal(tr.data.trial.open, false);
  assert.equal(tr.data.trial.canCancel, false);
  assert.equal(tr.data.banner.title, "Your free trial was canceled");
  assert.match(tr.data.banner.line, /not charged/);
  const blocked = await call(worker, "/api/rides", { method: "POST", session: owner, body: { clientId: clientOf(company.id), date: "2026-11-20", time: "10:00", pickup: "A", dropoff: "B", passengers: 1, fare: "90" } });
  assert.equal(blocked.status, 403);
  const list = await call(worker, "/api/rides", { session: owner });
  assert.equal(list.status, 200);

  // Rides completed after the cancel (e.g. already scheduled ones) never trigger a conversion.
  await addRides(persistTo, company.id, 12, "completed");
  await call(worker, "/api/trial", { session: owner });
  await call(worker, "/api/trial", { session: owner });
  assert.equal(convertHits(mock).length, 0);
  const again = await call(worker, "/api/trial/cancel", { method: "POST", session: owner, body: { confirm: true, skip: true } });
  assert.equal(again.status, 409);

  // Stripe's own deletion event afterwards changes nothing.
  const deleted = await postWebhook(worker, { id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_signup", object: "subscription", customer: "cus_signup", status: "canceled" } } });
  assert.equal(deleted.data.result, "canceled");

  // Platform admin sees it as Cancellation feedback; owners don't.
  const ownerView = await call(worker, "/api/platform/cancellation-feedback", { session: owner });
  assert.equal(ownerView.status, 404);
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: PLATFORM_EMAIL, companyName: "Platform Holder", accountKind: "fleet" } });
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  await sql(persistTo, `UPDATE users SET platform_admin = 1 WHERE email = '${PLATFORM_EMAIL}';`);
  const platform = { cookie: accepted.cookie, csrf: accepted.data.csrf };
  const listFb = await call(worker, "/api/platform/cancellation-feedback", { session: platform });
  assert.equal(listFb.status, 200, JSON.stringify(listFb.data));
  assert.equal(listFb.data.feedback.length, 1);
  assert.equal(listFb.data.feedback[0].companyName, "Peach State Cars");
  assert.deepEqual(listFb.data.feedback[0].reasonLabels, ["Too expensive", "Other"]);
  assert.equal(listFb.data.feedback[0].ridesUsed, 5);
});

test("Skip and cancel stores a row with null reasons; Stripe-side cancel during the trial counts as a cancel", { timeout: 180000 }, async (t) => {
  const { worker, mock, persistTo } = await boot(t);
  const owner = await signUp(worker);
  const company = await companyRow(persistTo);
  await addRides(persistTo, company.id, 2, "completed");
  const skipped = await call(worker, "/api/trial/cancel", { method: "POST", session: owner, body: { confirm: true, skip: true, reasons: ["too_hard"], details: "ignored when skipping" } });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.data));
  const fb = await sql(persistTo, "SELECT reasons, details, rides_used FROM cancellation_feedback", true);
  assert.equal(fb.length, 1);
  assert.equal(fb[0].reasons, null);
  assert.equal(fb[0].details, null);
  assert.equal(fb[0].rides_used, 2);
  assert.equal(mock.hits.filter((h) => h.method === "DELETE").length, 1);

  // A second company whose trial is canceled from the Stripe dashboard: treated as a trial cancel, never converts.
  await sql(persistTo, `UPDATE companies SET trial_status = 'trial', trial_canceled_at = NULL, trial_end_reason = '', trial_ended_at = NULL, billing_status = 'active' WHERE id = '${company.id}'`);
  const del = await postWebhook(worker, { id: "evt_del2", type: "customer.subscription.deleted", data: { object: { id: "sub_signup", object: "subscription", customer: "cus_signup", status: "canceled" } } });
  assert.equal(del.data.result, "trial canceled");
  await addRides(persistTo, company.id, 20, "completed");
  await call(worker, "/api/trial", { session: owner });
  assert.equal(convertHits(mock).length, 0);
  const row = await companyRow(persistTo);
  assert.equal(row.trial_status, "ended");
});
