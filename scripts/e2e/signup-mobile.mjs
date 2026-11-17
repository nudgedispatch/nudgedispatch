#!/usr/bin/env node
// Mobile layout audit + screenshots for self-serve signup.
// Viewports: 360x740, 375x667, 390x844, and 1024 desktop.
// Local Worker + throwaway D1 + Stripe mock. Nothing reaches Stripe.
// Usage: node scripts/e2e/signup-mobile.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const outRoot = process.argv[2] || "/workspace/nudge-signup-preview/mobile";
mkdirSync(outRoot, { recursive: true });
const previewRoot = join(outRoot, "..");
const logoPath = existsSync(join(previewRoot, "preview-logo.png")) ? join(previewRoot, "preview-logo.png") : join(root, "app/icons/icon-192.png");
const LOGO_DATA_URL = "data:image/png;base64," + readFileSync(logoPath).toString("base64");
const WEBHOOK_SECRET = "whsec_signup_mobile";

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740, dpr: 2 },
  { name: "375x667", width: 375, height: 667, dpr: 2 },
  { name: "390x844", width: 390, height: 844, dpr: 2 },
  { name: "1024-desktop", width: 1024, height: 768, dpr: 1 },
];

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
  const card = { id: "pm_signup", object: "payment_method", livemode: false, type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } };
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
          id: "cs_test_signupmobile1",
          object: "checkout.session",
          livemode: false,
          mode: "subscription",
          url: "https://checkout.stripe.com/c/pay/cs_test_signupmobile1",
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

async function audit(page, label) {
  return page.evaluate((label) => {
    const issues = [];
    const doc = document.documentElement;
    const scrollX = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
    if (scrollX > window.innerWidth + 1) {
      issues.push(`${label}: horizontal scroll (${scrollX}px wide in ${window.innerWidth}px viewport)`);
    }
    const visible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (el.closest(".hidden") || el.closest("[hidden]")) return false;
      if (el.closest(".hp") || el.closest("[aria-hidden='true']")) return false;
      if (el.classList.contains("skip") || el.classList.contains("sr-only")) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return false;
      if (r.right < 0 || r.bottom < -2000 || r.left > window.innerWidth + r.width) return false;
      return true;
    };
    const targetBox = (el) => {
      const labelEl = el.closest("label");
      const boxes = [el.getBoundingClientRect()];
      if (labelEl) boxes.push(labelEl.getBoundingClientRect());
      // Use the largest containing tap area (label wraps checkbox / swatch / input).
      return boxes.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    };
    const selectors = "a, button, input, select, textarea, [role='button']";
    for (const el of document.querySelectorAll(selectors)) {
      if (!visible(el)) continue;
      if (el.disabled) continue;
      const r = targetBox(el);
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w < 44 || h < 44) {
        const name = (el.id || el.name || el.getAttribute("href") || el.className || el.tagName || "el").toString().slice(0, 80);
        issues.push(`${label}: tap target ${name} is ${w}×${h}px`);
      }
    }
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!visible(el)) continue;
      if (el.type === "hidden" || el.type === "checkbox" || el.type === "radio" || el.type === "file") continue;
      const size = parseFloat(window.getComputedStyle(el).fontSize);
      if (size < 16) {
        issues.push(`${label}: ${el.id || el.name || el.tagName} font-size ${size}px (iOS will zoom)`);
      }
    }
    return issues;
  }, label);
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-signup-mobile-"));
const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
assert.equal(mig.status, 0, mig.stderr + mig.stdout);

const mock = await startStripeMock();
let worker;
let browser;
const allIssues = [];
try {
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { SMS_MODE: "off", STRIPE_SECRET_KEY: "sk_test_preview", STRIPE_API_BASE: mock.url, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_CARD_PAYMENT_CONFIGURATION: "pmc_cardonlytest1" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");

  const started = await call(worker, "/api/signup", {
    method: "POST",
    body: {
      companyName: "Peach State Cars",
      ownerName: "Ada Owner",
      email: "ada@example.test",
      password: "sample-owner-pass",
      ownerPhone: "404-555-0100",
      address: "101 Peachtree St, Atlanta, GA",
      bookingSlug: "peach-state-mobile",
      termsAccepted: true,
      slugPermanentConfirmed: true,
      themeColor: "#0f1c2e",
      logoDataUrl: LOGO_DATA_URL,
    },
  });
  assert.ok([200, 201].includes(started.status), JSON.stringify(started.data));
  const done = await call(worker, "/api/signup/complete", { method: "POST", body: { sessionId: "cs_test_signupmobile1" } });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  const cookieVal = done.cookie.replace(/^nudge_session=/, "");

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });

  for (const vp of VIEWPORTS) {
    const dir = join(outRoot, vp.name);
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      baseURL: base,
      hasTouch: vp.dpr > 1,
      isMobile: vp.dpr > 1,
    });
    await context.addCookies([{ name: "nudge_session", value: cookieVal, url: base }]);
    const page = await context.newPage();
    const shot = async (name) => {
      const file = join(dir, name + ".png");
      await page.screenshot({ path: file, fullPage: true });
      console.log("wrote", file);
      return file;
    };
    const check = async (name) => {
      const issues = await audit(page, `${vp.name} ${name}`);
      allIssues.push(...issues);
      if (issues.length) console.log("issues", issues);
    };

    await page.goto(base + "/signup", { waitUntil: "networkidle" });
    await page.waitForSelector("#companyName");
    // logo picker: camera roll friendly
    const logoAccept = await page.$eval("#logo", (el) => ({ accept: el.getAttribute("accept") || "", capture: el.getAttribute("capture") }));
    if (logoAccept.capture) allIssues.push(`${vp.name}: logo input has capture=${logoAccept.capture} (forces camera, blocks camera roll)`);
    if (!/image\/\*/.test(logoAccept.accept)) allIssues.push(`${vp.name}: logo accept missing image/*: ${logoAccept.accept}`);
    // field attributes
    const attrs = await page.evaluate(() => {
      const grab = (id) => {
        const el = document.getElementById(id);
        if (!el) return { missing: true };
        return { type: el.getAttribute("type") || "", autocomplete: el.getAttribute("autocomplete") || "", inputmode: el.getAttribute("inputmode") || "", required: el.required };
      };
      return {
        companyName: grab("companyName"),
        email: grab("email"),
        ownerPhone: grab("ownerPhone"),
        password: grab("password"),
        businessPhone: grab("businessPhone"),
      };
    });
    if (attrs.companyName.autocomplete !== "organization") allIssues.push(`${vp.name}: companyName autocomplete=${attrs.companyName.autocomplete}`);
    if (attrs.email.type !== "email" || attrs.email.autocomplete !== "email") allIssues.push(`${vp.name}: email attrs ${JSON.stringify(attrs.email)}`);
    if (attrs.email.inputmode && attrs.email.inputmode !== "email") allIssues.push(`${vp.name}: email inputmode=${attrs.email.inputmode}`);
    if (attrs.ownerPhone.type !== "tel" || attrs.ownerPhone.autocomplete !== "tel" || attrs.ownerPhone.inputmode !== "tel" || !attrs.ownerPhone.required) {
      allIssues.push(`${vp.name}: ownerPhone attrs ${JSON.stringify(attrs.ownerPhone)}`);
    }
    if (attrs.password.type !== "password" || attrs.password.autocomplete !== "new-password") allIssues.push(`${vp.name}: password attrs ${JSON.stringify(attrs.password)}`);
    if (attrs.businessPhone.type !== "tel" || attrs.businessPhone.inputmode !== "tel") allIssues.push(`${vp.name}: businessPhone attrs ${JSON.stringify(attrs.businessPhone)}`);

    await page.fill("#companyName", "Peach State Cars");
    await page.waitForTimeout(400);
    await page.fill("#ownerName", "Ada Owner");
    await page.fill("#email", "ada@example.test");
    await page.fill("#ownerPhone", "404-555-0100");
    await page.fill("#password", "sample-owner-pass");
    await page.fill("#address", "101 Peachtree St, Atlanta, GA");
    await page.waitForTimeout(200);
    await shot("01-account");
    await check("account");
    // Continue should be in the viewport or reachable by sticky
    const continueVisible = await page.evaluate(() => {
      const btn = document.querySelector("#to-branding");
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight;
      // sticky or in-flow: after scrolling into view it must intersect the viewport
      btn.scrollIntoView({ block: "nearest" });
      const r2 = btn.getBoundingClientRect();
      return r2.bottom > 0 && r2.top < vh && r2.height >= 44;
    });
    if (!continueVisible) allIssues.push(`${vp.name}: Continue button is not reachable`);

    await page.click("#to-branding");
    await page.waitForSelector("#logo");
    await page.setInputFiles("#logo", logoPath);
    await page.waitForTimeout(500);
    const navy = page.locator(".theme-swatch").nth(1);
    if (await navy.count()) await navy.click();
    else await page.fill("#themeColor", "#0f1c2e");
    await page.waitForTimeout(200);
    await shot("02-branding");
    await check("branding");

    await page.click("#to-review");
    await page.waitForSelector("#slugPermanentConfirmed");
    await page.check("#slugPermanentConfirmed");
    await page.check("#termsAccepted");
    await shot("03-confirm");
    await check("confirm");
    const payVisible = await page.evaluate(() => {
      const btn = document.querySelector("#signup-submit");
      if (!btn) return false;
      btn.scrollIntoView({ block: "nearest" });
      const r = btn.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.height >= 44;
    });
    if (!payVisible) allIssues.push(`${vp.name}: Continue to payment is not reachable`);

    await page.goto(base + "/#/welcome", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const dismiss = page.locator("text=Not now");
    if (await dismiss.count()) await dismiss.click().catch(() => {});
    await shot("04-welcome");
    await check("welcome");

    await page.goto(base + "/#/settings", { waitUntil: "networkidle" });
    await page.waitForSelector("#themeColor", { timeout: 8000 });
    await page.evaluate(() => {
      const field = document.querySelector("#theme-field");
      if (field) field.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(200);
    await shot("05-settings-branding");
    const themeClose = page.locator("#theme-field");
    if (await themeClose.count()) await themeClose.screenshot({ path: join(dir, "05b-settings-branding-closeup.png") });
    await check("settings");

    await page.goto(base + "/book/peach-state-mobile/", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await shot("06-booking");
    await check("booking");

    await page.goto(base + "/book/peach-state-mobile/qr/", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await shot("07-qr");
    await check("qr");

    await context.close();
  }

  // Refresh the canonical account-step shot at 390x844 for the parent folder.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await phone.newPage();
  await page.goto(base + "/signup", { waitUntil: "networkidle" });
  await page.waitForSelector("#companyName");
  await page.fill("#companyName", "Peach State Cars");
  await page.waitForTimeout(400);
  await page.fill("#ownerName", "Ada Owner");
  await page.fill("#email", "ada@example.test");
  await page.fill("#ownerPhone", "404-555-0100");
  await page.fill("#password", "sample-owner-pass");
  await page.fill("#address", "101 Peachtree St, Atlanta, GA");
  await page.waitForTimeout(200);
  const accountShot = join(previewRoot, "02-signup-account-filled.png");
  await page.screenshot({ path: accountShot, fullPage: true });
  console.log("wrote", accountShot);
  await phone.close();
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  await mock.close();
  rmSync(persistTo, { recursive: true, force: true });
}

if (allIssues.length) {
  console.error("\nMobile audit failed:\n" + allIssues.map((i) => " - " + i).join("\n"));
  process.exit(1);
}
console.log("Mobile audit passed for", VIEWPORTS.map((v) => v.name).join(", "));
