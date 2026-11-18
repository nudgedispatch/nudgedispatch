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
