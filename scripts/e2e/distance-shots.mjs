#!/usr/bin/env node
// Preview screenshots for distance pricing, airports and Price needed (390, 768, 1024px) on a local Worker with a
// throwaway D1. Seeds data with worker.fetch only; the browser never submits a booking.
// Usage: node scripts/e2e/distance-shots.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "e2e-artifacts", "distance");
mkdirSync(out, { recursive: true });
const ADMIN = "shots-admin-token";

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

const persistTo = mkdtempSync(join(tmpdir(), "nudge-distance-shots-"));
let worker;
let browser;
const problems = [];
try {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "-c", "wrangler.toml", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("migrations exited " + code))));
  });
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_PROVIDER: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "distance-preview@example.test", companyName: "Peachtree Black Car", accountKind: "fleet" } });
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "preview-owner-pass-1", termsAccepted: true } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const slug = (await call(worker, "/api/settings", { session })).data.settings.bookingSlug;
  const rates = await call(worker, "/api/rate-sheet", { method: "PUT", session, body: { enabled: true, rateSheet: {
    vehicles: [{ name: "SUV", seats: 6, hourlyRate: "75", minHours: 3, blockMinutes: 15, blockPrice: "18.75" }],
    distance: { base: "10", perMile: "3", minimum: "65", airportFee: "15", extraStopFee: "10" },
  } } });
  assert.equal(rates.status, 200, JSON.stringify(rates.data));
  await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Dee Driver", vehicle: "Black Chevy Suburban" } });
  await call(worker, "/api/booking-settings", { method: "PUT", session, body: { preset: ["ATL", "CLT"] } });
  await call(worker, "/api/booking-settings", { method: "PUT", session, body: { base: { address: "1 Main St, Alpharetta, GA", lat: 34.0754, lng: -84.2941, radiusMiles: 50 } } });
  const date = new Date(Date.now() + 7 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const auto = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { name: "Pat Rider", phone: "404-555-0123", date, time: "10:00", tripType: "one-way", passengers: 2, vehicle: "suv", pickup: "12 Oak Lane, Roswell", dropoff: "500 Peachtree St, Atlanta", stops: ["Lenox Square, Atlanta"] } });
  assert.equal(auto.status, 201, JSON.stringify(auto.data));
  // "Hub" is too short to route: the request comes in as manual (what a Google outage looks like).
  const manual = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { name: "Morgan Manual", phone: "404-555-0124", date, time: "11:00", tripType: "one-way", passengers: 1, vehicle: "suv", pickup: "Hub", dropoff: "500 Peachtree St, Atlanta" } });
  assert.equal(manual.status, 201, JSON.stringify(manual.data));
  assert.equal(manual.data.estimate, null);

  const cookieVal = session.cookie.slice(session.cookie.indexOf("=") + 1);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  for (const [vw, vh] of [[390, 844], [768, 1024], [1024, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${vw}px page error: ${e.message}`));
    await page.route(/\/api\/public\/book\/[^/]+$/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    const shot = async (name) => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) problems.push(`${vw}px ${name}: page scrolls sideways`);
      await page.screenshot({ path: join(out, `${vw}-${name}.png`), fullPage: true });
    };
    const open = async (qs) => {
      await page.goto(`${base}/book/${slug}/${qs || ""}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("body[data-ready='1']", { timeout: 20000 });
    };
    const settle = () => page.waitForFunction(() => { const q = document.querySelector("#quote"); return q && !q.classList.contains("hidden") && q.dataset.state !== "pending"; }, null, { timeout: 10000 });

    await open();
    await page.fill("#pickup", "12 Oak Lane, Roswell, GA");
    await page.fill("#dropoff", "500 Peachtree St, Atlanta, GA");
    await page.click("#addStop");
    await page.fill("#stopsList .stop-input", "Lenox Square, Atlanta");
    await page.dispatchEvent("#stopsList .stop-input", "change");
    await settle();
    const price = await page.locator("#qPrice").textContent();
    if (!/^About \$\d/.test(price)) problems.push(`${vw}px distance quote with a stop: ${price}`);
    if (!/1 stop x \$10/.test(await page.locator("#qLines").innerText())) problems.push(`${vw}px stop fee line missing`);
    await shot("1-booking-distance-with-stop");

    await open("?airport=pickup&code=ATL");
    await page.fill("#dropoff", "12 Oak Lane, Roswell, GA");
    await page.selectOption("#airline", "DL");
    await page.waitForTimeout(300);
    const note = await page.locator("#flightNote").textContent();
    if (!/Delta flights use Domestic Terminal South \(Delta\) or International Terminal/.test(note)) problems.push(`${vw}px Delta airline note: ${note}`);
    await page.selectOption("#airline", "*");
    await page.waitForTimeout(300);
    if ((await page.locator("#pickupSpot").inputValue()) !== "domestic-north") problems.push(`${vw}px other airline did not pre-select Domestic North`);
    await settle();
    if (!/Airport fee/.test(await page.locator("#qLines").innerText())) problems.push(`${vw}px airport fee line missing`);
    await shot("2-booking-airport-airline-table");

    // Google down: the server answers with no price; the page shows the confirm message, no number.
    await page.route(/\/quote$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, quote: { available: false, message: "We'll confirm your price shortly." } }) }));
    await open();
    await page.fill("#pickup", "12 Oak Lane, Roswell, GA");
    await page.fill("#dropoff", "500 Peachtree St, Atlanta, GA");
    await page.dispatchEvent("#dropoff", "change");
    await settle();
    const manualPrice = await page.locator("#qPrice").textContent();
    if (manualPrice !== "We'll confirm your price shortly." || /\$/.test(await page.locator("#quote").innerText())) problems.push(`${vw}px manual quote shows: ${manualPrice}`);
    await shot("3-booking-google-down");
    await page.unroute(/\/quote$/);

    await ctx.addCookies([{ name: "nudge_session", value: cookieVal, url: base }]);
    await page.goto(base + "/#/rides", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".pending-request", { timeout: 15000 });
    const list = await page.locator("main").innerText();
    if (!/Price needed/.test(list)) problems.push(`${vw}px owner list: no Price needed flag`);
    if (!/Prefilled with the quote/.test(list)) problems.push(`${vw}px owner list: approve box not prefilled`);
    await shot("4-owner-requests");
    await page.goto(base + "/#/settings/rates", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#distance-rates", { timeout: 15000 });
    await page.waitForSelector("#base-settings", { timeout: 15000 });
    await page.waitForSelector("#air-codes", { timeout: 15000 });
    await shot("5-owner-rates");
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
if (problems.length) {
  console.error("distance-shots: problems\n" + problems.join("\n"));
  process.exit(1);
}
console.log("distance-shots: ok, screenshots in " + out);
