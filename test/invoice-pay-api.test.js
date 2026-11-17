import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";

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
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

async function openOwner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "individual" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  return { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
}

test("payment methods save, validate, and flow into invoices; owner marks paid", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-invoice-pay-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml",
      local: true,
      persist: true,
      persistTo,
      logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const session = await openOwner(worker, "tgs@example.test", "The Gold Standard Limo");

    const fresh = await call(worker, "/api/settings", { session });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.data.settings.paymentMethods.cashapp.on, false);

    const bad = await call(worker, "/api/settings", { method: "PUT", session, body: { paymentMethods: { cashapp: { on: true, handle: "$12 3" } } } });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /Cash App/);
    const missing = await call(worker, "/api/settings", { method: "PUT", session, body: { paymentMethods: { zelle: { on: true, handle: "" } } } });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /Zelle phone or email, or turn Zelle off/);
    const notObject = await call(worker, "/api/settings", { method: "PUT", session, body: { paymentMethods: "cash" } });
    assert.equal(notObject.status, 400);

    const saved = await call(worker, "/api/settings", {
      method: "PUT",
      session,
      body: {
        businessName: "The Gold Standard Limo",
        prefix: "TGS-",
        paymentInstructions: "Card accepted in the car.",
        paymentMethods: {
          cash: { on: true },
          cashapp: { on: true, handle: "$TGSLimo" },
          zelle: { on: true, handle: "404-555-0123" },
          venmo: { on: true, handle: "@TGS-Limo" },
          paypal: { on: false, handle: "paypal.me/TGSLimo" },
        },
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.settings.paymentMethods.cashapp, { on: true, handle: "TGSLimo" });
    assert.deepEqual(saved.data.settings.paymentMethods.paypal, { on: false, handle: "TGSLimo" });

    // A later save without paymentMethods keeps them.
    const keep = await call(worker, "/api/settings", { method: "PUT", session, body: { website: "tgs.example" } });
    assert.equal(keep.status, 200);
    assert.equal(keep.data.settings.paymentMethods.venmo.handle, "TGS-Limo");
    const reloaded = await call(worker, "/api/settings", { session });
    assert.equal(reloaded.data.settings.paymentMethods.zelle.handle, "(404) 555-0123");
    assert.equal(reloaded.data.settings.paymentInstructions, "Card accepted in the car.");

    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199", email: "avery@example.test" } });
    assert.equal(client.status, 201, JSON.stringify(client.data));
    const ride = await call(worker, "/api/rides", {
      method: "POST",
      session,
      body: { clientId: client.data.client.id, date: "2026-11-18", time: "09:30", pickup: "Hotel", dropoff: "Airport", passengers: 1, fare: "125" },
    });
    assert.equal(ride.status, 201, JSON.stringify(ride.data));
    const rideId = ride.data.ride.id;
    let from = "";
    for (const step of ["En route", "Arrived", "Picked up", "Completed"]) {
      const moved = await call(worker, "/api/rides/" + rideId + "/progress", { method: "POST", session, body: { step, from } });
      assert.equal(moved.status, 200, step + " " + JSON.stringify(moved.data));
      from = step;
    }
    const made = await call(worker, "/api/rides/" + rideId + "/invoice", { method: "POST", session, body: {} });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const invoice = made.data.invoice;
    assert.equal(invoice.number, "TGS-1001");
    assert.equal(invoice.payment, "invoiced");
    assert.deepEqual(invoice.payWith.map((o) => o.kind), ["cashapp", "venmo", "zelle", "cash"]);
    assert.equal(invoice.payWith[0].url, "https://cash.app/$TGSLimo/125.00");
    assert.equal(invoice.payWith[1].url, "https://venmo.com/TGS-Limo?txn=pay&amount=125.00&note=Invoice%20TGS-1001");
    assert.ok(invoice.snapshotText.includes("\nPay with\nCash App: $TGSLimo https://cash.app/$TGSLimo/125.00\n"));
    assert.ok(invoice.snapshotText.includes("Zelle: (404) 555-0123"));
    assert.ok(invoice.snapshotText.includes("Cash: Pay your driver in cash"));
    assert.ok(invoice.snapshotText.includes("Payment note\nCard accepted in the car."));
    assert.equal(invoice.snapshotText.includes("How to pay"), false);
    assert.equal(invoice.billTo.email, "avery@example.test");

    const paid = await call(worker, "/api/rides/" + rideId, { method: "PATCH", session, body: { payment: "paid" } });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    const again = await call(worker, "/api/invoices/" + invoice.id, { session });
    assert.equal(again.data.invoice.payment, "paid");
    const unpaid = await call(worker, "/api/rides/" + rideId, { method: "PATCH", session, body: { payment: "invoiced" } });
    assert.equal(unpaid.status, 200);
    assert.equal((await call(worker, "/api/invoices/" + invoice.id, { session })).data.invoice.payment, "invoiced");
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
