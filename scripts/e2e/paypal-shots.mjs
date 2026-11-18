#!/usr/bin/env node
// QA screenshots for PayPal invoicing at 390, 768, and 1024px: the More > PayPal invoices card (not connected,
// connected) and an invoice before send, after send, and after a (simulated) paid webhook.
// Local Worker, throwaway D1, PAYPAL_MODE=mock: nothing reaches PayPal, nothing is emailed. The secret typed
// here is a dummy and is never shown on screen (the card shows only its last 4).
// Usage: node scripts/e2e/paypal-shots.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "e2e-artifacts", "paypal");
mkdirSync(out, { recursive: true });
const ADMIN = "shots-admin-token";
const DUMMY_SECRET = "EDummyPreviewSecretNotRealZZ_qa42";

async function call(worker, path, { method = "GET", body, session, admin, headers: extra } = {}) {
  const headers = { "x-nudge-client": "1", ...(extra || {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session) { headers.cookie = session.cookie; if (method !== "GET") headers["x-csrf-token"] = session.csrf; }
  if (admin) headers.authorization = "Bearer " + ADMIN;
  const res = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = cookies.map((l) => l.split(";")[0]).find((p) => p.startsWith("nudge_session=")) || (session && session.cookie) || "";
  return { status: res.status, data, cookie };
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-paypal-shots-"));
let worker;
let browser;
try {
  const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  assert.equal(mig.status, 0, mig.stderr);
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "off", PAYPAL_MODE: "mock", PAYPAL_CREDENTIALS_KEY: randomBytes(32).toString("base64") },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "owner@example.test", companyName: "The Gold Standard Limo", accountKind: "individual" } });
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "preview-owner-pass-1", termsAccepted: true } });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const set = await call(worker, "/api/settings", { method: "PUT", session, body: { businessName: "The Gold Standard Limo", prefix: "TGS-", paymentMethods: { cash: { on: true }, paypal: { on: true, handle: "https://www.paypal.com/biz/profile/sanibel" } } } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  const invoices = [];
  for (let i = 0; i < 3; i++) {
    const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199", email: "avery@example.test" } });
    const ride = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date: "2026-11-18", time: "09:30", pickup: "Ritz-Carlton, Atlanta", dropoff: "ATL Terminal South", passengers: 2, fare: "125" } });
    let from = "";
    for (const step of ["En route", "Arrived", "Picked up", "Completed"]) {
      await call(worker, "/api/rides/" + ride.data.ride.id + "/progress", { method: "POST", session, body: { step, from } });
      from = step;
    }
    const made = await call(worker, "/api/rides/" + ride.data.ride.id + "/invoice", { method: "POST", session, body: {} });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    invoices.push(made.data.invoice.id);
  }

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  const shot = async (w, name, hash, wait, focus) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    await ctx.addCookies([{ name: "nudge_session", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + hash, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(wait);
    await page.locator(focus || wait).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const html = await page.content();
    assert.ok(!html.includes(DUMMY_SECRET), "secret must never be on the page");
    const path = join(out, `paypal-${w}-${name}.png`);
    await page.screenshot({ path, fullPage: false });
    console.log(path);
    await ctx.close();
  };
  const widths = [390, 768, 1024];
  for (const w of widths) await shot(w, "1-settings-not-connected", "/#/settings", "#paypal-card:not([hidden]) #pp-form");
  const saved = await call(worker, "/api/paypal/credentials", { method: "PUT", session, body: { mode: "sandbox", clientId: "AQkquBDf1zctJOWGKWUEtKXm6qVhueUEMvXO_-MCI4DQQ4-LWvkDLIN2fGsd", secret: DUMMY_SECRET, webhookId: "8PT597110X687430LKGECATA" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  for (const w of widths) await shot(w, "2-settings-connected", "/#/settings", "#paypal-card #pp-test", "#paypal-card");
  for (const w of widths) await shot(w, "3-invoice-send-button", "/#/invoices/" + invoices[0], "#pp-send");
  const sent = await call(worker, "/api/invoices/" + invoices[1] + "/paypal", { method: "POST", session, body: {} });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  for (const w of widths) await shot(w, "4-invoice-sent", "/#/invoices/" + invoices[1], "#pp-open", "#pp-invoice");
  for (const w of widths) await shot(w, "5-invoice-sent-sheet", "/#/invoices/" + invoices[1], "#sheet .paywith", "#sheet .paywith");
  const sent2 = await call(worker, "/api/invoices/" + invoices[2] + "/paypal", { method: "POST", session, body: {} });
  const ppId = sent2.data.invoice.paypal.invoiceId;
  const hook = await worker.fetch("http://127.0.0.1/api/paypal/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "paypal-transmission-id": "tx-shots", "paypal-transmission-sig": "mock-signature" },
    body: JSON.stringify({ id: "WH-SHOTS-1", event_type: "INVOICING.INVOICE.PAID", resource: { id: ppId, status: "PAID" } }),
  });
  assert.equal(hook.status, 200);
  for (const w of widths) await shot(w, "6-invoice-paid-by-webhook", "/#/invoices/" + invoices[2], "#pp-status", "#pp-invoice");
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
