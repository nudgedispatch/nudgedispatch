#!/usr/bin/env node
// Pre-deploy gate for the public booking page: real client journeys on a phone (390px) and a
// tablet/desktop (1024px) against a local Worker with a throwaway D1. Never submits a booking and
// never talks to production. Iron Gate's deploy/predeploy-e2e.sh is the model; it caught the
// airport field flip that isolated field tests missed.
//
// Usage: node scripts/e2e/booking-journeys.mjs   (env: CHROME_PATH, SCREENSHOT_DIR, E2E_STAMP)
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const shots = process.env.SCREENSHOT_DIR || join(root, "e2e-artifacts");
mkdirSync(shots, { recursive: true });
const ADMIN = "e2e-admin-token";
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail: String(detail).slice(0, 300) });
  console.log((cond ? "PASS " : "FAIL ") + name + (detail && !cond ? " :: " + String(detail).slice(0, 300) : ""));
}

async function migrate(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo], { cwd: root, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("migrations exited " + code))));
  });
}
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
async function tenant(worker, email, name, drivers) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName: name, accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "e2e-owner-pass-1" } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const settings = await call(worker, "/api/settings", { session });
  const r = await call(worker, "/api/rate-sheet", { method: "PUT", session, body: { enabled: true, rateSheet: {
    vehicles: [{ name: "Sedan", seats: 4, base: "15", perMile: "2.5" }, { name: "SUV", seats: 6, base: "20", perMile: "3" }],
    flatFares: [
      { place: "ATL Airport", placeKeywords: "atl, airport", prices: { Sedan: { oneWay: "95" }, SUV: { oneWay: "145" } } },
      { place: "ATL International", placeKeywords: "international terminal", prices: { Sedan: { oneWay: "110" }, SUV: { oneWay: "160" } } },
    ],
  } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const d of drivers) {
    const res = await call(worker, "/api/drivers", { method: "POST", session, body: d });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }
  const air = await call(worker, "/api/booking-settings", { method: "PUT", session, body: { preset: ["ATL"] } });
  assert.equal(air.status, 200, JSON.stringify(air.data));
  return settings.data.settings.bookingSlug;
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-e2e-"));
let worker;
let browser;
let submits = 0;
try {
  await migrate(persistTo);
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", QUOTE_DEV_FAKE_ROUTE: "1", FLIGHT_DATA_PROVIDER: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const base = `http://${worker.address}:${worker.port}`;
  assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "local worker only");
  const suvOnly = await tenant(worker, "suv-only@example.test", "Black SUV Cars", [{ name: "Dee Driver", vehicle: "Black Chevy Suburban" }]);
  const mixed = await tenant(worker, "mixed@example.test", "Mixed Fleet Cars", [{ name: "Sam Sedan", vehicle: "Lincoln Continental sedan" }, { name: "Uma Suv", vehicle: "Cadillac Escalade" }]);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  for (const [vw, vh, tag] of [[390, 844, "mobile-390"], [1024, 900, "desktop-1024"]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await ctx.newPage();
    // Hard stop on any real booking submit.
    await page.route(/\/api\/public\/book\/[^/]+$/, (route) => {
      if (route.request().method() === "POST") { submits++; return route.abort(); }
      return route.continue();
    });
    const vis = (sel) => page.locator(sel).isVisible();
    const val = (sel) => page.locator(sel).inputValue();
    const open = async (slug, qs) => {
      await page.goto(`${base}/book/${slug}${qs || ""}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("body[data-ready='1']", { timeout: 20000 });
    };
    const shot = (name) => page.screenshot({ path: join(shots, `nudge-${tag}-${name}.png`), fullPage: true });
    const quoteText = async () => {
      await page.waitForFunction(() => { const q = document.querySelector("#quote"); return q && q.dataset.state !== "pending"; }, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(250);
      return (await vis("#quote")) ? await page.locator("#qPrice").textContent() : "";
    };

    // 1. From the quote: airport pickup prefilled.
    await open(suvOnly, "?airport=pickup&code=ATL&spot=domestic-south&dropoff=" + encodeURIComponent("100 Main St, Alpharetta"));
    check(`${tag} prefill pickup: terminal dropdown on Pickup`, (await vis("#pickupSpot")) && (await val("#pickupSpot")) === "domestic-south");
    check(`${tag} prefill pickup: Pickup is not a text box`, !(await vis("#pickup")));
    check(`${tag} prefill pickup: Drop-off is a typed address`, (await vis("#dropoff")) && (await val("#dropoff")) === "100 Main St, Alpharetta" && !(await vis("#dropoffSpot")));
    check(`${tag} black SUV meets at Legacy West Curb`, (await val("#meet")) === "legacy-west-curb" && /Legacy West Curb, zones W1 and W2/.test(await page.locator("#meetNote").textContent()));
    check(`${tag} black SUV: Legacy West Curb is fixed (no meeting choice, no inside option)`, !(await vis("#meet")) && (await vis("#meetFixed")) && (await page.locator("#meetFixed").textContent()) === "Legacy West Curb (W1 and W2)" && JSON.stringify(await page.locator("#meet option").allTextContents()) === JSON.stringify(["Legacy West Curb (W1 and W2)"]));
    check(`${tag} arrival labels and tracking hint`, (await page.locator("#dateLabel").textContent()) === "Arrival date" && (await vis("#timeHint")) && (await vis("#flight")));
    const order = await page.evaluate(() => ["#pickupSpot", "#meetWrap", "[name=date]", "[name=time]", "#flight", "[name=passengers]", "[name=luggage]", "#dropoff", "#quote", "#vehicle"].map((s) => document.querySelector(s).getBoundingClientRect().top + window.scrollY));
    check(`${tag} airport-pickup field order`, order.every((y, i) => i === 0 || y >= order[i - 1] - 1), JSON.stringify(order));
    check(`${tag} quote after addresses ($145 SUV)`, (await quoteText()) === "$145");
    check(`${tag} SUV-only fleet: no sedan offered`, JSON.stringify(await page.locator("#vehicle option").allTextContents()) === JSON.stringify(["SUV (up to 6)"]));
    await shot("prefill-airport-pickup");

    // 2. The Iron Gate flip case: quote says city -> ATL, connection says Pickup at ATL.
    await open(suvOnly, "?airport=from_atl&pickup=Alpharetta&dropoff=" + encodeURIComponent("ATL Airport Domestic Terminal North"));
    check(`${tag} quote ATL destination + Pickup at ATL: terminal goes to Pickup`, (await val("#pickupSpot")) === "domestic-north" && (await vis("#pickupSpot")));
    check(`${tag} ... and Drop-off stays a typed address without the airport`, (await vis("#dropoff")) && !/ATL|Airport/i.test(await val("#dropoff")), await val("#dropoff"));
    await shot("prefill-flip-case");

    // 3. Switch the airport connection both ways.
    await open(suvOnly, "?airport=pickup&spot=international&dropoff=" + encodeURIComponent("100 Main St, Alpharetta"));
    check(`${tag} International quote uses the international fare`, (await quoteText()) === "$160");
    await page.selectOption("#airportSide", "dropoff:ATL");
    check(`${tag} switch to Drop-off at ATL: terminal moves to Drop-off`, (await vis("#dropoffSpot")) && (await val("#dropoffSpot")) === "international" && !(await vis("#pickupSpot")));
    check(`${tag} ... Pickup is a typed address without the airport`, (await vis("#pickup")) && !/ATL|Airport/i.test(await val("#pickup")));
    check(`${tag} ... International drop-off: no topside/curbside choice`, !(await vis("#styleWrap")) && !(await vis("#meetWrap")) && !/topside/i.test(await page.locator("form").innerText()));
    await page.selectOption("#dropoffSpot", "domestic-south");
    check(`${tag} ... Delta (Domestic South) drop-off defaults to topside`, (await vis("#style")) && (await val("#style")) === "topside" && !(await vis("#meetWrap")));
    await page.selectOption("#dropoffSpot", "domestic-north");
    check(`${tag} ... Domestic North drop-off: no topside/curbside choice`, !(await vis("#styleWrap")) && !/topside/i.test(await page.locator("form").innerText()));
    await page.selectOption("#dropoffSpot", "international");
    await page.selectOption("#airportSide", "pickup:ATL");
    check(`${tag} switch back to Pickup at ATL: terminal on Pickup`, (await vis("#pickupSpot")) && (await val("#pickupSpot")) === "international" && (await vis("#dropoff")) && !(await vis("#dropoffSpot")));
    await page.selectOption("#airportSide", "none");
    check(`${tag} no airport connection: both typed`, (await vis("#pickup")) && (await vis("#dropoff")) && !(await vis("#meet")) && !(await vis("#style")) && !(await vis("#flight")));
    await page.selectOption("#airportSide", "pickup:ATL");
    await page.selectOption("#pickupSpot", "domestic-north");
    await page.selectOption("#airportSide", "dropoff:ATL");
    await page.selectOption("#airportSide", "pickup:ATL");
    check(`${tag} after several switches the terminal is still on the airport side`, (await val("#pickupSpot")) === "domestic-north" && !/ATL|Airport/i.test(await val("#dropoff")));
    await shot("after-switches");

    // 4. Quote only after both addresses; typed trip.
    await open(suvOnly);
    check(`${tag} no quote before addresses`, !(await vis("#quote")));
    await page.fill("#pickup", "12 Oak Lane, Roswell");
    await page.waitForTimeout(800);
    check(`${tag} no quote with only a pickup`, !(await vis("#quote")));
    await page.fill("#dropoff", "500 Peachtree St, Atlanta");
    await page.waitForSelector("#quote[data-state='ok']", { timeout: 8000 }).catch(() => {});
    check(`${tag} quote after both addresses`, /\$/.test(await quoteText()), await page.locator("#quote").textContent());

    // 5. Passenger count drives the vehicle (mixed fleet, sedan holds 3).
    await open(mixed);
    await page.fill("[name=passengers]", "2");
    await page.dispatchEvent("[name=passengers]", "change");
    check(`${tag} 2 passengers: sedan or SUV, sedan first`, JSON.stringify(await page.locator("#vehicle option").allTextContents()) === JSON.stringify(["Sedan (up to 3)", "SUV (up to 6)"]) && (await val("#vehicle")) === "sedan");
    await page.fill("[name=passengers]", "4");
    await page.dispatchEvent("[name=passengers]", "change");
    check(`${tag} 4 passengers: SUV only`, JSON.stringify(await page.locator("#vehicle option").allTextContents()) === JSON.stringify(["SUV (up to 6)"]));
    await shot("mixed-fleet-4-passengers");
    // Mixed fleet: a sedan keeps its own meeting choices; the SUV gets Legacy West Curb only.
    await page.fill("[name=passengers]", "2");
    await page.dispatchEvent("[name=passengers]", "change");
    await page.selectOption("#airportSide", "pickup:ATL");
    await page.selectOption("#pickupSpot", "domestic-north");
    await page.selectOption("#vehicle", "sedan");
    check(`${tag} sedan pickup: curbside or inside meet-and-greet`, (await vis("#meet")) && JSON.stringify(await page.locator("#meet option").allTextContents()) === JSON.stringify(["Curbside", "Inside meet-and-greet"]));
    await page.selectOption("#vehicle", "suv");
    check(`${tag} SUV pickup in a mixed fleet: Legacy West Curb only`, !(await vis("#meet")) && (await page.locator("#meetFixed").textContent()) === "Legacy West Curb (W1 and W2)");
    await shot("mixed-fleet-meeting-points");

    // 6. Airport pickup through to review (no submit).
    await open(suvOnly, "?airport=pickup&spot=domestic-south&dropoff=" + encodeURIComponent("100 Main St, Alpharetta"));
    await page.fill("#flight", "DL1234");
    await page.fill("[name=luggage]", "2");
    await page.selectOption("[name=time]", "15:30");
    await page.click("#toContact");
    check(`${tag} continue to contact`, await vis("[name=name]"), await page.locator("#err").textContent());
    await page.fill("[name=name]", "Pat Rider");
    await page.fill("[name=phone]", "404-555-0123");
    await page.click("#toReview");
    const review = await page.locator("#reviewTable").textContent();
    check(`${tag} review shows terminal, Legacy West Curb, flight, luggage`, /Domestic Terminal South/.test(review) && /Legacy West Curb \(W1 and W2\)/.test(review) && /DL1234/.test(review) && /Luggage2/.test(review), review);
    check(`${tag} review explains the meeting point`, /Legacy West Curb, zones W1 and W2/.test(await page.locator("#reviewMeet").textContent()));
    await shot("review-airport-pickup");

    // 7. Airport drop-off through to review, client picks curbside.
    await open(suvOnly, "?airport=dropoff&spot=domestic-south&pickup=" + encodeURIComponent("100 Main St, Alpharetta"));
    check(`${tag} prefill drop-off: terminal on Drop-off, typed Pickup`, (await val("#dropoffSpot")) === "domestic-south" && (await val("#pickup")) === "100 Main St, Alpharetta");
    await page.selectOption("#style", "curbside");
    check(`${tag} curbside or topside: same fare`, (await quoteText()) === "$145");
    await page.selectOption("[name=time]", "09:00");
    await page.click("#toContact");
    await page.fill("[name=name]", "Pat Rider");
    await page.fill("[name=phone]", "404-555-0123");
    await page.click("#toReview");
    const review2 = await page.locator("#reviewTable").textContent();
    check(`${tag} drop-off review shows Curbside`, /Drop-off at terminalCurbside/.test(review2), review2);
    await shot("review-airport-dropoff");
    await ctx.close();
  }
  check("no booking was submitted", submits === 0, String(submits));
} catch (error) {
  check("journeys ran", false, error && error.stack ? error.stack : String(error));
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(shots, "nudge-e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`booking journeys: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
if (process.env.E2E_STAMP) {
  let sha = "unknown";
  try { sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
  writeFileSync(process.env.E2E_STAMP, `sha=${sha}\nok=yes\nchecks=${results.length}\nran_at=${new Date().toISOString()}\n`);
}
