#!/usr/bin/env node
// Local screenshots and headless checks for /book/<slug>/qr/. Never talks to production.
// Usage: node scripts/e2e/qr-shots.mjs [logo.png] [logo.webp]   (SCREENSHOT_DIR defaults to ../nudge-qr-preview)
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const shots = process.env.SCREENSHOT_DIR || join(root, "../nudge-qr-preview");
mkdirSync(shots, { recursive: true });
const ADMIN = "shots-admin-token";
const [pngLogoPath, webpLogoPath] = process.argv.slice(2);

function dataUrl(path, type) {
  return path ? `data:image/${type};base64,` + readFileSync(path).toString("base64") : "";
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

async function company(worker, email, name, logoDataUrl) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName: name, accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "shots-owner-pass-1", termsAccepted: true } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const s = (await call(worker, "/api/settings", { session })).data.settings;
  if (logoDataUrl) {
    const put = await call(worker, "/api/settings", { method: "PUT", session, body: {
      businessName: name, address: s.address, phone: s.phone, email: s.email, website: s.website, prefix: s.prefix,
      nextNumber: s.nextNumber, paymentInstructions: s.paymentInstructions, terms: s.terms, gratuityNote: s.gratuityNote, logoDataUrl,
    } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
  }
  return { session, slug: s.bookingSlug, cookie: acc.cookie };
}

function decode(path) {
  const out = spawnSync("python3", ["-c", "import sys\nfrom PIL import Image\nfrom pyzbar.pyzbar import decode\nprint('\\n'.join(r.data.decode() for r in decode(Image.open(sys.argv[1]).convert('L'))))", path], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

const persistTo = mkdtempSync(join(tmpdir(), "nudge-qr-shots-"));
let worker;
let browser;
try {
  await migrate(persistTo);
  worker = await unstable_dev("app/index.js", {
    config: join(root, "wrangler.toml"), local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  const origin = `http://${worker.address}:${worker.port}`;
  const variants = [{ key: "png-logo", email: "qr-png@example.test", logo: dataUrl(pngLogoPath, "png") }];
  if (webpLogoPath) variants.push({ key: "webp-logo", email: "qr-webp@example.test", logo: dataUrl(webpLogoPath, "webp") });
  for (const v of variants) Object.assign(v, await company(worker, v.email, "The Gold Standard Limo", v.logo));

  const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
  browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox", "--disable-gpu"] });

  for (const v of variants) {
    const qrUrl = `${origin}/book/${v.slug}/qr/`;
    const expected = `${origin}/book/${v.slug}/`;
    for (const [width, height] of [[390, 844], [1280, 900]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width <= 400 ? 2 : 1, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(qrUrl, { waitUntil: "networkidle" });
      const loaded = await page.$eval("#qrImg", (img) => img.complete && img.naturalWidth > 0);
      assert.equal(loaded, true);
      const file = join(shots, `qr-${v.key}-${width}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const qrShot = join(shots, `qr-${v.key}-${width}-code-only.png`);
      await page.locator("#qrImg").screenshot({ path: qrShot });
      assert.equal(decode(file), expected, "full-page screenshot decodes");
      assert.equal(decode(qrShot), expected, "on-screen QR decodes");
      const fits = await page.evaluate(() => {
        const r = document.querySelector(".qr-actions").getBoundingClientRect();
        return { bottom: r.bottom, vh: innerHeight, scrollW: document.documentElement.scrollWidth, w: innerWidth };
      });
      assert.ok(fits.scrollW <= fits.w, "no horizontal scroll");
      console.log("wrote", file, "decoded=", expected, "buttonsBottom=", Math.round(fits.bottom), "of", fits.vh);
      await context.close();
    }
  }

  // Share behaviour: stub navigator.share/canShare to confirm the PNG file is attached when files are supported,
  // and that the button copies the link when Web Share is missing.
  const v = variants[0];
  const qrUrl = `${origin}/book/${v.slug}/qr/`;
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.addInitScript(() => {
      window.__shared = [];
      navigator.share = (data) => { window.__shared.push({ title: data.title, text: data.text, url: data.url, files: (data.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })) }); return Promise.resolve(); };
      navigator.canShare = (data) => Boolean(data && data.files && data.files.every((f) => f.type === "image/png"));
    });
    const page = await context.newPage();
    await page.goto(qrUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(shots, "qr-png-logo-390-share-supported.png") });
    await page.click("#qrShare");
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].files.length, 1);
    assert.equal(shared[0].files[0].type, "image/png");
    assert.match(shared[0].files[0].name, /-booking-qr\.png$/);
    assert.ok(shared[0].text.includes(`${origin}/book/${v.slug}/`));
    console.log("share with file ok", JSON.stringify(shared[0]));
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });
    await context.addInitScript(() => { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) { /* ignore */ } });
    const page = await context.newPage();
    await page.goto(qrUrl, { waitUntil: "networkidle" });
    assert.equal(await page.textContent("#qrShare"), "Copy link");
    await page.click("#qrShare");
    await page.waitForFunction(() => document.querySelector("#qrNote").textContent.length > 0);
    const note = await page.textContent("#qrNote");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip, `${origin}/book/${v.slug}/`);
    console.log("copy fallback ok:", note);
    const save = await page.getAttribute("#qrSave", "download");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#qrSave")]);
    const saved = join(shots, "downloaded-" + download.suggestedFilename());
    await download.saveAs(saved);
    assert.equal(decode(saved), `${origin}/book/${v.slug}/`);
    console.log("save image ok", save, saved);
    await context.close();
  }

  // Owner Settings card link.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
    const [name, value] = v.cookie.split("=");
    await context.addCookies([{ name, value, url: origin }]);
    const page = await context.newPage();
    await page.goto(origin + "/#/settings", { waitUntil: "networkidle" });
    await page.waitForSelector("#booking-qr");
    const href = await page.getAttribute("#booking-qr", "href");
    assert.equal(href, qrUrl);
    await page.locator("#booking-card").screenshot({ path: join(shots, "settings-booking-card-390.png") });
    console.log("wrote", join(shots, "settings-booking-card-390.png"), "href=", href);
    await context.close();
  }
  writeFileSync(join(shots, "README.txt"), `Generated by scripts/e2e/qr-shots.mjs on a local Worker (${origin}).\n`);
  console.log("qr shots ok");
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
