import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;
const CLIENT_ID = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPp-sandbox1";
const SECRET = "EeSecretSecretSecretSecretSecret_9z7Q";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}

async function call(worker, path, { method = "GET", body, session, admin = false, headers: extra = {}, raw } = {}) {
  const headers = { "x-nudge-client": "1", ...extra };
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data, text, cookie: sessionCookie(response, session?.cookie || "") };
}

async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

async function sql(persistTo, text) {
  const file = join(persistTo, "q.sql");
  await writeFile(file, text);
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--file", file, "--json"], { cwd: ROOT, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout)[0].results;
}

async function openOwner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "individual" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  return { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
}

// Local stand-in for api-m.sandbox.paypal.com. Records every request; nothing reaches PayPal.
function startMockPayPal() {
  const state = { requests: [], invoices: new Map(), byRequestId: new Map(), verify: "SUCCESS", nextStatus: "SENT" };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      const auth = req.headers.authorization || "";
      state.requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      if (req.url === "/v1/oauth2/token") {
        const ok = auth === "Basic " + Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64");
        return ok ? send(200, { access_token: "A21-mock-token", expires_in: 32400 }) : send(401, { error: "invalid_client" });
      }
      if (auth !== "Bearer A21-mock-token") return send(401, { name: "AUTHENTICATION_FAILURE" });
      if (req.url === "/v2/invoicing/invoices" && req.method === "POST") {
        const rid = req.headers["paypal-request-id"];
        if (state.byRequestId.has(rid)) return send(200, state.invoices.get(state.byRequestId.get(rid)));
        const id = "INV2-TEST-" + String(state.invoices.size + 1).padStart(4, "0");
        const draft = JSON.parse(body);
        const inv = { id, status: "DRAFT", detail: { ...draft.detail, metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#" + id } }, draft };
        state.invoices.set(id, inv);
        state.byRequestId.set(rid, id);
        return send(201, inv);
      }
      const sendM = /^\/v2\/invoicing\/invoices\/([A-Z0-9-]+)\/send$/.exec(req.url);
      if (sendM && state.invoices.has(sendM[1])) {
        state.invoices.get(sendM[1]).status = "SENT";
        return send(200, { rel: "payer-view", method: "GET", href: "https://www.sandbox.paypal.com/invoice/p/#" + sendM[1] });
      }
      const getM = /^\/v2\/invoicing\/invoices\/([A-Z0-9-]+)$/.exec(req.url);
      if (getM && state.invoices.has(getM[1])) return send(200, { ...state.invoices.get(getM[1]), status: state.nextStatus });
      if (req.url === "/v1/notifications/verify-webhook-signature") return send(200, { verification_status: state.verify });
      return send(404, { name: "RESOURCE_NOT_FOUND" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}


async function startWorker(persistTo, vars) {
  return unstable_dev("app/index.js", {
    config: "wrangler.toml",
    local: true,
    persist: true,
    persistTo,
    logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", ...vars },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
}

test("PayPal credentials: off by default, encrypted at rest, secret never returned", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-paypal-creds-"));
  const mock = await startMockPayPal();
  let worker;
  try {
    await applyMigrations(persistTo);
    // Off by default: the card stays hidden and saving is refused.
    worker = await startWorker(persistTo, {});
    let session = await openOwner(worker, "pp-off@example.test", "Off Limo");
    const off = await call(worker, "/api/paypal/credentials", { session });
    assert.equal(off.status, 200);
    assert.equal(off.data.paypal.enabled, false);
    const refused = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: CLIENT_ID, secret: SECRET } });
    assert.equal(refused.status, 503);
    await worker.stop();

    worker = await startWorker(persistTo, { PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: randomBytes(32).toString("base64"), PAYPAL_API_BASE: mock.base });
    session = await openOwner(worker, "pp-owner@example.test", "PayPal Limo");
    const fresh = await call(worker, "/api/paypal/credentials", { session });
    assert.equal(fresh.data.paypal.enabled, true);
    assert.equal(fresh.data.paypal.configured, false);
    assert.deepEqual(fresh.data.paypal.allowedModes, ["sandbox"]);
    assert.match(fresh.data.paypal.webhookUrl, /\/api\/paypal\/webhook$/);

    const live = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "live", clientId: CLIENT_ID, secret: SECRET } });
    assert.equal(live.status, 400);
    const noCsrf = await call(worker, "/api/paypal/credentials", { method: "PUT", session: { cookie: session.cookie }, body: { mode: "sandbox", clientId: CLIENT_ID, secret: SECRET } });
    assert.equal(noCsrf.status, 403);

    const saved = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: CLIENT_ID, secret: SECRET, webhookId: "WH-1AB23456CD789012E" } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.paypal.configured, true);
    assert.equal(saved.data.paypal.secretLast4, SECRET.slice(-4));
    assert.ok(!saved.text.includes(SECRET), "PUT response must not echo the secret");
    const got = await call(worker, "/api/paypal/credentials", { session });
    assert.ok(!got.text.includes(SECRET), "GET must not return the secret");
    assert.equal(got.data.paypal.webhookId, "WH-1AB23456CD789012E");

    const rows = await sql(persistTo, "SELECT secret_enc, secret_last4, mode FROM paypal_credentials");
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].secret_enc.includes(SECRET) && rows[0].secret_enc.startsWith("v1."));
    assert.equal(rows[0].mode, "sandbox");

    // Blank secret keeps the saved one for the same app.
    const keep = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: CLIENT_ID, secret: "", webhookId: "" } });
    assert.equal(keep.status, 200, JSON.stringify(keep.data));
    assert.equal(keep.data.paypal.webhookId, "");
    assert.equal(keep.data.paypal.secretLast4, SECRET.slice(-4));
    const other = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: "Z".repeat(30), secret: "" } });
    assert.equal(other.status, 400);

    const ok = await call(worker, "/api/paypal/credentials/test", { method: "POST", session, body: {} });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(mock.state.requests.filter((r) => r.path === "/v1/oauth2/token").length, 1);
    const tok = await sql(persistTo, "SELECT token_enc, token_expires_at FROM paypal_credentials");
    assert.ok(tok[0].token_enc.startsWith("v1.") && !tok[0].token_enc.includes("A21-mock-token"));

    const gone = await call(worker, "/api/paypal/credentials", { method: "DELETE", session, body: {} });
    assert.equal(gone.status, 200);
    assert.equal(gone.data.paypal.configured, false);
    assert.equal((await sql(persistTo, "SELECT COUNT(*) AS n FROM paypal_credentials"))[0].n, 0);
  } finally {
    if (worker) await worker.stop();
    mock.server.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
