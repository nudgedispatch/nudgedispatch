import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { signForTest } from "../app/stripe_webhook.js";
import { LOOKUP } from "../app/billing.js";

const ROOT = new URL("..", import.meta.url).pathname;
const WEBHOOK_SECRET = "whsec_signup_test";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}
async function call(worker, path, { method = "GET", body, session, csrf = true } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (csrf && session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || ""), location: response.headers.get("location") || "" };
}
function run(args) {
  const out = [];
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: ROOT, env: { ...process.env, CI: "1" } });
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

function startStripeMock() {
  const hits = [];
  const st = {
    sessionStatus: "complete",
    paymentStatus: "paid",
    subscriptionStatus: "active",
  };
  const card = { id: "pm_signup", object: "payment_method", livemode: false, type: "card", card: { brand: "visa", display_brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030, fingerprint: "fp_s" } };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const body = decodeURIComponent(Buffer.concat(chunks).toString()).replace(/\+/g, " ");
      hits.push({ method: req.method, path: url.pathname, query: decodeURIComponent(url.search), body });
      const send = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      const p = url.pathname;
      if (p === "/v1/prices") {
        const keys = [...url.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
        return send({ object: "list", data: keys.map((k) => ({ id: "price_" + k, object: "price", livemode: false, lookup_key: k, product: "prod_" + k })) });
      }
      if (p === "/v1/checkout/sessions" && req.method === "POST") {
        const signupId = /metadata\[signup_id\]=([^&]+)/.exec(body)?.[1] || "sig";
        return send({
          id: "cs_test_signupsession1",
          object: "checkout.session",
          livemode: false,
          mode: "subscription",
          url: "https://checkout.stripe.com/c/pay/cs_test_signupsession1",
          metadata: { purpose: "signup", signup_id: signupId, plan: "solo", sms: "off" },
        });
      }
      const cs = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(p);
      if (cs) {
        const signupId = new URLSearchParams(hits.find((h) => h.path === "/v1/checkout/sessions" && h.method === "POST")?.body || "").get("metadata[signup_id]") || "sig";
        return send({
          id: cs[1],
          object: "checkout.session",
          livemode: false,
          mode: "subscription",
          status: st.sessionStatus,
          payment_status: st.paymentStatus,
          customer: "cus_signup",
          subscription: { id: "sub_signup", object: "subscription", livemode: false, status: st.subscriptionStatus, customer: "cus_signup", default_payment_method: card },
          metadata: { purpose: "signup", signup_id: signupId, plan: "solo", sms: "off" },
        });
      }
      if (p === "/v1/subscriptions/sub_signup") {
        return send({ id: "sub_signup", object: "subscription", livemode: false, status: st.subscriptionStatus, customer: "cus_signup", default_payment_method: card });
      }
      if (p === "/v1/customers/cus_signup" && req.method === "POST") return send({ id: "cus_signup", object: "customer", livemode: false });
      if (p === "/v1/customers/cus_signup") return send({ id: "cus_signup", object: "customer", livemode: false, invoice_settings: { default_payment_method: card } });
      if (p === "/v1/subscriptions/sub_signup" && req.method === "POST") return send({ id: "sub_signup", object: "subscription", livemode: false, status: "active" });
      return send({ error: { message: "mock: no route " + req.method + " " + p } }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ hits, st, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(() => d())) })));
}

async function postWebhook(worker, event) {
  const body = JSON.stringify(event);
  const header = await signForTest(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  const response = await worker.fetch("http://127.0.0.1/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body });
  const data = JSON.parse(await response.text());
  return { status: response.status, data };
}

const signupBody = {
  companyName: "Peach State Cars",
  ownerName: "Ada Owner",
  email: "ada@example.test",
  password: "sample-owner-pass",
  bookingSlug: "peach-state-cars",
  ownerPhone: "404-555-0100",
  termsAccepted: true,
  slugPermanentConfirmed: true,
  themeColor: "#0f1c2e",
  logoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};

test("self-serve signup: Solo checkout, no setup fee, no SMS, permanent slug, fulfillment", async (t) => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-signup-"));
  const mock = await startStripeMock();
  let worker;
  try {
    await run(["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { SMS_MODE: "off", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_API_BASE: mock.url, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_CARD_PAYMENT_CONFIGURATION: "pmc_cardonlytest1" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });

    const page = await worker.fetch("http://127.0.0.1/signup");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Create your account/);
    assert.match(html, /\/signup\.js/);

    const cfg = await call(worker, "/api/signup/config");
    assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
    assert.equal(cfg.data.plan, "solo");
    assert.equal(cfg.data.smsAllowed, false);
    assert.equal(cfg.data.setupWaived, true);
    assert.match(cfg.data.selfSetupLabel, /setup fee waived/);
    assert.match(cfg.data.assistedSetupText, /\$299 one-time assisted setup/);
    assert.match(cfg.data.assistedSetupMailto, /^mailto:nudgedispatch@gmail\.com\?subject=/);
    assert.match(cfg.data.textingUpgradeNote, /Small fleet and up/);
    assert.equal(cfg.data.bookingHost, "app.nudgedispatch.com");

    const reserved = await call(worker, "/api/signup/slug?slug=login");
    assert.equal(reserved.data.available, false);
    assert.match(reserved.data.error, /reserved/);
    const free = await call(worker, "/api/signup/slug?slug=peach-state-cars");
    assert.equal(free.data.available, true);
    const named = await call(worker, "/api/signup/slug?name=Peach%20State%20Cars");
    assert.equal(named.data.suggestion, "peach-state-cars");

    const noPhone = await call(worker, "/api/signup", { method: "POST", body: { ...signupBody, ownerPhone: "" } });
    assert.equal(noPhone.status, 400);
    assert.match(noPhone.data.error || "", /phone/i);

    const missing = await call(worker, "/api/signup", { method: "POST", body: { ...signupBody, slugPermanentConfirmed: false } });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /can't be changed/);
    const sms = await call(worker, "/api/signup", { method: "POST", body: { ...signupBody, smsAddon: true } });
    assert.equal(sms.status, 400);
    assert.match(sms.data.error, /Small fleet and up/);
    const fleet = await call(worker, "/api/signup", { method: "POST", body: { ...signupBody, plan: "fleet" } });
    assert.equal(fleet.status, 400);

    const started = await call(worker, "/api/signup", { method: "POST", body: signupBody });
    assert.equal(started.status, 201, JSON.stringify(started.data));
    assert.match(started.data.url, /checkout\.stripe\.com/);
    const checkout = mock.hits.find((h) => h.method === "POST" && h.path === "/v1/checkout/sessions");
    assert.ok(checkout);
    assert.match(checkout.body, /mode=subscription/);
    assert.match(checkout.body, /payment_method_configuration=pmc_cardonlytest1/);
    assert.doesNotMatch(checkout.body, /allow_promotion_codes/);
    assert.doesNotMatch(checkout.body, /nudge_setup_solo/);
    assert.doesNotMatch(checkout.body, /nudge_sms_/);
    assert.match(checkout.body, new RegExp(LOOKUP.solo.base.replace(/[.]/g, "[.]")));
    assert.match(checkout.body, /metadata\[sms\]=off/);

    const pending = (await sql(persistTo, "SELECT email, booking_slug, status, sms_addon, plan, theme_color, logo_data_url, owner_phone, business_phone FROM signups", true))[0];
    assert.equal(pending.status, "pending");
    assert.equal(pending.sms_addon, 0);
    assert.equal(pending.plan, "solo");
    assert.equal(pending.booking_slug, "peach-state-cars");
    assert.equal(pending.theme_color, "#0f1c2e");
    assert.match(pending.logo_data_url, /^data:image\/png;base64,/);
    assert.equal(pending.owner_phone, "+14045550100");
    assert.equal(pending.business_phone, "+14045550100");

    const taken = await call(worker, "/api/signup/slug?slug=peach-state-cars");
    assert.equal(taken.data.available, false);

    const done = await call(worker, "/api/signup/complete", { method: "POST", body: { sessionId: "cs_test_signupsession1" } });
    assert.equal(done.status, 201, JSON.stringify(done.data));
    assert.equal(done.data.bookingSlug, "peach-state-cars");
    assert.equal(done.data.role, "owner");
    assert.ok(done.cookie.includes("nudge_session="));

    const company = (await sql(persistTo, "SELECT name, billing_plan, trial_status, setup_fee, booking_slug, sms_addon_enabled, stripe_subscription_id FROM companies WHERE name = 'Peach State Cars'", true))[0];
    assert.equal(company.billing_plan, "solo");
    assert.equal(company.trial_status, "active");
    assert.equal(company.setup_fee, "charge");
    assert.equal(company.booking_slug, "peach-state-cars");
    assert.equal(company.sms_addon_enabled, 0);
    assert.equal(company.stripe_subscription_id, "sub_signup");

    const invoice = (await sql(persistTo, "SELECT theme_color, logo_data_url, phone FROM invoice_settings", true))[0];
    assert.equal(invoice.theme_color, "#0f1c2e");
    assert.match(invoice.logo_data_url, /^data:image\/png;base64,/);
    assert.equal(invoice.phone, "+14045550100");
    const owner = (await sql(persistTo, "SELECT phone FROM users", true))[0];
    assert.equal(owner.phone, "+14045550100");

    const session = { cookie: done.cookie, csrf: done.data.csrf };
    const me = await call(worker, "/api/me", { session });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, "ada@example.test");

    const again = await call(worker, "/api/signup", { method: "POST", body: signupBody });
    assert.equal(again.status, 409);

    const hook = await postWebhook(worker, {
      id: "evt_signup_1",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_test_signupsession1", object: "checkout.session", mode: "subscription", customer: "cus_signup", subscription: "sub_signup", metadata: { purpose: "signup", signup_id: pending && null } } },
    });
    // metadata signup_id is resolved from the retrieved session in the handler; this should be idempotent.
    assert.equal(hook.status, 200, JSON.stringify(hook.data));

    const count = (await sql(persistTo, "SELECT COUNT(*) AS n FROM companies", true))[0].n;
    assert.equal(count, 1);
  } finally {
    if (worker) await worker.stop();
    await mock.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
