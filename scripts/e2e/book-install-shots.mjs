#!/usr/bin/env node
// Local screenshots of the booking-page install UI. Never talks to production and never submits a booking.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const shots = process.env.SCREENSHOT_DIR || join(root, "../qa/nudge-book-install");
mkdirSync(shots, { recursive: true });
const ADMIN = "shots-admin-token";
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

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

async function fakeInstallPrompt(page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt");
    event.preventDefault = () => {};
    event.prompt = () => Promise.resolve();
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
  });
  await page.waitForSelector("#installApp:not(.hidden)", { timeout: 5000 });
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-book-shots-"));
let worker;
let browser;
try {
  await migrate(persistTo);
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "shots@example.test", companyName: "Bailey Consulting", accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "shots-owner-pass-1" } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const settings = await call(worker, "/api/settings", { session });
  const slug = settings.data.settings.bookingSlug;
  const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
  browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox", "--disable-gpu"] });
  const origin = `http://${worker.address}:${worker.port}`;
  const url = `${origin}/book/${slug}/`;

  async function openPage({ width, height, userAgent, serviceWorkers = "block" }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: width <= 400 ? 2 : 1,
      userAgent: userAgent || undefined,
      serviceWorkers,
    });
    const page = await context.newPage();
    await page.route(/\/api\/public\/book\/[^/]+$/, (route) => {
      if (route.request().method() === "POST") return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body[data-ready='1']", { timeout: 20000 });
    const title = await page.title();
    const apple = await page.getAttribute('meta[name="apple-mobile-web-app-title"]', "content");
    return { context, page, title, apple };
  }

  const phone = await openPage({ width: 390, height: 844 });
  assert.equal(phone.title, "Bailey Consulting");
  assert.equal(phone.apple, "Bailey");
  await fakeInstallPrompt(phone.page);
  await phone.page.screenshot({ path: join(shots, "book-install-390.png"), fullPage: true });
  console.log("wrote", join(shots, "book-install-390.png"), "title=", phone.title, "apple=", phone.apple);
  await phone.context.close();

  const desktop = await openPage({ width: 1024, height: 900 });
  await fakeInstallPrompt(desktop.page);
  await desktop.page.screenshot({ path: join(shots, "book-install-desktop.png"), fullPage: true });
  console.log("wrote", join(shots, "book-install-desktop.png"), "title=", desktop.title, "apple=", desktop.apple);
  await desktop.context.close();

  const ios = await openPage({ width: 390, height: 844, userAgent: IOS_UA });
  await ios.page.waitForSelector("#iosInstallHint:not(.hidden)", { timeout: 5000 });
  const hintVisible = await ios.page.isVisible("#iosInstallHint");
  const btnHidden = await ios.page.locator("#installApp").evaluate((el) => el.classList.contains("hidden"));
  assert.equal(hintVisible, true);
  assert.equal(btnHidden, true);
  await ios.page.screenshot({ path: join(shots, "book-install-ios-hint-390.png"), fullPage: true });
  console.log("wrote", join(shots, "book-install-ios-hint-390.png"), "hintVisible=", hintVisible);
  await ios.context.close();

  console.log("shots ok", url);
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
