import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import {
  LOOKUP,
  SMS_METER_EVENT,
  billingConnection,
  reportSmsUsage,
  stripe,
  stripeKeyProblem,
  stripeWebhookMode,
} from "../app/billing.js";
import { HANDLED_EVENTS, signForTest, webhookLivemodeDecision } from "../app/stripe_webhook.js";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;
const OWNER_EMAIL = "mode-owner@example.test";
const WEBHOOK_SECRET = "whsec_mode_test";

test("live keys are accepted only with STRIPE_MODE=live, and mismatches are refused", async () => {
  assert.equal(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_test_example" }), "");
  assert.equal(stripeKeyProblem({ STRIPE_SECRET_KEY: "rk_test_example", STRIPE_MODE: "test" }), "");
  assert.equal(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_live_example", STRIPE_MODE: "live" }), "");
  assert.equal(stripeKeyProblem({ STRIPE_SECRET_KEY: "rk_live_example", STRIPE_MODE: " live " }), "");
  assert.match(stripeKeyProblem({}), /not connected/);
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_live_example" }), /until STRIPE_MODE is live/);
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_live_example", STRIPE_MODE: "test" }), /until STRIPE_MODE is live/);
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_test_example", STRIPE_MODE: "live" }), /key is test/);
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "pk_live_example", STRIPE_MODE: "live" }), /not an sk_ or rk_/);
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_test_example", STRIPE_MODE: "prod" }), /must be test or live/);

  const testConnection = billingConnection({ STRIPE_SECRET_KEY: "sk_test_example" });
  assert.equal(testConnection.stripeConnected, true);
  assert.equal(testConnection.testMode, true);
  assert.equal(testConnection.mode, "test");
  assert.equal(testConnection.problem, "");
  const liveConnection = billingConnection({ STRIPE_SECRET_KEY: "sk_live_example", STRIPE_MODE: "live" });
  assert.equal(liveConnection.testMode, false);
  assert.equal(liveConnection.mode, "live");
  const blocked = billingConnection({ STRIPE_SECRET_KEY: "sk_live_example" });
  assert.equal(blocked.stripeConnected, false);
  assert.equal(blocked.testMode, true);
  assert.equal(blocked.mode, "off");

  assert.equal(stripeWebhookMode({}).mode, "test");
  assert.equal(stripeWebhookMode({ STRIPE_SECRET_KEY: "sk_test_example" }).mode, "test");
  assert.equal(stripeWebhookMode({ STRIPE_SECRET_KEY: "sk_live_example" }).mode, "");
  assert.equal(stripeWebhookMode({ STRIPE_SECRET_KEY: "sk_live_example", STRIPE_MODE: "live" }).mode, "live");
  assert.equal(stripeWebhookMode({ STRIPE_MODE: "live" }).mode, "");

  assert.deepEqual(webhookLivemodeDecision({ livemode: false }, "test"), { process: true, livemode: 0 });
  assert.deepEqual(webhookLivemodeDecision({}, "test"), { process: true, livemode: 0 });
  assert.equal(webhookLivemodeDecision({ livemode: true }, "test").process, false);
  assert.equal(webhookLivemodeDecision({ livemode: true }, "test").ignored, "livemode event");
  assert.deepEqual(webhookLivemodeDecision({ livemode: true }, "live"), { process: true, livemode: 1 });
  assert.equal(webhookLivemodeDecision({ livemode: false }, "live").process, false);
  assert.equal(webhookLivemodeDecision({ livemode: false }, "live").ignored, "test mode event");
  assert.equal(webhookLivemodeDecision({}, "live").process, false);

  assert.deepEqual(HANDLED_EVENTS, [
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  assert.equal(SMS_METER_EVENT, "nudge_sms_text");
  assert.equal(LOOKUP.sms.monthly, "nudge_sms_monthly");
  assert.equal(LOOKUP.sms.overage, "nudge_sms_overage_metered");
  assert.equal(LOOKUP.sms.setup, "nudge_sms_setup");
  assert.equal(LOOKUP.solo.base, "nudge_solo_monthly");
  assert.equal(LOOKUP.fleet.extra, "nudge_fleet_extra_driver_monthly");

  const calls = [];
  let payload = { id: "cus_1", object: "customer", livemode: false };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init && init.method, headers: init && init.headers, body: init && init.body });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  const testEnv = { STRIPE_SECRET_KEY: "sk_test_example", STRIPE_API_BASE: "http://127.0.0.1:9" };
  const liveEnv = { STRIPE_SECRET_KEY: "rk_live_example", STRIPE_MODE: "live", STRIPE_API_BASE: "http://127.0.0.1:9" };
  try {
    const customer = await stripe(testEnv, "GET", "/v1/customers/cus_1");
    assert.equal(customer.livemode, false);
    assert.equal(calls[0].url, "http://127.0.0.1:9/v1/customers/cus_1");

    payload = { id: "cus_1", object: "customer", livemode: true };
    await assert.rejects(stripe(testEnv, "GET", "/v1/customers/cus_1"), (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.message, "Stripe returned a live-mode object; stopping.");
      return true;
    });

    payload = { object: "list", data: [{ id: "price_live", livemode: true }] };
    await assert.rejects(stripe(testEnv, "GET", "/v1/prices"), /live-mode object/);

    const beforeBlocked = calls.length;
    await assert.rejects(stripe({ STRIPE_SECRET_KEY: "sk_live_example", STRIPE_API_BASE: "http://127.0.0.1:9" }, "GET", "/v1/customers/cus_1"), (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /until STRIPE_MODE is live/);
      return true;
    });
    assert.equal(calls.length, beforeBlocked);

    payload = { id: "cus_live", object: "customer", livemode: false };
    await assert.rejects(stripe(liveEnv, "GET", "/v1/customers/cus_live"), (error) => {
      assert.equal(error.message, "Stripe returned a test-mode object; stopping.");
      return true;
    });

    payload = { id: "sub_live", object: "subscription", livemode: true, items: { data: [{ id: "si_1", livemode: false }] } };
    await assert.rejects(stripe(liveEnv, "GET", "/v1/subscriptions/sub_live"), /test-mode object/);

    payload = { object: "list", data: [{ id: "price_1", lookup_key: "nudge_sms_monthly", livemode: true }] };
    const prices = await stripe(liveEnv, "GET", "/v1/prices");
    assert.equal(prices.data[0].livemode, true);

    payload = { id: "si_del", object: "subscription_item", deleted: true };
    const deleted = await stripe(liveEnv, "DELETE", "/v1/subscription_items/si_del");
    assert.equal(deleted.deleted, true);

    payload = { id: "mtr_evt", object: "billing.meter_event", livemode: true };
    await reportSmsUsage(liveEnv, "cus_live", "msg_1", 1);
    const meter = calls[calls.length - 1];
    assert.equal(meter.url, "http://127.0.0.1:9/v1/billing/meter_events");
    assert.equal(meter.method, "POST");
    assert.equal(meter.headers.authorization, "Bearer rk_live_example");
    assert.equal(meter.headers["idempotency-key"], "meter-msg_1");
    assert.match(meter.body, /(?:^|&)event_name=nudge_sms_text(?:&|$)/);
    assert.match(meter.body, /payload%5Bstripe_customer_id%5D=cus_live/);
    assert.match(meter.body, /payload%5Bvalue%5D=1/);

    payload = { id: "cus_live", object: "customer", livemode: true };
    await stripe({ ...liveEnv, STRIPE_API_BASE: "https://evil.example" }, "GET", "/v1/customers/cus_live");
    assert.equal(calls[calls.length - 1].url, "https://api.stripe.com/v1/customers/cus_live");
  } finally {
    globalThis.fetch = original;
  }
});

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

async function startWorker(persistTo, vars) {
  return unstable_dev("app/index.js", {
    config: "wrangler.toml",
    local: true,
    persist: true,
    persistTo,
    logLevel: "error",
    vars,
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
}

function startStripeMock() {
  const hits = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const auth = String(req.headers.authorization || "");
      const live = auth.includes("sk_live_") || auth.includes("rk_live_");
      hits.push({ url: req.url, method: req.method, live });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [{ id: "mtr_1", object: "billing.meter", livemode: live, event_name: "nudge_sms_text" }],
        has_more: false,
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        hits,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done, reject) => server.close((err) => (err ? reject(err) : done()))),
      });
    });
  });
}

function invoiceEvent(id, type, livemode) {
  const created = Math.floor(Date.now() / 1000);
  return {
    id,
    type,
    livemode,
    created,
    data: {
      object: {
        object: "invoice",
        customer: "cus_mode",
        subscription: "sub_mode",
        period_end: created + 30 * 24 * 60 * 60,
        lines: { data: [{ period: { end: created + 30 * 24 * 60 * 60 } }] },
      },
    },
  };
}

async function postWebhook(worker, event) {
  const body = JSON.stringify(event);
  const header = await signForTest(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  const response = await worker.fetch("http://127.0.0.1/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text };
  }
  return { status: response.status, data };
}

async function companyBilling(persistTo) {
  const rows = await d1Execute(
    persistTo,
    "SELECT billing_status, stripe_livemode FROM companies WHERE stripe_customer_id = 'cus_mode'",
    { json: true },
  );
  return rows?.[0]?.results?.[0];
}

async function eventRow(persistTo, id) {
  const rows = await d1Execute(
    persistTo,
    "SELECT id, type, livemode, result FROM stripe_events WHERE id = '" + id + "'",
    { json: true },
  );
  return rows?.[0]?.results?.[0] || null;
}

test("webhooks follow the key mode and record livemode", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-stripe-mode-"));
  const mock = await startStripeMock();
  const baseVars = {
    ADMIN_TOKEN: ADMIN,
    SMS_MODE: "off",
    PLATFORM_ADMIN_EMAILS: OWNER_EMAIL,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_API_BASE: mock.url,
  };
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await startWorker(persistTo, { ...baseVars, STRIPE_SECRET_KEY: "sk_test_example" });
    const invite = await call(worker, "/api/admin/invites", {
      method: "POST",
      admin: true,
      body: { email: OWNER_EMAIL, companyName: "Mode Fleet", accountKind: "fleet" },
    });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", {
      method: "POST",
      body: { token: invite.data.inviteToken, password: "sample-owner-pass" },
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
    await d1Execute(
      persistTo,
      "UPDATE companies SET stripe_customer_id = 'cus_mode', stripe_subscription_id = 'sub_mode', billing_status = 'incomplete' WHERE name = 'Mode Fleet'; UPDATE users SET platform_admin = 1 WHERE email = 'mode-owner@example.test';",
    );

    const paid = await postWebhook(worker, invoiceEvent("evt_mode_paid", "invoice.paid", false));
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.result, "paying");
    const paidRow = await eventRow(persistTo, "evt_mode_paid");
    assert.equal(paidRow.livemode, 0);
    assert.equal(paidRow.result, "paying");
    let company = await companyBilling(persistTo);
    assert.equal(company.billing_status, "active");
    assert.equal(company.stripe_livemode, 0);

    const ignoredLive = await postWebhook(worker, invoiceEvent("evt_mode_live_ignored", "invoice.payment_failed", true));
    assert.equal(ignoredLive.status, 200, JSON.stringify(ignoredLive.data));
    assert.equal(ignoredLive.data.ignored, "livemode event");
    assert.equal(await eventRow(persistTo, "evt_mode_live_ignored"), null);
    company = await companyBilling(persistTo);
    assert.equal(company.billing_status, "active");
    assert.equal(company.stripe_livemode, 0);

    const testCheck = await postWebhook(worker, { id: "evt_self_test", type: "nudge.self_check" });
    assert.equal(testCheck.status, 200, JSON.stringify(testCheck.data));
    assert.equal(testCheck.data.selfCheck.keyClass, "sk_test_");
    assert.equal(testCheck.data.selfCheck.mode, "test");
    assert.equal(testCheck.data.selfCheck.testMode, true);
    assert.equal(testCheck.data.selfCheck.stripe, "ok");
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].live, false);

    const testBilling = await call(worker, "/api/platform/billing", { session });
    assert.equal(testBilling.status, 200, JSON.stringify(testBilling.data));
    assert.equal(testBilling.data.stripeConnected, true);
    assert.equal(testBilling.data.testMode, true);
    assert.equal(testBilling.data.mode, "test");
    assert.equal(testBilling.data.problem, "");

    await worker.stop();
    worker = null;

    worker = await startWorker(persistTo, { ...baseVars, STRIPE_SECRET_KEY: "sk_live_example" });
    const hitsBeforeBlocked = mock.hits.length;
    const blocked = await postWebhook(worker, invoiceEvent("evt_mode_blocked", "invoice.paid", true));
    assert.equal(blocked.status, 200, JSON.stringify(blocked.data));
    assert.match(blocked.data.ignored, /until STRIPE_MODE is live/);
    assert.equal(await eventRow(persistTo, "evt_mode_blocked"), null);
    company = await companyBilling(persistTo);
    assert.equal(company.billing_status, "active");
    assert.equal(company.stripe_livemode, 0);
    const blockedCheck = await postWebhook(worker, { id: "evt_self_blocked", type: "nudge.self_check" });
    assert.equal(blockedCheck.data.selfCheck.keyClass, "sk_live_");
    assert.equal(blockedCheck.data.selfCheck.mode, "off");
    assert.equal(blockedCheck.data.selfCheck.stripe, "not-tried");
    assert.equal(mock.hits.length, hitsBeforeBlocked);
    const blockedBilling = await call(worker, "/api/platform/billing", { session });
    assert.equal(blockedBilling.status, 200, JSON.stringify(blockedBilling.data));
    assert.equal(blockedBilling.data.stripeConnected, false);
    assert.equal(blockedBilling.data.testMode, true);
    assert.equal(blockedBilling.data.mode, "off");

    await worker.stop();
    worker = null;

    worker = await startWorker(persistTo, {
      ...baseVars,
      STRIPE_SECRET_KEY: "sk_live_example",
      STRIPE_MODE: "live",
    });
    const failed = await postWebhook(worker, invoiceEvent("evt_mode_failed", "invoice.payment_failed", true));
    assert.equal(failed.status, 200, JSON.stringify(failed.data));
    assert.equal(failed.data.result, "past_due");
    const failedRow = await eventRow(persistTo, "evt_mode_failed");
    assert.equal(failedRow.livemode, 1);
    assert.equal(failedRow.type, "invoice.payment_failed");
    assert.equal(failedRow.result, "past_due");
    company = await companyBilling(persistTo);
    assert.equal(company.billing_status, "past_due");
    assert.equal(company.stripe_livemode, 1);

    const ignoredTest = await postWebhook(worker, invoiceEvent("evt_mode_test_ignored", "invoice.paid", false));
    assert.equal(ignoredTest.data.ignored, "test mode event");
    assert.equal(await eventRow(persistTo, "evt_mode_test_ignored"), null);
    company = await companyBilling(persistTo);
    assert.equal(company.billing_status, "past_due");
    assert.equal(company.stripe_livemode, 1);

    const again = await postWebhook(worker, invoiceEvent("evt_mode_failed", "invoice.payment_failed", true));
    assert.equal(again.data.duplicate, true);

    const liveCheck = await postWebhook(worker, { id: "evt_self_live", type: "nudge.self_check", livemode: true });
    assert.equal(liveCheck.status, 200, JSON.stringify(liveCheck.data));
    assert.equal(liveCheck.data.selfCheck.keyClass, "sk_live_");
    assert.equal(liveCheck.data.selfCheck.mode, "live");
    assert.equal(liveCheck.data.selfCheck.testMode, false);
    assert.equal(liveCheck.data.selfCheck.stripe, "ok");
    assert.equal(liveCheck.data.selfCheck.problem, "");
    assert.equal(mock.hits[mock.hits.length - 1].live, true);
    assert.match(mock.hits[mock.hits.length - 1].url, /\/v1\/billing\/meters/);

    const liveBilling = await call(worker, "/api/platform/billing", { session });
    assert.equal(liveBilling.status, 200, JSON.stringify(liveBilling.data));
    assert.equal(liveBilling.data.stripeConnected, true);
    assert.equal(liveBilling.data.testMode, false);
    assert.equal(liveBilling.data.mode, "live");
    assert.equal(liveBilling.data.problem, "");
  } finally {
    if (worker) await worker.stop();
    await mock.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
