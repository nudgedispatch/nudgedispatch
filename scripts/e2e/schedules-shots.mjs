#!/usr/bin/env node
// Preview screenshots for regular client schedules (390px phone, 1280px desktop) on a local Worker with a
// throwaway D1. Seeds data with worker.fetch only; nothing is texted or emailed.
// Usage: node scripts/e2e/schedules-shots.mjs [outDir]   (env: CHROME_PATH)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "e2e-artifacts", "schedules");
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

const persistTo = mkdtempSync(join(tmpdir(), "nudge-sched-shots-"));
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
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "preview-owner-pass-1", termsAccepted: true } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const driver = await call(worker, "/api/drivers", { method: "POST", session, body: { name: "Dee Driver", vehicle: "Black Chevy Suburban" } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const client = (await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199" } })).data.client;
  const client2 = (await call(worker, "/api/clients", { method: "POST", session, body: { name: "Jordan Banks", phone: "404-555-0142" } })).data.client;
  const s1 = await call(worker, "/api/schedules", { method: "POST", session, body: {
    clientId: client.id, label: "Airport run", monthDays: [1, 15, 31], time: "05:30", pickup: "12 Oak Lane, Roswell", dropoff: "ATL Airport", stops: ["Starbucks, Holcomb Bridge Rd"],
    passengers: 2, fare: "145", flight: "DL1234", driverUserId: driver.data.driver.id, startDate: today, lookaheadDays: 31, notes: "Two bags, Terminal South",
  } });
  assert.equal(s1.status, 201, JSON.stringify(s1.data));
  const s2 = await call(worker, "/api/schedules", { method: "POST", session, body: {
    clientId: client2.id, weekDays: [1, 4], time: "07:45", pickup: "Ritz-Carlton Buckhead", dropoff: "Truist Park", passengers: 1, startDate: today,
  } });
  assert.equal(s2.status, 201, JSON.stringify(s2.data));
  const date = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await call(worker, "/api/rides", { method: "POST", session, body: { clientId: client.id, date, time: "18:00", pickup: "Ritz-Carlton Buckhead", dropoff: "Fox Theatre", passengers: 2, fare: "120" } });
  const firstJordan = s2.data.schedule.upcoming[0];

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  const cookieVal = session.cookie.slice(session.cookie.indexOf("=") + 1);
  for (const [w, h, tag] of [[390, 844, "390"], [1280, 900, "1280"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: "block" });
    await ctx.addCookies([{ name: "nudge_session", value: cookieVal, url: base }]);
    const page = await ctx.newPage();
    // Screenshots only: block every write so viewing never confirms or skips anything.
    await page.route(/\/api\/schedules\/.*\/occurrences\//, (route) => route.abort());
    const shot = async (name) => { await page.waitForTimeout(300); const path = join(out, `schedules-${tag}-${name}.png`); await page.screenshot({ path, fullPage: true }); console.log(path); };
    await page.goto(base + "/#/rides", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#regular-upcoming");
    await page.waitForSelector(".tab-badge");
    await shot("1-rides-confirm-list");
    await page.goto(base + "/#/clients/" + client.id, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".schedule-card");
    await shot("2-client-detail-schedules");
    await page.goto(base + "/#/clients/" + client.id + "/schedule/" + s1.data.schedule.id, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sf");
    await shot("3-schedule-editor");
    await page.goto(base + "/#/clients/" + client2.id + "/schedule/new", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sf");
    await page.click("label.day:has([data-md='30']) span");
    await page.click("label.day:has([data-md='31']) span");
    await page.waitForSelector("#s-monthnote:not(:empty)");
    assert.equal(await page.isChecked("[data-md='31']"), true);
    await shot("4-new-schedule-month-end-note");
    await page.goto(base + `/#/regular/${s2.data.schedule.id}/${firstJordan.date}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#of");
    await shot("5-edit-then-confirm");
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
