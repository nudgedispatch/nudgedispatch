// Setup-fee choice + client payment method, end to end on a local Worker with a mocked Stripe (test mode).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { signForTest } from "../app/stripe_webhook.js";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;
const PLATFORM_EMAIL = "platform@example.test";
const WEBHOOK_SECRET = "whsec_pm_test";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}
async function call(worker, path, { method = "GET", body, session, admin = false, csrf = true } = {}) {
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
async function openOwner(worker, email, companyName, accountKind = "fleet") {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  return { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
}

// Minimal stateful Stripe (test mode). Records every request; never talks to Stripe.
function startStripeMock() {
  const hits = [];
  const st = {
    customerPm: null,
    subPm: null,
    invoice: { id: "in_first", object: "invoice", livemode: false, status: "open", amount_due: 5900, currency: "usd", hosted_invoice_url: "https://invoice.stripe.com/i/acct_x/test_first" },
    betaCoversSms: false,
    payStatus: "paid",
  };
  const card = (id, last4) => ({ id, object: "payment_method", livemode: false, type: "card", card: { brand: "visa", display_brand: "visa", last4, exp_month: 4, exp_year: 2030, fingerprint: "fp_x" } });
  const PRODUCTS = { nudge_setup_small: "prod_setup_small", nudge_sms_setup: "prod_sms_setup" };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const body = decodeURIComponent(Buffer.concat(chunks).toString()).replace(/\+/g, " ");
      const query = decodeURIComponent(url.search);
      hits.push({ method: req.method, path: url.pathname, query, body });
      const send = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      const p = url.pathname;
      if (p === "/v1/prices") {
        const keys = [...url.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
        return send({ object: "list", data: keys.map((k) => ({ id: "price_" + k, object: "price", livemode: false, lookup_key: k, product: PRODUCTS[k] || "prod_" + k })) });
      }
      if (p === "/v1/promotion_codes") {
        const code = url.searchParams.get("code");
        if (code === "FREESETUP") return send({ object: "list", data: [{ id: "promo_free", object: "promotion_code", livemode: false, code, promotion: { type: "coupon", coupon: "cpn_free" } }] });
        if (code === "BETA50") return send({ object: "list", data: [{ id: "promo_beta", object: "promotion_code", livemode: false, code, promotion: { type: "coupon", coupon: "cpn_beta" } }] });
        return send({ object: "list", data: [] });
      }
      if (p === "/v1/coupons/cpn_free") return send({ id: "cpn_free", object: "coupon", livemode: false, percent_off: 100, applies_to: { products: ["prod_setup_small", "prod_sms_setup"] } });
      if (p === "/v1/coupons/cpn_beta") return send({ id: "cpn_beta", object: "coupon", livemode: false, percent_off: 50, applies_to: { products: ["prod_setup_small", ...(st.betaCoversSms ? ["prod_sms_setup"] : [])] } });
      if (p === "/v1/customers" && req.method === "POST") return send({ id: "cus_pm", object: "customer", livemode: false });
      if (p === "/v1/subscriptions" && req.method === "POST") return send({ id: "sub_pm", object: "subscription", livemode: false, status: "incomplete", customer: "cus_pm", latest_invoice: st.invoice });
      if (p === "/v1/subscriptions/sub_pm" && req.method === "GET") {
        return send({ id: "sub_pm", object: "subscription", livemode: false, status: st.invoice.status === "open" ? "incomplete" : "active", customer: "cus_pm", items: { data: [] }, default_payment_method: st.subPm ? card(st.subPm, "4242") : null, latest_invoice: st.invoice });
      }
      if (p === "/v1/subscriptions/sub_pm" && req.method === "POST") { st.subPm = /default_payment_method=(pm_\w+)/.exec(body)?.[1] || st.subPm; return send({ id: "sub_pm", object: "subscription", livemode: false, status: "incomplete" }); }
      if (p === "/v1/customers/cus_pm" && req.method === "GET") return send({ id: "cus_pm", object: "customer", livemode: false, invoice_settings: { default_payment_method: st.customerPm ? card(st.customerPm, "4242") : null } });
      if (p === "/v1/customers/cus_pm" && req.method === "POST") { st.customerPm = /invoice_settings\[default_payment_method\]=(pm_\w+)/.exec(body)?.[1] || st.customerPm; return send({ id: "cus_pm", object: "customer", livemode: false }); }
      if (p === "/v1/checkout/sessions" && req.method === "POST") return send({ id: "cs_test_abcdefghijkl", object: "checkout.session", livemode: false, url: "https://checkout.stripe.com/c/pay/cs_test_abcdefghijkl" });
      const cs = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(p);
      if (cs) {
        const other = cs[1].includes("other");
        const pm = cs[1].includes("link") ? { id: "pm_link", object: "payment_method", livemode: false, type: "link", link: { email: "x@example.test" } } : card("pm_new", "4242");
        return send({ id: cs[1], object: "checkout.session", livemode: false, mode: "setup", status: "complete", customer: other ? "cus_someone_else" : "cus_pm", setup_intent: { id: "seti_1", object: "setup_intent", livemode: false, status: "succeeded", payment_method: pm } });
      }
      if (/^\/v1\/payment_methods\/pm_\w+\/detach$/.test(p)) { st.detached = (st.detached || []).concat(p.split("/")[3]); return send({ id: p.split("/")[3], object: "payment_method", livemode: false }); }
      if (p === "/v1/invoices/in_first/pay") { st.invoice = { ...st.invoice, status: st.payStatus, amount_paid: st.payStatus === "paid" ? 5900 : 0 }; return send(st.invoice); }
      if (p === "/v1/subscription_items" && req.method === "POST") return send({ id: "si_" + hits.length, object: "subscription_item", livemode: false });
      if (p === "/v1/invoiceitems" && req.method === "POST") return send({ id: "ii_1", object: "invoiceitem", livemode: false });
      return send({ error: { message: "mock: no route " + req.method + " " + p } }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ hits, st, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(() => d())) })));
}

async function postWebhook(worker, event) {
  const body = JSON.stringify(event);
  const header = await signForTest(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  const response = await worker.fetch("http://127.0.0.1/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body });
  return { status: response.status, data: await response.json() };
}

test("setup fee choice and client card flow (mocked Stripe test mode)", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-billing-pm-"));
  const mock = await startStripeMock();
  let worker;
  try {
    await run(["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", PLATFORM_ADMIN_EMAILS: PLATFORM_EMAIL, STRIPE_SECRET_KEY: "sk_test_example", STRIPE_API_BASE: mock.url, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_CARD_PAYMENT_CONFIGURATION: "pmc_cardonlytest1" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const platform = await openOwner(worker, PLATFORM_EMAIL, "Platform Holder");
    await sql(persistTo, `UPDATE users SET platform_admin = 1 WHERE email = '${PLATFORM_EMAIL}';`);
    const owner = await openOwner(worker, "client@example.test", "Client Fleet");
    const companyId = (await sql(persistTo, "SELECT id, setup_fee FROM companies WHERE name = 'Client Fleet'", true))[0];
    assert.equal(companyId.setup_fee, "free", "existing/new companies default to free");
    const id = companyId.id;

    // Owner before billing starts: "Billing not started yet", no Stripe calls.
    const before = mock.hits.length;
    const notStarted = await call(worker, "/api/billing/payment-method", { session: owner });
    assert.equal(notStarted.status, 200, JSON.stringify(notStarted.data));
    assert.equal(notStarted.data.started, false);
    assert.match(notStarted.data.message, /Billing not started yet/);
    const noSession = await call(worker, "/api/billing/payment-method/session", { method: "POST", session: owner, body: {} });
    assert.equal(noSession.status, 409);
    assert.equal(mock.hits.length, before);

    // Setup-fee change: platform only, validated, audited.
    const ownerTries = await call(worker, `/api/platform/companies/${id}/setup-fee`, { method: "POST", session: owner, body: { setupFee: "charge" } });
    assert.equal(ownerTries.status, 404);
    const bad = await call(worker, `/api/platform/companies/${id}/setup-fee`, { method: "POST", session: platform, body: { setupFee: "half" } });
    assert.equal(bad.status, 400);
    const toCharge = await call(worker, `/api/platform/companies/${id}/setup-fee`, { method: "POST", session: platform, body: { setupFee: "charge" } });
    assert.equal(toCharge.status, 200, JSON.stringify(toCharge.data));
    assert.equal(toCharge.data.billing.setupFee, "charge");
    const audit = await sql(persistTo, "SELECT action, detail FROM admin_audit WHERE action = 'billing.setup_fee'", true).catch(async () => sql(persistTo, "SELECT * FROM admin_audit WHERE action = 'billing.setup_fee'", true));
    assert.equal(audit.length, 1);
    assert.match(JSON.stringify(audit[0]), /charge/);

    // Start subscription with no setupFee in the body: default form value is free -> FREESETUP on the setup item.
    const started = await call(worker, `/api/platform/companies/${id}/subscription`, { method: "POST", session: platform, body: { setupFee: "free" } });
    assert.equal(started.status, 201, JSON.stringify(started.data));
    assert.equal(started.data.setupFee, "free");
    const subPost = mock.hits.find((h) => h.method === "POST" && h.path === "/v1/subscriptions");
    assert.match(subPost.body, /add_invoice_items\[0\]\[discounts\]\[0\]\[promotion_code\]=promo_free/);
    assert.doesNotMatch(subPost.body, /(^|&)items\[\d\]\[discounts\]/);
    assert.match(subPost.body, /metadata\[setup_fee\]=free/);
    const row = (await sql(persistTo, `SELECT setup_fee, stripe_customer_id, billing_status FROM companies WHERE id = '${id}'`, true))[0];
    assert.deepEqual(row, { setup_fee: "free", stripe_customer_id: "cus_pm", billing_status: "incomplete" });
    const subAudit = await sql(persistTo, "SELECT * FROM admin_audit WHERE action = 'billing.subscribe'", true);
    assert.match(JSON.stringify(subAudit[0]), /setup_fee/);

    // Owner sees the open first invoice and no card yet.
    const view = await call(worker, "/api/billing/payment-method", { session: owner });
    assert.equal(view.data.started, true);
    assert.equal(view.data.paymentMethod, null);
    assert.equal(view.data.openInvoice.amountDue, 5900);
    assert.match(view.data.openInvoice.url, /^https:\/\/invoice\.stripe\.com\//);
    const payNoCard = await call(worker, "/api/billing/pay-invoice", { method: "POST", session: owner, body: {} });
    assert.equal(payNoCard.status, 409);
    assert.match(payNoCard.data.error, /Add a card/);

    // CSRF required; platform admins don't get owner billing.
    const noCsrf = await call(worker, "/api/billing/payment-method/session", { method: "POST", session: owner, body: {}, csrf: false });
    assert.equal(noCsrf.status, 403);
    const platformView = await call(worker, "/api/billing/payment-method", { session: platform });
    assert.equal(platformView.status, 404);

    // Add card: Stripe Checkout in setup mode for this customer.
    const opened = await call(worker, "/api/billing/payment-method/session", { method: "POST", session: owner, body: {} });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assert.match(opened.data.url, /^https:\/\/checkout\.stripe\.com\//);
    const csPost = mock.hits.filter((h) => h.path === "/v1/checkout/sessions" && h.method === "POST").pop();
    assert.match(csPost.body, /(^|&)mode=setup(&|$)/);
    assert.match(csPost.body, /(^|&)customer=cus_pm(&|$)/);
    assert.doesNotMatch(csPost.body, /(^|&)payment_method_types\[/, "the pinned API version refuses payment_method_types");
    assert.match(csPost.body, /(^|&)payment_method_configuration=pmc_cardonlytest1(&|$)/, "cards only via the card-only config");
    assert.doesNotMatch(csPost.body, /excluded_payment_method_types/);
    assert.match(csPost.body, /success_url=http:\/\/127\.0\.0\.1\/\?card_session=\{CHECKOUT_SESSION_ID\}#\/settings/);

    // Return from Stripe: a session for another customer is refused; ours sets the default card.
    const badId = await call(worker, "/api/billing/payment-method/confirm", { method: "POST", session: owner, body: { sessionId: "not-a-session" } });
    assert.equal(badId.status, 400);
    const foreign = await call(worker, "/api/billing/payment-method/confirm", { method: "POST", session: owner, body: { sessionId: "cs_test_otherxxxxxxxx" } });
    assert.equal(foreign.status, 409);
    assert.equal(mock.st.customerPm, null);
    // Cards only: a Link payment method from the setup page is refused, detached, and never made the default.
    const linkTry = await call(worker, "/api/billing/payment-method/confirm", { method: "POST", session: owner, body: { sessionId: "cs_test_linkxxxxxxxxx" } });
    assert.equal(linkTry.status, 409, JSON.stringify(linkTry.data));
    assert.match(linkTry.data.error, /Only a credit or debit card/);
    assert.deepEqual(mock.st.detached, ["pm_link"]);
    assert.equal(mock.st.customerPm, null);
    assert.equal(mock.st.subPm, null);
    const confirmed = await call(worker, "/api/billing/payment-method/confirm", { method: "POST", session: owner, body: { sessionId: "cs_test_abcdefghijkl" } });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.deepEqual(confirmed.data.paymentMethod, { brand: "visa", last4: "4242", expMonth: 4, expYear: 2030 });
    assert.equal(mock.st.customerPm, "pm_new");
    assert.equal(mock.st.subPm, "pm_new");
    const stored = (await sql(persistTo, `SELECT pm_brand, pm_last4, pm_exp_month, pm_exp_year FROM companies WHERE id = '${id}'`, true))[0];
    assert.deepEqual(stored, { pm_brand: "visa", pm_last4: "4242", pm_exp_month: 4, pm_exp_year: 2030 });
    const dump = JSON.stringify(await sql(persistTo, `SELECT * FROM companies WHERE id = '${id}'`, true));
    assert.doesNotMatch(dump, /pm_new|fp_x/, "no payment method id or fingerprint in D1");

    // Pay the open first invoice with the saved card.
    const paid = await call(worker, "/api/billing/pay-invoice", { method: "POST", session: owner, body: {} });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.paid, true);
    assert.ok(mock.hits.some((h) => h.path === "/v1/invoices/in_first/pay" && h.method === "POST"));

    // Webhook: checkout.session.completed (setup) also saves the card (closed-tab case).
    await sql(persistTo, `UPDATE companies SET pm_last4 = NULL, pm_brand = NULL WHERE id = '${id}'`);
    const hook = await postWebhook(worker, { id: "evt_cs_1", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { id: "cs_test_abcdefghijkl", object: "checkout.session", mode: "setup", customer: "cus_pm" } } });
    assert.equal(hook.status, 200, JSON.stringify(hook.data));
    assert.equal(hook.data.result, "card saved");
    assert.equal((await sql(persistTo, `SELECT pm_last4 FROM companies WHERE id = '${id}'`, true))[0].pm_last4, "4242");
    const payHook = await postWebhook(worker, { id: "evt_cs_2", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { id: "cs_test_payment", object: "checkout.session", mode: "payment", customer: "cus_pm" } } });
    assert.match(payHook.data.result, /not a card setup/);

    // Beta pays the FULL texting setup fee (Jesse, Nov 16): no promo lookup, no discount, texting turns on.
    await sql(persistTo, `UPDATE companies SET billing_status = 'active' WHERE id = '${id}'`);
    await call(worker, `/api/platform/companies/${id}/setup-fee`, { method: "POST", session: platform, body: { setupFee: "beta" } });
    const promoLookups = mock.hits.filter((h) => h.path === "/v1/promotion_codes").length;
    const betaOn = await call(worker, `/api/platform/companies/${id}/sms`, { method: "POST", session: platform, body: { enabled: true } });
    assert.equal(betaOn.status, 200, JSON.stringify(betaOn.data));
    assert.equal(mock.hits.filter((h) => h.path === "/v1/promotion_codes").length, promoLookups);
    const ii = mock.hits.filter((h) => h.path === "/v1/invoiceitems").pop();
    assert.match(ii.body, /pricing\[price\]=price_nudge_sms_setup/);
    assert.doesNotMatch(ii.body, /discounts/);
  } finally {
    if (worker) await worker.stop();
    await mock.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("charge setup and legacy beta on start subscription", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-billing-fee-"));
  const mock = await startStripeMock();
  let worker;
  try {
    await run(["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", PLATFORM_ADMIN_EMAILS: PLATFORM_EMAIL, STRIPE_SECRET_KEY: "sk_test_example", STRIPE_API_BASE: mock.url },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const platform = await openOwner(worker, PLATFORM_EMAIL, "Platform Holder");
    await sql(persistTo, `UPDATE users SET platform_admin = 1 WHERE email = '${PLATFORM_EMAIL}';`);
    await openOwner(worker, "a@example.test", "Paying Client");
    await openOwner(worker, "b@example.test", "Beta Client");
    const ids = Object.fromEntries((await sql(persistTo, "SELECT id, name FROM companies", true)).map((r) => [r.name, r.id]));

    const charged = await call(worker, `/api/platform/companies/${ids["Paying Client"]}/subscription`, { method: "POST", session: platform, body: { setupFee: "charge" } });
    assert.equal(charged.status, 201, JSON.stringify(charged.data));
    let sub = mock.hits.filter((h) => h.path === "/v1/subscriptions" && h.method === "POST").pop();
    assert.doesNotMatch(sub.body, /discounts/);
    assert.equal(mock.hits.filter((h) => h.path === "/v1/promotion_codes").length, 0);

    const legacy = await call(worker, `/api/platform/companies/${ids["Beta Client"]}/subscription`, { method: "POST", session: platform, body: { beta: true } });
    assert.equal(legacy.status, 201, JSON.stringify(legacy.data));
    assert.equal(legacy.data.setupFee, "beta");
    sub = mock.hits.filter((h) => h.path === "/v1/subscriptions" && h.method === "POST").pop();
    assert.match(sub.body, /add_invoice_items\[0\]\[discounts\]\[0\]\[promotion_code\]=promo_beta/);
    const rows = Object.fromEntries((await sql(persistTo, "SELECT name, setup_fee FROM companies", true)).map((r) => [r.name, r.setup_fee]));
    assert.equal(rows["Paying Client"], "charge");
    assert.equal(rows["Beta Client"], "beta");

    // Free: the texting setup fee gets FREESETUP when texting is turned on.
    mock.st.invoice = { ...mock.st.invoice, status: "paid" };
    await sql(persistTo, `UPDATE companies SET billing_status = 'active', setup_fee = 'free' WHERE id = '${ids["Paying Client"]}'`);
    const smsOn = await call(worker, `/api/platform/companies/${ids["Paying Client"]}/sms`, { method: "POST", session: platform, body: { enabled: true } });
    assert.equal(smsOn.status, 200, JSON.stringify(smsOn.data));
    const ii = mock.hits.filter((h) => h.path === "/v1/invoiceitems").pop();
    assert.match(ii.body, /pricing\[price\]=price_nudge_sms_setup/);
    assert.match(ii.body, /discounts\[0\]\[promotion_code\]=promo_free/);
  } finally {
    if (worker) await worker.stop();
    await mock.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
