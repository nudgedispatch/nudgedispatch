#!/usr/bin/env node
// Local screenshots of self-serve signup (account, branding, confirm), welcome, settings, booking, and QR.
// Local Worker + throwaway D1 + Stripe mock on 127.0.0.1. Nothing reaches Stripe. No card is charged.
// Usage: node scripts/e2e/signup-shots.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || "/workspace/nudge-signup-preview";
mkdirSync(out, { recursive: true });
const logoPath = existsSync(join(out, "preview-logo.png")) ? join(out, "preview-logo.png") : join(root, "app/icons/icon-192.png");
const WEBHOOK_SECRET = "whsec_signup_shots";
const LOGO_DATA_URL = "data:image/png;base64," + (await import("node:fs")).readFileSync(logoPath).toString("base64");

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}
async function call(worker, path, { method = "GET", body, session } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || "") };
}

function startStripeMock() {
  const hits = [];
  const card = { id: "pm_signup", object: "payment_method", livemode: false, type: "card", card: { brand: "visa", display_brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const body = Buffer.concat(chunks).toString();
      hits.push({ method: req.method, path: url.pathname, body });
      const send = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      const p = url.pathname;
      if (p === "/v1/prices") {
        const keys = [...url.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
        return send({ object: "list", data: keys.map((k) => ({ id: "price_" + k, object: "price", livemode: false, lookup_key: k, product: "prod_" + k })) });
      }
      if (p === "/v1/checkout/sessions" && req.method === "POST") {
        const signupId = /metadata\[signup_id\]=([^&]+)/.exec(decodeURIComponent(body.replace(/\+/g, " ")))?.[1] || "sig";
        return send({
          id: "cs_test_signupshots1",
          object: "checkout.session",
          livemode: false,
          mode: "subscription",
          url: "https://checkout.stripe.com/c/pay/cs_test_signupshots1",
          metadata: { purpose: "signup", signup_id: signupId, plan: "solo", sms: "off" },
        });
      }
      const cs = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(p);
      if (cs) {
        const raw = hits.find((h) => h.path === "/v1/checkout/sessions" && h.method === "POST")?.body || "";
        const signupId = new URLSearchParams(decodeURIComponent(raw.replace(/\+/g, " "))).get("metadata[signup_id]") || "sig";
        return send({
          id: cs[1],
          object: "checkout.session",
          livemode: false,
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          customer: "cus_signup",
          subscription: { id: "sub_signup", object: "subscription", livemode: false, status: "active", customer: "cus_signup", default_payment_method: card },
          metadata: { purpose: "signup", signup_id: signupId, plan: "solo", sms: "off" },
        });
      }
      if (p === "/v1/subscriptions/sub_signup") return send({ id: "sub_signup", object: "subscription", livemode: false, status: "active", customer: "cus_signup", default_payment_method: card });
      if (p.startsWith("/v1/customers/cus_signup")) return send({ id: "cus_signup", object: "customer", livemode: false, invoice_settings: { default_payment_method: card } });
      return send({ error: { message: "mock: no route " + req.method + " " + p } }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ hits, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(() => d())) })));
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-signup-shots-"));
const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
assert.equal(mig.status, 0, mig.stderr + mig.stdout);

const mock = await startStripeMock();
let worker;
let browser;
try {
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { SMS_MODE: "off", STRIPE_SECRET_KEY: "sk_test_preview", STRIPE_API_BASE: mock.url, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_CARD_PAYMENT_CONFIGURATION: "pmc_cardonlytest1" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });

  const shot = async (page, name) => {
    const file = join(out, name + ".png");
    await page.screenshot({ path: file, fullPage: true });
    console.log("wrote", file);
  };

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await phone.newPage();
  await page.goto(base + "/signup", { waitUntil: "networkidle" });
  await page.waitForSelector("#companyName");
  await shot(page, "01-signup-account-empty");

  await page.fill("#companyName", "Peach State Cars");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const el = document.querySelector("#slug-status");
    return el && /available|taken|reserved|code/i.test(el.textContent || "");
  }, { timeout: 8000 }).catch(() => {});
  await page.fill("#ownerName", "Ada Owner");
  await page.fill("#email", "ada@example.test");
  await page.fill("#ownerPhone", "404-555-0100");
  await page.fill("#password", "sample-owner-pass");
  await page.fill("#address", "101 Peachtree St, Atlanta, GA");
  await page.waitForTimeout(200);
  await shot(page, "02-signup-account-filled");

  await page.click("#to-branding");
  await page.waitForSelector("#logo");
  await shot(page, "03-signup-branding-empty");

  await page.setInputFiles("#logo", logoPath);
  await page.waitForTimeout(500);
  const navy = page.locator(".theme-swatch").nth(1);
  if (await navy.count()) await navy.click();
  else await page.fill("#themeColor", "#0f1c2e");
  await page.waitForTimeout(200);
  await shot(page, "04-signup-branding-preview");

  await page.click("#to-review");
  await page.waitForSelector("#slugPermanentConfirmed");
  await shot(page, "05-signup-confirm");
  await page.check("#slugPermanentConfirmed");
  await page.check("#termsAccepted");
  await shot(page, "06-signup-confirm-checked");

  const started = await call(worker, "/api/signup", {
    method: "POST",
    body: {
      companyName: "Peach State Cars",
      ownerName: "Ada Owner",
      email: "ada@example.test",
      password: "sample-owner-pass",
      ownerPhone: "404-555-0100",
      address: "101 Peachtree St, Atlanta, GA",
      bookingSlug: "peach-state-cars",
      termsAccepted: true,
      slugPermanentConfirmed: true,
      themeColor: "#0f1c2e",
      logoDataUrl: LOGO_DATA_URL,
    },
  });
  assert.ok([200,201].includes(started.status), JSON.stringify(started.data));
  const done = await call(worker, "/api/signup/complete", { method: "POST", body: { sessionId: "cs_test_signupshots1" } });
  assert.equal(done.status, 201, JSON.stringify(done.data));

  const cookieVal = done.cookie.replace(/^nudge_session=/, "");
  const authed = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    baseURL: base,
  });
  await authed.addCookies([{ name: "nudge_session", value: cookieVal, url: base }]);
  const app = await authed.newPage();
  await app.goto(base + "/#/welcome", { waitUntil: "networkidle" });
  await app.waitForTimeout(600);
  await shot(app, "07-welcome");
  // dismiss A2HS if present so settings is visible
  const dismiss = app.locator("text=Not now");
  if (await dismiss.count()) await dismiss.click().catch(() => {});

  await app.goto(base + "/#/settings", { waitUntil: "networkidle" });
  await app.waitForSelector("#themeColor", { timeout: 8000 });
  await app.evaluate(() => {
    const field = document.querySelector("#theme-field");
    if (field) field.scrollIntoView({ block: "center" });
  });
  await app.waitForTimeout(200);
  await shot(app, "08-settings-branding");
  const themeField = app.locator("#theme-field");
  if (await themeField.count()) await themeField.screenshot({ path: join(out, "08b-settings-branding-closeup.png") });


  const book = await authed.newPage();
  await book.goto(base + "/book/peach-state-cars/", { waitUntil: "networkidle" });
  await book.waitForTimeout(400);
  await shot(book, "09-booking-themed");

  const qr = await authed.newPage();
  await qr.goto(base + "/book/peach-state-cars/qr/", { waitUntil: "networkidle" });
  await qr.waitForTimeout(400);
  await shot(qr, "10-booking-qr-themed");

  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const dpage = await desk.newPage();
  await dpage.goto(base + "/signup", { waitUntil: "networkidle" });
  await dpage.waitForSelector("#companyName");
  await dpage.fill("#companyName", "Peach State Cars");
  await dpage.fill("#ownerName", "Ada Owner");
  await dpage.fill("#email", "ada@example.test");
  await dpage.fill("#password", "sample-owner-pass");
  await dpage.waitForTimeout(400);
  await shot(dpage, "11-signup-account-desktop");
  await dpage.click("#to-branding");
  await dpage.waitForSelector("#themeColor");
  const dNavy = dpage.locator(".theme-swatch").nth(1);
  if (await dNavy.count()) await dNavy.click();
  await shot(dpage, "12-signup-branding-desktop");

  await phone.close();
  await authed.close();
  await desk.close();
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  await mock.close();
  rmSync(persistTo, { recursive: true, force: true });
}
