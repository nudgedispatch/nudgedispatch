#!/usr/bin/env node
// Local screenshots of the post-login "Add Nudge to your home screen" prompt.
// Uses wrangler dev against a throwaway local D1. Never talks to production.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const shots = process.env.SCREENSHOT_DIR || "/workspace/nudge-a2hs-preview";
mkdirSync(shots, { recursive: true });
const ADMIN = "shots-admin-token";
const PASSWORD = "shots-owner-pass-1";
const EMAIL = "a2hs-owner@example.test";

const IOS_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

async function stubAndroidPrompt(page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt");
    event.preventDefault = () => {};
    event.prompt = () => Promise.resolve();
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
  });
}

async function login(page, { stubPrompt } = {}) {
  await page.goto(page._a2hsOrigin + "/#/login", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 20000 });
  if (stubPrompt) await stubAndroidPrompt(page);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("#f button[type=submit]");
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-a2hs-shots-"));
let worker;
let browser;
try {
  await migrate(persistTo);
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: EMAIL, companyName: "Sample Car Service", accountKind: "individual" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: PASSWORD, termsAccepted: true } });
  assert.equal(acc.data.ok, true, JSON.stringify(acc.data));
  const logout = await call(worker, "/api/logout", { method: "POST", body: {}, session: { cookie: acc.cookie, csrf: acc.data.csrf } });
  assert.ok(logout.status === 200 || logout.data.ok, JSON.stringify(logout.data));

  const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
  browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox", "--disable-gpu"] });
  const origin = `http://${worker.address}:${worker.port}`;

  async function openPage({ width, height, userAgent, standalone = false, isMobile = true }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: width <= 400 ? 2 : 1,
      userAgent,
      isMobile,
      serviceWorkers: "block",
    });
    if (standalone) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          if (String(query).includes("display-mode: standalone")) {
            return {
              matches: true,
              media: query,
              onchange: null,
              addListener() {},
              removeListener() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent() { return false; },
            };
          }
          return orig(query);
        };
      });
    }
    const page = await context.newPage();
    page._a2hsOrigin = origin;
    return { context, page };
  }

  async function shotShown(name, page, variant) {
    await page.waitForSelector("#a2hs", { timeout: 10000 });
    const got = await page.getAttribute("#a2hs", "data-variant");
    assert.equal(got, variant, name + " variant");
    assert.equal(await page.isVisible("#a2hs"), true);
    await page.screenshot({ path: join(shots, name) });
    console.log("wrote", join(shots, name), "variant=", got);
  }

  async function shotHidden(name, page) {
    await page.waitForFunction(() => /#\/(rides|admin)/.test(location.hash), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const count = await page.locator("#a2hs").count();
    assert.equal(count, 0, name + " should hide the prompt");
    await page.screenshot({ path: join(shots, name) });
    console.log("wrote", join(shots, name), "hidden=true");
  }

  for (const width of [390, 768, 1024]) {
    const height = width === 390 ? 844 : width === 768 ? 1024 : 768;
    const ios = await openPage({ width, height, userAgent: IOS_SAFARI });
    await login(ios.page);
    await shotShown(`a2hs-ios-safari-${width}.png`, ios.page, "ios-safari");
    await ios.context.close();

    const android = await openPage({ width, height, userAgent: ANDROID_CHROME });
    await login(android.page, { stubPrompt: true });
    await shotShown(`a2hs-android-${width}.png`, android.page, "android");
    await android.context.close();
  }

  const iosOther = await openPage({ width: 390, height: 844, userAgent: IOS_CHROME });
  await login(iosOther.page);
  await shotShown("a2hs-ios-other-390.png", iosOther.page, "ios-other");
  await iosOther.context.close();

  const desktop = await openPage({ width: 1024, height: 900, userAgent: DESKTOP_CHROME, isMobile: false });
  await login(desktop.page, { stubPrompt: true });
  await shotHidden("a2hs-desktop-hide-1024.png", desktop.page);
  await desktop.context.close();

  const installed = await openPage({ width: 390, height: 844, userAgent: IOS_SAFARI, standalone: true });
  await login(installed.page);
  await shotHidden("a2hs-standalone-hide-390.png", installed.page);
  await installed.context.close();

  const androidInstalled = await openPage({ width: 390, height: 844, userAgent: ANDROID_CHROME, standalone: true });
  await login(androidInstalled.page, { stubPrompt: true });
  await shotHidden("a2hs-standalone-android-hide-390.png", androidInstalled.page);
  await androidInstalled.context.close();

  console.log("shots ok", origin);
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
