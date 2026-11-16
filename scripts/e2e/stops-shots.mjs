#!/usr/bin/env node
// Preview screenshots for multi-stop booking (390px phone, 1280px desktop) on a local Worker with a
// throwaway D1. Seeds data with worker.fetch only; the browser never submits a booking.
// Usage: node scripts/e2e/stops-shots.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "e2e-artifacts", "stops");
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

const persistTo = mkdtempSync(join(tmpdir(), "nudge-stops-shots-"));
let worker;
let browser;
try {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("migrations exited " + code))));
  });
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_DATA_PROVIDER: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "preview@example.test", companyName: "The Gold Standard Limo", accountKind: "fleet" } });
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "preview-owner-pass-1" } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const slug = (await call(worker, "/api/settings", { session })).data.settings.bookingSlug;
  await call(worker, "/api/rate-sheet", { method: "PUT", session, body: { enabled: true, rateSheet: {
    vehicles: [{ name: "SUV", seats: 6, base: "20", perMile: "3" }],
    flatFares: [{ place: "ATL Airport", placeKeywords: "atl, airport", prices: { SUV: { oneWay: "145" } } }],
  } } });
  await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Dee Driver", vehicle: "Black Chevy Suburban" } });
  await call(worker, "/api/booking-settings", { method: "PUT", session, body: { preset: ["ATL"] } });
  await call(worker, "/api/settings", { method: "PUT", session, body: { businessName: "The Gold Standard Limo", prefix: "TGS-" } });
  const date = new Date(Date.now() + 7 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const req = await call(worker, "/api/public/book/" + slug, { method: "POST", body: { name: "Pat Rider", phone: "404-555-0123", date, time: "10:00", tripType: "one-way", passengers: 2, vehicle: "suv", pickup: "12 Oak Lane, Roswell", dropoff: "500 Peachtree St, Atlanta", stops: ["Lenox Square, Atlanta", "Phipps Plaza, Atlanta"] } });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199", email: "avery@example.test" } });
  const ride = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date, time: "09:30", pickup: "Ritz-Carlton Buckhead", dropoff: "ATL Airport", passengers: 1, fare: "185", stops: ["Office, 1100 Peachtree St", "Gym, 3330 Piedmont Rd"] } });
  const rideId = ride.data.ride.id;
  let from = "";
  for (const step of ["En route", "Arrived", "Picked up", "Completed"]) { await call(worker, `/api/rides/${rideId}/progress`, { method: "POST", session, body: { step, from } }); from = step; }
  const inv = await call(worker, `/api/rides/${rideId}/invoice`, { method: "POST", session, body: {} });
  const upcoming = await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.data.client.id, date, time: "18:00", pickup: "Ritz-Carlton Buckhead", dropoff: "Fox Theatre", passengers: 2, fare: "120", stops: ["The Optimist, 914 Howell Mill Rd"] } });
  const rides = (await call(worker, "/api/rides", { session })).data.rides;
  const requestId = rides.find((r) => r.clientPhone === "404-555-0123").id;

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  const cookieVal = session.cookie.slice(session.cookie.indexOf("=") + 1);
  for (const [w, h, tag] of [[390, 844, "390"], [1280, 900, "1280"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.route(/\/api\/public\/book\/[^/]+$/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    const shot = async (name) => { await page.waitForTimeout(300); const path = join(out, `stops-${tag}-${name}.png`); await page.screenshot({ path, fullPage: true }); console.log(path); };
    await page.goto(`${base}/book/${slug}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body[data-ready='1']");
    await page.fill("#pickup", "12 Oak Lane, Roswell");
    await page.fill("#dropoff", "500 Peachtree St, Atlanta");
    await page.waitForSelector("#quote[data-state='ok']", { timeout: 8000 }).catch(() => {});
    await shot("1-booking-no-stops");
    await page.click("#addStop");
    await page.locator(".stop-input").nth(0).fill("Lenox Square, Atlanta");
    await page.click("#addStop");
    await page.locator(".stop-input").nth(1).fill("Phipps Plaza, Atlanta");
    await page.waitForSelector("#quote[data-state='stops']", { timeout: 8000 });
    await shot("2-booking-with-stops");
    await page.selectOption("[name=time]", "10:00");
    await page.click("#toContact");
    await page.fill("[name=name]", "Pat Rider");
    await page.fill("[name=phone]", "404-555-0123");
    await page.click("#toReview");
    await shot("3-review");
    await ctx.addCookies([{ name: "nudge_session", value: cookieVal, url: base }]);
    await page.goto(base + "/#/rides", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Needs your approval");
    await shot("4-owner-requests");
    await page.goto(base + "/#/rides/" + requestId, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".route");
    await shot("5-request-detail");
    await page.goto(base + "/#/rides/" + upcoming.data.ride.id, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#stops-form");
    await page.click("#ride-stops [data-add-stop]");
    await page.locator("#ride-stops .stop-edit-input").nth(1).fill("Ponce City Market");
    await shot("6-ride-detail-edit-stops");
    await page.goto(base + "/#/new", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#new-stops");
    await page.click("#new-stops [data-add-stop]");
    await page.locator("#new-stops .stop-edit-input").first().fill("Lenox Square");
    await shot("7-new-ride-stops");
    await page.goto(base + "/#/invoices/" + inv.data.invoice.id, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sheet");
    await shot("8-invoice");
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
