#!/usr/bin/env node
// E2E for driver ride alerts on a local Worker with a throwaway D1 and a local mock push service.
// A driver taps "Turn on ride alerts" (notifications granted), the owner assigns a ride, and the mock push
// service must receive an RFC 8291 encrypted push for that driver. The decrypted message is then delivered to
// the page's service worker over CDP, and the foreground app must show the banner and play the alert sound.
// Nothing is texted or emailed. Usage: node scripts/e2e/driver-alerts.mjs [outDir]  (env: CHROME_PATH)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";
import { b64urlEncode, decryptPayload } from "../../app/push.js";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "e2e-artifacts", "driver-alerts");
mkdirSync(out, { recursive: true });
const ADMIN = "alerts-admin-token";

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
async function waitFor(fn, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  return null;
}

const received = [];
const mock = createServer((req, res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => { received.push({ path: req.url, headers: req.headers, body: new Uint8Array(Buffer.concat(c)) }); res.statusCode = 201; res.end(); }); });
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const pushOrigin = `http://127.0.0.1:${mock.address().port}`;

const vapidPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const vapidPub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey)));
const vapidPriv = (await crypto.subtle.exportKey("jwk", vapidPair.privateKey)).d;
const dev = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const device = {
  p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", dev.publicKey))),
  priv: (await crypto.subtle.exportKey("jwk", dev.privateKey)).d,
  auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  endpoint: pushOrigin + "/push/driver-phone",
};

const persistTo = mkdtempSync(join(tmpdir(), "nudge-alerts-e2e-"));
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
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", FLIGHT_DATA_PROVIDER: "off", VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: vapidPriv, VAPID_SUBJECT: "mailto:ops@example.test", PUSH_TEST_ENDPOINT_ORIGIN: pushOrigin },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "alerts@example.test", companyName: "The Gold Standard Limo", accountKind: "fleet" } });
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "alerts-owner-pass-1", termsAccepted: true } });
  const owner = { cookie: acc.cookie, csrf: acc.data.csrf };
  const slug = (await call(worker, "/api/settings", { session: owner })).data.settings.bookingSlug;
  const driver = (await call(worker, "/api/drivers", { method: "POST", session: owner, body: { name: "Dee Driver", vehicle: "Black Chevy Suburban" } })).data.driver;
  await call(worker, `/api/drivers/${driver.id}/passcode`, { method: "PUT", session: owner, body: { passcode: "road42" } });
  const client = (await call(worker, "/api/clients", { method: "POST", session: owner, body: { name: "Avery Cole", phone: "404-555-0199" } })).data.client;
  const sound = await worker.fetch("http://127.0.0.1/sounds/ride-alert.mp3");
  assert.equal(sound.status, 200);
  assert.equal(sound.headers.get("content-type"), "audio/mpeg");
  assert.ok((await sound.arrayBuffer()).byteLength > 5000);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36" });
  await ctx.grantPermissions(["notifications"], { origin: base });
  // Local runs have no real push service: hand the page a subscription that points at the mock service.
  await ctx.addInitScript((d) => {
    const sub = { endpoint: d.endpoint, expirationTime: null, options: { applicationServerKey: null, userVisibleOnly: true }, toJSON: () => ({ endpoint: d.endpoint, expirationTime: null, keys: { p256dh: d.p256dh, auth: d.auth } }), unsubscribe: async () => true };
    let on = false;
    if (window.PushManager) {
      PushManager.prototype.subscribe = async function () { on = true; return sub; };
      PushManager.prototype.getSubscription = async function () { return on ? sub : null; };
    }
    window.__played = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!this.muted) window.__played++; return play.call(this).catch(() => {}); };
  }, device);
  const page = await ctx.newPage();
  await page.goto(base + "/#/login", { waitUntil: "domcontentloaded" });
  const login = await page.evaluate(async (b) => (await fetch("/api/driver-login", { method: "POST", headers: { "content-type": "application/json", "x-nudge-client": "1" }, body: JSON.stringify(b) })).status, { company: slug, name: "Dee Driver", passcode: "road42" });
  assert.equal(login, 200);
  await page.goto(base + "/#/rides", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#alerts-on");
  await page.screenshot({ path: join(out, "driver-alerts-390-1-optin.png") });
  await page.click("#alerts-on");
  await page.waitForSelector("#alerts-test");
  // Once on, the alert controls are a quiet status line under the rides, not a big card on top.
  assert.equal(await page.locator("#alerts-top #alerts-on").count(), 0);
  assert.equal(await page.locator("#alerts details.ride-alerts-status #alerts-test").count(), 1);
  const driverCookie = (await ctx.cookies(base)).filter((c) => c.name === "nudge_session").map((c) => "nudge_session=" + c.value)[0];
  const subs = (await call(worker, "/api/push/config", { session: { cookie: driverCookie, csrf: "" } })).data;
  assert.equal(subs.devices, 1, "subscription stored");
  await page.click("#alerts-test");
  await page.waitForSelector("#alerts-msg.ok");
  const testHit = await waitFor(() => received.find((r) => r.path === "/push/driver-phone"));
  assert.ok(testHit, "test alert reached the push service");
  await page.screenshot({ path: join(out, "driver-alerts-390-2-on.png") });

  // Owner assigns a ride; the push service gets the encrypted alert.
  const pickupDate = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const ride = (await call(worker, "/api/rides", { method: "POST", session: owner, body: { clientId: client.id, date: pickupDate, time: "09:30", pickup: "3500 Peachtree Rd NE, Atlanta, GA 30326", dropoff: "ATL Airport", passengers: 2, fare: "95" } })).data.ride;
  const mark = received.length;
  const assigned = await call(worker, `/api/rides/${ride.id}`, { method: "PATCH", session: owner, body: { driverUserId: driver.id } });
  assert.equal(assigned.status, 200);
  const hit = await waitFor(() => received.slice(mark).find((r) => r.path === "/push/driver-phone"));
  assert.ok(hit, "assign produced a push request");
  const text = await decryptPayload(hit.body, device.p256dh, device.priv, device.auth);
  const payload = JSON.parse(text);
  assert.equal(payload.title, "New ride assigned");
  assert.equal(payload.rideId, ride.id);
  assert.doesNotMatch(text, /Avery|555-0199|3500 Peachtree/);

  // Deliver it to the real service worker (as the push service would) and check the foreground alert.
  const cdp = await ctx.newCDPSession(page);
  const regs = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  const reg = await waitFor(() => regs.find((r) => r.scopeURL.startsWith(base) && !r.isDeleted));
  assert.ok(reg, "service worker registered");
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: base, registrationId: reg.registrationId, data: text });
  await page.waitForSelector("#ride-alert-banner");
  const bannerText = await page.textContent("#ride-alert-banner");
  assert.match(bannerText, /New ride assigned/);
  assert.ok(await waitFor(() => page.evaluate(() => window.__played > 0), 5000), "alert sound played");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "driver-alerts-390-3-banner.png") });
  await page.click("#rab-open");
  await page.waitForFunction((id) => location.hash === "#/rides/" + id, ride.id);
  await page.screenshot({ path: join(out, "driver-alerts-390-4-opened-ride.png") });

  // iPhone in Safari (not added to the Home Screen) sees the Add to Home Screen steps.
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });
  await ios.addCookies(await ctx.cookies(base));
  const ip = await ios.newPage();
  await ip.goto(base + "/#/rides", { waitUntil: "domcontentloaded" });
  await ip.waitForSelector("#alerts-top .ra-more");
  assert.equal(await ip.locator("#alerts-test, #alerts-on").count(), 0, "no test or turn-on button in iPhone Safari");
  await ip.click(".ra-more summary");
  await ip.waitForSelector(".alerts-steps", { state: "visible" });
  await ip.screenshot({ path: join(out, "driver-alerts-390-5-iphone-add-to-home.png") });
  // A phone in "Desktop site" mode (wide layout viewport on a small touch screen) gets a how-to-fix hint.
  const desk = await browser.newContext({ viewport: { width: 980, height: 1800 }, screen: { width: 390, height: 844 }, hasTouch: true, isMobile: false, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" });
  const dp = await desk.newPage();
  await dp.goto(base + "/#/login", { waitUntil: "domcontentloaded" });
  await dp.waitForSelector("#desktop-site-hint");
  const normal = await ctx.newPage();
  await normal.goto(base + "/#/login", { waitUntil: "domcontentloaded" });
  await normal.waitForTimeout(500);
  assert.equal(await normal.locator("#desktop-site-hint").count(), 0, "no hint on a normal phone layout");
  console.log("driver-alerts e2e: passed", out);
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  mock.close();
  rmSync(persistTo, { recursive: true, force: true });
}
