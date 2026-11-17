#!/usr/bin/env node
// Preview screenshots for the setup-fee choice (platform admin) and the client Payment method card
// (390px phone, 1280px desktop). Local Worker, throwaway D1, and a local mock of Stripe test mode on
// 127.0.0.1: nothing reaches Stripe, and no card is charged.
// Usage: node scripts/e2e/billing-shots.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "e2e-artifacts", "billing");
mkdirSync(out, { recursive: true });
const ADMIN = "shots-admin-token";
const PLATFORM_EMAIL = "platform@example.test";

async function call(worker, path, { method = "GET", body, session, admin } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session) { headers.cookie = session.cookie; if (method !== "GET") headers["x-csrf-token"] = session.csrf; }
  if (admin) headers.authorization = "Bearer " + ADMIN;
  const res = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = cookies.map((l) => l.split(";")[0]).find((p) => p.startsWith("nudge_session=")) || (session && session.cookie) || "";
  return { status: res.status, data, cookie };
}
function sql(persistTo, text) {
  const file = join(persistTo, "q.sql");
  writeFileSync(file, text);
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--file", file], { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

const st = { customerPm: null };
const card = () => ({ id: "pm_preview", object: "payment_method", livemode: false, type: "card", card: { brand: "visa", display_brand: "visa", last4: "4242", exp_month: 8, exp_year: 2029 } });
const invoice = { id: "in_preview", object: "invoice", livemode: false, status: "open", amount_due: 5900, currency: "usd", hosted_invoice_url: "https://invoice.stripe.com/i/preview" };
const mock = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const send = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (p === "/v1/prices") return send({ object: "list", data: [...url.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, k]) => ({ id: "price_" + k, livemode: false, lookup_key: k, product: "prod_" + k })) });
    if (p === "/v1/promotion_codes") return send({ object: "list", data: [{ id: "promo_" + url.searchParams.get("code"), livemode: false, promotion: { coupon: "cpn_x" } }] });
    if (p === "/v1/coupons/cpn_x") return send({ id: "cpn_x", livemode: false });
    if (p === "/v1/customers" && req.method === "POST") return send({ id: "cus_preview", livemode: false });
    if (p === "/v1/subscriptions" && req.method === "POST") return send({ id: "sub_preview", livemode: false, status: "incomplete", latest_invoice: invoice });
    if (p === "/v1/subscriptions/sub_preview") return send({ id: "sub_preview", livemode: false, status: "incomplete", customer: "cus_preview", items: { data: [] }, default_payment_method: null, latest_invoice: invoice });
    if (p === "/v1/customers/cus_preview") return send({ id: "cus_preview", livemode: false, invoice_settings: { default_payment_method: st.customerPm ? card() : null } });
    return send({ error: { message: "preview mock: " + p } }, 404);
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const stripeBase = `http://127.0.0.1:${mock.address().port}`;

const persistTo = mkdtempSync(join(tmpdir(), "nudge-billing-shots-"));
let worker;
let browser;
try {
  const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, encoding: "utf8" });
  assert.equal(mig.status, 0, mig.stderr);
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "off", PLATFORM_ADMIN_EMAILS: PLATFORM_EMAIL, STRIPE_SECRET_KEY: "sk_test_preview", STRIPE_API_BASE: stripeBase },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");
  const open = async (email, companyName) => {
    const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "fleet" } });
    const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "preview-owner-pass-1" } });
    assert.equal(acc.status, 201, JSON.stringify(acc.data));
    return { cookie: acc.cookie, csrf: acc.data.csrf };
  };
  const platform = await open(PLATFORM_EMAIL, "Platform Holder");
  sql(persistTo, `UPDATE users SET platform_admin = 1 WHERE email = '${PLATFORM_EMAIL}';`);
  const fresh = await open("new-client@example.test", "Northside Cars");
  const client = await open("client@example.test", "The Gold Standard Limo");
  const accounts = await call(worker, "/api/platform/accounts", { session: platform });
  const tgs = accounts.data.accounts.find((a) => a.name === "The Gold Standard Limo");
  const started = await call(worker, `/api/platform/companies/${tgs.id}/subscription`, { method: "POST", session: platform, body: { setupFee: "free" } });
  assert.equal(started.status, 201, JSON.stringify(started.data));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  for (const [w, h, tag] of [[390, 844, "390"], [1280, 900, "1280"]]) {
    const shotAs = async (session, hash, wait, name, after) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: "block" });
      await ctx.addCookies([{ name: "nudge_session", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: base }]);
      const page = await ctx.newPage();
      // Screenshots only: block every billing write.
      await page.route(/\/api\/(platform\/companies\/.*\/(subscription|setup-fee|sms)|billing\/(pay-invoice|payment-method\/))/, (route) => route.abort());
      await page.goto(base + hash, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(wait);
      if (after) await after(page);
      await page.waitForTimeout(300);
      const path = join(out, `billing-${tag}-${name}.png`);
      await page.screenshot({ path, fullPage: false });
      console.log(path);
      await ctx.close();
    };
    st.customerPm = null;
    await shotAs(platform, "/#/admin", "[data-setup-fee]", "1-admin-start-subscription", async (page) => {
      const el = page.locator("[data-company]", { hasText: "Northside Cars" }).locator(".billing-admin");
      await el.scrollIntoViewIfNeeded();
    });
    await shotAs(fresh, "/#/settings", "#card-card [data-pm]", "2-owner-billing-not-started", async (page) => { await page.locator("#card-card").scrollIntoViewIfNeeded(); });
    await shotAs(client, "/#/settings", "#card-card [data-pm]", "3-owner-no-card-unpaid-invoice", async (page) => { await page.locator("#card-card").scrollIntoViewIfNeeded(); });
    st.customerPm = "pm_preview";
    await shotAs(client, "/#/settings", "#card-card [data-pm=card]", "4-owner-card-on-file", async (page) => { await page.locator("#card-card").scrollIntoViewIfNeeded(); });
  }
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  mock.close();
  rmSync(persistTo, { recursive: true, force: true });
}
