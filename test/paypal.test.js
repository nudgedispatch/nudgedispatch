import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { sealText, openText, validateCredentialsInput, allowedAppModes, paypalServerMode, paypalServerProblem, paypalAccessToken, paypalRequest, TOKEN_MAX_SECONDS } from "../app/paypal.js";

const KEY = randomBytes(32).toString("base64");

// Just enough D1 for the token cache UPDATE.
function fakeDb() {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return { bind: (...args) => ({ run: async () => { writes.push({ sql, args }); return { success: true }; }, first: async () => null }) };
    },
  };
}

test("AES-GCM seal round-trips, hides the plaintext, and is bound to its company", async () => {
  const sealed = await sealText(KEY, "super-secret-value-1234", "nudge-paypal:secret:c1");
  assert.match(sealed, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.ok(!sealed.includes("super-secret"));
  assert.equal(await openText(KEY, sealed, "nudge-paypal:secret:c1"), "super-secret-value-1234");
  await assert.rejects(openText(KEY, sealed, "nudge-paypal:secret:c2"), /Save them again/);
  await assert.rejects(openText(randomBytes(32).toString("base64"), sealed, "nudge-paypal:secret:c1"), /Save them again/);
  await assert.rejects(sealText("short", "x", "a"), /not set up/);
  assert.notEqual(await sealText(KEY, "same", "a"), await sealText(KEY, "same", "a"));
});

test("server mode gates the feature and which app modes a fleet may save", () => {
  assert.equal(paypalServerMode({}), "off");
  assert.equal(paypalServerMode({ PAYPAL_MODE: "LIVE" }), "live");
  assert.equal(paypalServerMode({ PAYPAL_MODE: "nonsense" }), "off");
  assert.deepEqual(allowedAppModes({}), []);
  assert.deepEqual(allowedAppModes({ PAYPAL_MODE: "mock" }), ["sandbox"]);
  assert.deepEqual(allowedAppModes({ PAYPAL_MODE: "sandbox" }), ["sandbox"]);
  assert.deepEqual(allowedAppModes({ PAYPAL_MODE: "live" }), ["sandbox", "live"]);
  assert.match(paypalServerProblem({}), /not turned on/);
  assert.match(paypalServerProblem({ PAYPAL_MODE: "sandbox" }), /not set up/);
  assert.equal(paypalServerProblem({ PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: KEY }), "");
});

test("credential input validation", () => {
  const env = { PAYPAL_MODE: "sandbox" };
  const clientId = "A".repeat(40);
  const secret = "E".repeat(40);
  assert.equal(validateCredentialsInput(env, { mode: "sandbox", clientId, secret }, false).error, "");
  assert.match(validateCredentialsInput(env, { mode: "live", clientId, secret }, false).error, /Live PayPal apps are not allowed/);
  assert.match(validateCredentialsInput(env, { mode: "sandbox", clientId: "short", secret }, false).error, /Client ID/);
  assert.match(validateCredentialsInput(env, { mode: "sandbox", clientId }, false).error, /Secret/);
  assert.equal(validateCredentialsInput(env, { mode: "sandbox", clientId }, true).error, "");
  assert.match(validateCredentialsInput(env, { mode: "sandbox", clientId, secret, webhookId: "bad id!" }, false).error, /Webhook ID/);
  assert.equal(validateCredentialsInput(env, { mode: "sandbox", clientId, secret, webhookId: "8PT597110X687430LKGECATA" }, false).webhookId, "8PT597110X687430LKGECATA");
});

test("OAuth token is fetched once, cached encrypted ~9 hours, and refreshed after a 401", async () => {
  const db = fakeDb();
  const env = { PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: KEY, DB: db };
  const calls = [];
  let tokenN = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      tokenN++;
      assert.equal(init.headers.authorization, "Basic " + Buffer.from("cid:sec").toString("base64"));
      return new Response(JSON.stringify({ access_token: "tok-" + tokenN, expires_in: 99999 }), { status: 200 });
    }
    if (init.headers.authorization === "Bearer tok-1") return new Response(JSON.stringify({ name: "AUTHENTICATION_FAILURE" }), { status: 401 });
    return new Response(JSON.stringify({ ok: 1, auth: init.headers.authorization, rid: init.headers["paypal-request-id"] }), { status: 200 });
  };
  const creds = { companyId: "c1", mode: "sandbox", clientId: "cid", secret: "sec", tokenEnc: "", tokenExpiresAt: 0 };
  const now = 1_700_000_000_000;
  assert.equal(await paypalAccessToken(env, creds, { fetchImpl, now }), "tok-1");
  assert.equal(creds.tokenExpiresAt, now + TOKEN_MAX_SECONDS * 1000);
  assert.ok(!creds.tokenEnc.includes("tok-1"));
  assert.equal(db.writes.length, 1);
  assert.equal(await paypalAccessToken(env, creds, { fetchImpl, now: now + 8 * 3600 * 1000 }), "tok-1");
  assert.equal(tokenN, 1);
  assert.equal(calls[0].url, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
  const data = await paypalRequest(env, creds, "GET", "/v2/invoicing/invoices/X", undefined, { fetchImpl, now, requestId: "rid-1" });
  assert.equal(data.auth, "Bearer tok-2");
  assert.equal(data.rid, "rid-1");
  assert.equal(tokenN, 2);
  // Within 5 minutes of expiry a new token is fetched.
  await paypalAccessToken(env, creds, { fetchImpl, now: creds.tokenExpiresAt - 60 * 1000 });
  assert.equal(tokenN, 3);
});

test("bad client credentials give a plain message, never the secret", async () => {
  const env = { PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: KEY, DB: fakeDb() };
  const fetchImpl = async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
  const creds = { companyId: "c1", mode: "sandbox", clientId: "cid", secret: "do-not-leak-me", tokenEnc: "", tokenExpiresAt: 0 };
  await assert.rejects(paypalAccessToken(env, creds, { fetchImpl }), (error) => /Client ID and Secret/.test(error.message) && !error.message.includes("do-not-leak"));
});

test("draft invoice: Nudge number, one Car service line, tips on, no tax, rider email required", async () => {
  const { buildPayPalInvoice, safePayerUrl } = await import("../app/paypal.js");
  const draft = buildPayPalInvoice({ number: "TGS-1001", amountCents: 12550, issuedOn: "2026-11-18", billName: "Avery Cole", billEmail: "avery@example.test", trip: { date: "2026-11-18", time: "09:30", pickup: "Hotel", dropoff: "Airport" }, businessName: "TGS Limo", terms: "Due on receipt." });
  assert.equal(draft.detail.invoice_number, "TGS-1001");
  assert.equal(draft.detail.currency_code, "USD");
  assert.equal(draft.detail.invoice_date, "2026-11-18");
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].name, "Car service");
  assert.equal(draft.items[0].unit_amount.value, "125.50");
  assert.equal(draft.items[0].tax, undefined);
  assert.equal(draft.configuration.allow_tip, true);
  assert.equal(draft.primary_recipients[0].billing_info.email_address, "avery@example.test");
  assert.throws(() => buildPayPalInvoice({ number: "X", amountCents: 100, billEmail: "" }), /rider's email/);
  assert.throws(() => buildPayPalInvoice({ number: "X", amountCents: 0, billEmail: "a@b.co" }), /no amount/);
  assert.equal(safePayerUrl("https://www.sandbox.paypal.com/invoice/p/#INV2-AAAA"), "https://www.sandbox.paypal.com/invoice/p/#INV2-AAAA");
  assert.equal(safePayerUrl("https://evil.example/paypal.com"), "");
  assert.equal(safePayerUrl("javascript:alert(1)"), "");
});

test("create + send uses the Nudge invoice id as PayPal-Request-Id and reuses an existing draft", async () => {
  const { createAndSendInvoice } = await import("../app/paypal.js");
  const env = { PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: KEY, DB: fakeDb() };
  const seen = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    seen.push({ path, rid: init.headers["paypal-request-id"], body: init.body });
    if (path === "/v1/oauth2/token") return new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 });
    if (path === "/v2/invoicing/invoices") return new Response(JSON.stringify({ id: "INV2-ABCD-1234", status: "DRAFT" }), { status: 201 });
    if (path.endsWith("/send")) return new Response(JSON.stringify({ href: "https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-1234" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const creds = { companyId: "c1", mode: "sandbox", clientId: "cid", secret: "sec", tokenEnc: "", tokenExpiresAt: 0 };
  const drafts = [];
  const out = await createAndSendInvoice(env, creds, "11111111-2222-3333-4444-555555555555", { detail: {} }, { fetchImpl, onDraft: async (id, st) => drafts.push([id, st]) });
  assert.deepEqual(out, { id: "INV2-ABCD-1234", status: "SENT", payerUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-1234" });
  assert.deepEqual(drafts, [["INV2-ABCD-1234", "DRAFT"]]);
  assert.equal(seen.find((r) => r.path === "/v2/invoicing/invoices").rid, "11111111-2222-3333-4444-555555555555");
  assert.equal(seen.find((r) => r.path.endsWith("/send")).rid, "11111111-2222-3333-4444-555555555555-send");
  assert.deepEqual(JSON.parse(seen.find((r) => r.path.endsWith("/send")).body), { send_to_invoicer: false, send_to_recipient: true });
  seen.length = 0;
  await createAndSendInvoice(env, creds, "11111111-2222-3333-4444-555555555555", { detail: {} }, { fetchImpl, existingId: "INV2-ABCD-1234" });
  assert.equal(seen.some((r) => r.path === "/v2/invoicing/invoices"), false);
});

test("mock PayPal (preview) needs no network and is deterministic", async () => {
  const { mockPayPal } = await import("../app/paypal-mock.js");
  assert.equal(mockPayPal("POST", "/v1/oauth2/token", { authorization: "Basic x" }).status, 200);
  const a = mockPayPal("POST", "/v2/invoicing/invoices", { authorization: "Bearer t", "paypal-request-id": "abc-123" }, "{}");
  const b = mockPayPal("POST", "/v2/invoicing/invoices", { authorization: "Bearer t", "paypal-request-id": "abc-123" }, "{}");
  assert.equal(a.data.id, b.data.id);
  assert.equal(mockPayPal("GET", "/v2/invoicing/invoices/X", {}).status, 401);
});

test("PayPal status mapping: paid only when fully paid, refunds flag only, cancelled changes nothing", async () => {
  const { payPalOutcome, eventInvoice } = await import("../app/paypal.js");
  assert.deepEqual(payPalOutcome({ status: "PAID" }), { status: "PAID", paid: true, refunded: false });
  assert.equal(payPalOutcome({ status: "MARKED_AS_PAID" }).paid, true);
  assert.equal(payPalOutcome({ status: "PAID", due_amount: { value: "10.00" } }).paid, false);
  assert.equal(payPalOutcome({ status: "PARTIALLY_PAID" }).paid, false);
  assert.deepEqual(payPalOutcome({ status: "CANCELLED" }), { status: "CANCELLED", paid: false, refunded: false });
  assert.deepEqual(payPalOutcome({ status: "REFUNDED" }), { status: "REFUNDED", paid: false, refunded: true });
  assert.equal(payPalOutcome({ status: "PARTIALLY_REFUNDED" }).refunded, true);
  assert.equal(eventInvoice({ event_type: "INVOICING.INVOICE.CANCELLED", resource: { id: "INV2-AAAA-BBBB" } }).status, "CANCELLED");
  assert.equal(eventInvoice({ event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: "INV2-AAAA-BBBB", status: "PAID" } } }).id, "INV2-AAAA-BBBB");
  assert.equal(eventInvoice({ event_type: "INVOICING.INVOICE.PAID", resource: { id: "bad id" } }), null);
});
