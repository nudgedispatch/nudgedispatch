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


async function startWorker(persistTo, vars, extra = {}) {
  return unstable_dev("app/index.js", {
    ...extra,
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

async function readyInvoice(worker, session, { email = "avery@example.test", paypalLink = true } = {}) {
  const saved = await call(worker, "/api/settings", { method: "PUT", session, body: { businessName: "PayPal Limo", prefix: "PPL-", paymentMethods: { cash: { on: true }, paypal: { on: paypalLink, handle: "paypal.me/PPLimo" } } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199", email } });
  assert.equal(client.status, 201, JSON.stringify(client.data));
  const ride = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: "2026-11-18", time: "09:30", pickup: "Hotel", dropoff: "Airport", passengers: 1, fare: "125" } });
  assert.equal(ride.status, 201, JSON.stringify(ride.data));
  let from = "";
  for (const step of ["En route", "Arrived", "Picked up", "Completed"]) {
    const moved = await call(worker, "/api/rides/" + ride.data.ride.id + "/progress", { method: "POST", session, body: { step, from } });
    assert.equal(moved.status, 200, step + " " + JSON.stringify(moved.data));
    from = step;
  }
  const made = await call(worker, "/api/rides/" + ride.data.ride.id + "/invoice", { method: "POST", session, body: {} });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  return { invoice: made.data.invoice, rideId: ride.data.ride.id, clientId: client.data.client.id };
}

test("Send PayPal invoice: explicit, idempotent, rider email required, hides the plain PayPal link", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-paypal-send-"));
  const mock = await startMockPayPal();
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await startWorker(persistTo, { PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: randomBytes(32).toString("base64"), PAYPAL_API_BASE: mock.base });
    const session = await openOwner(worker, "pp-send@example.test", "PayPal Limo");
    const { invoice, clientId } = await readyInvoice(worker, session, { email: "" });
    assert.equal(invoice.paypal.available, false);
    assert.equal(invoice.paypal.sent, false);
    assert.deepEqual(invoice.payWith.map((o) => o.kind), ["paypal", "cash"]);
    const notConnected = await call(worker, "/api/invoices/" + invoice.id + "/paypal", { method: "POST", session, body: {} });
    assert.equal(notConnected.status, 400);

    const creds = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: CLIENT_ID, secret: SECRET } });
    assert.equal(creds.status, 200, JSON.stringify(creds.data));
    assert.equal((await call(worker, "/api/invoices/" + invoice.id, { session })).data.invoice.paypal.available, true);

    const noEmail = await call(worker, "/api/invoices/" + invoice.id + "/paypal", { method: "POST", session, body: {} });
    assert.equal(noEmail.status, 400);
    assert.match(noEmail.data.error, /email/);
    assert.equal(mock.state.requests.length, 0, "no PayPal call without a rider email");

    // Email added to the client later is picked up.
    const patched = await call(worker, "/api/clients/" + clientId, { method: "PATCH", session, body: { name: "Avery Cole", phone: "404-555-0199", email: "avery@example.test" } });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    const sent = await call(worker, "/api/invoices/" + invoice.id + "/paypal", { method: "POST", session, body: {} });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const pp = sent.data.invoice.paypal;
    assert.equal(pp.sent, true);
    assert.equal(pp.status, "SENT");
    assert.equal(pp.invoiceId, "INV2-TEST-0001");
    assert.equal(pp.payerUrl, "https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-0001");
    assert.equal(sent.data.invoice.billTo.email, "avery@example.test");
    assert.deepEqual(sent.data.invoice.payWith.map((o) => o.kind), ["paypal_invoice", "cash"]);
    assert.ok(!sent.data.invoice.snapshotText.includes("paypal.me"), "plain PayPal link hidden from the invoice text");
    assert.ok(!sent.text.includes(SECRET));

    const create = mock.state.requests.find((r) => r.path === "/v2/invoicing/invoices");
    assert.equal(create.headers["paypal-request-id"], invoice.id);
    const draft = JSON.parse(create.body);
    assert.equal(draft.detail.invoice_number, "PPL-1001");
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].name, "Car service");
    assert.equal(draft.items[0].unit_amount.value, "125.00");
    assert.equal(draft.configuration.allow_tip, true);
    assert.equal(draft.primary_recipients[0].billing_info.email_address, "avery@example.test");
    assert.equal(mock.state.requests.find((r) => r.path.endsWith("/send")).headers["paypal-request-id"], invoice.id + "-send");

    // A second tap does not create or send again.
    const before = mock.state.requests.length;
    const again = await call(worker, "/api/invoices/" + invoice.id + "/paypal", { method: "POST", session, body: {} });
    assert.equal(again.status, 200);
    assert.equal(mock.state.requests.length, before);
    assert.equal(mock.state.invoices.size, 1);
    const rows = await sql(persistTo, "SELECT paypal_invoice_id, paypal_status, paypal_mode FROM invoices");
    assert.deepEqual(rows[0], { paypal_invoice_id: "INV2-TEST-0001", paypal_status: "SENT", paypal_mode: "sandbox" });
  } finally {
    if (worker) await worker.stop();
    mock.server.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});

async function hook(worker, event, sig = "sig-from-paypal") {
  const response = await worker.fetch("http://127.0.0.1/api/paypal/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT", "paypal-transmission-id": "tx-" + event.id, "paypal-transmission-sig": sig, "paypal-transmission-time": "2026-11-18T13:00:00Z" },
    body: JSON.stringify(event),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
const evt = (id, type, resource) => ({ id, event_type: type, resource_type: "invoices", resource });

test("PayPal webhook: verified by PayPal, idempotent, paid only when fully paid; cron backup", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-paypal-hook-"));
  const mock = await startMockPayPal();
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await startWorker(persistTo, { PAYPAL_MODE: "sandbox", PAYPAL_CREDENTIALS_KEY: randomBytes(32).toString("base64"), PAYPAL_API_BASE: mock.base }, { testScheduled: true });
    const session = await openOwner(worker, "pp-hook@example.test", "PayPal Limo");
    const creds = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: CLIENT_ID, secret: SECRET, webhookId: "WH-1AB23456CD789012E" } });
    assert.equal(creds.status, 200, JSON.stringify(creds.data));
    const sendOne = async () => {
      const ready = await readyInvoice(worker, session);
      const sent = await call(worker, "/api/invoices/" + ready.invoice.id + "/paypal", { method: "POST", session, body: {} });
      assert.equal(sent.status, 200, JSON.stringify(sent.data));
      return { ...ready, ppId: sent.data.invoice.paypal.invoiceId };
    };
    const payment = async (rideId) => (await call(worker, "/api/rides/" + rideId, { session })).data.ride.payment;
    const a = await sendOne();
    const b = await sendOne();
    const c = await sendOne();

    // Bad signature: PayPal says FAILURE, nothing recorded.
    mock.state.verify = "FAILURE";
    assert.equal((await hook(worker, evt("WH-EVT-0", "INVOICING.INVOICE.PAID", { id: a.ppId, status: "PAID" }))).status, 400);
    assert.equal(await payment(a.rideId), "invoiced");
    assert.equal((await sql(persistTo, "SELECT COUNT(*) AS n FROM paypal_events"))[0].n, 0);
    mock.state.verify = "SUCCESS";
    const verifyCall = mock.state.requests.filter((r) => r.path === "/v1/notifications/verify-webhook-signature").at(-1);
    const verifyBody = JSON.parse(verifyCall.body);
    assert.equal(verifyBody.webhook_id, "WH-1AB23456CD789012E");
    assert.equal(verifyBody.transmission_sig, "sig-from-paypal");
    assert.equal(verifyBody.webhook_event.id, "WH-EVT-0");

    // Not handled / unknown invoice: 200, ignored.
    assert.equal((await hook(worker, evt("WH-EVT-X", "INVOICING.INVOICE.CREATED", { id: a.ppId }))).data.ignored, "event type not handled");
    assert.equal((await hook(worker, evt("WH-EVT-Y", "INVOICING.INVOICE.PAID", { id: "INV2-NOPE-0000" }))).data.ignored, "unknown invoice");

    // Partly paid is not paid.
    const partial = await hook(worker, evt("WH-EVT-1", "INVOICING.INVOICE.PAID", { invoice: { id: a.ppId, status: "PARTIALLY_PAID", due_amount: { currency_code: "USD", value: "25.00" } } }));
    assert.equal(partial.status, 200, JSON.stringify(partial.data));
    assert.equal(await payment(a.rideId), "invoiced");
    // Fully paid marks the ride paid; a re-delivery is a no-op.
    const paid = await hook(worker, evt("WH-EVT-2", "INVOICING.INVOICE.PAID", { id: a.ppId, status: "PAID", due_amount: { currency_code: "USD", value: "0.00" } }));
    assert.equal(paid.data.result, "paid");
    assert.equal(await payment(a.rideId), "paid");
    assert.equal((await hook(worker, evt("WH-EVT-2", "INVOICING.INVOICE.PAID", { id: a.ppId, status: "PAID" }))).data.duplicate, true);
    const shown = await call(worker, "/api/invoices/" + a.invoice.id, { session });
    assert.equal(shown.data.invoice.paypal.status, "PAID");
    assert.equal(shown.data.invoice.payment, "paid");

    // Refund sets the flag only.
    const refund = await hook(worker, evt("WH-EVT-3", "INVOICING.INVOICE.REFUNDED", { id: a.ppId, status: "REFUNDED" }));
    assert.equal(refund.data.result, "refunded flag set");
    const refunded = (await call(worker, "/api/invoices/" + a.invoice.id, { session })).data.invoice;
    assert.equal(refunded.paypal.refunded, true);
    assert.equal(refunded.payment, "paid");

    // Cancelled leaves the ride invoiced.
    const cancel = await hook(worker, evt("WH-EVT-4", "INVOICING.INVOICE.CANCELLED", { id: b.ppId }));
    assert.equal(cancel.data.result, "status CANCELLED");
    assert.equal(await payment(b.rideId), "invoiced");
    assert.equal((await sql(persistTo, "SELECT COUNT(*) AS n FROM paypal_events"))[0].n, 4);

    // Cron backup: c is SENT and was just checked, so it waits 30 minutes; make it due and run the cron.
    await sql(persistTo, "UPDATE invoices SET paypal_checked_at = 1 WHERE paypal_invoice_id = '" + c.ppId + "'");
    mock.state.nextStatus = "PAID";
    const cron = await worker.fetch("http://127.0.0.1/__scheduled?cron=*/5+*+*+*+*");
    assert.equal(cron.status, 200);
    let tries = 0;
    while ((await payment(c.rideId)) !== "paid" && tries++ < 20) await new Promise((r) => setTimeout(r, 250));
    assert.equal(await payment(c.rideId), "paid");
    assert.equal(await payment(b.rideId), "invoiced", "cancelled invoices are not re-checked");

    // Manual "Check PayPal status".
    mock.state.nextStatus = "CANCELLED";
    const d = await sendOne();
    const synced = await call(worker, "/api/invoices/" + d.invoice.id + "/paypal/sync", { method: "POST", session, body: {} });
    assert.equal(synced.status, 200, JSON.stringify(synced.data));
    assert.equal(synced.data.invoice.paypal.status, "CANCELLED");
    assert.equal(synced.data.invoice.payment, "invoiced");
  } finally {
    if (worker) await worker.stop();
    mock.server.close();
    await rm(persistTo, { recursive: true, force: true });
  }
});
