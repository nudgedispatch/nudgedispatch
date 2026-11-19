import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { GSL_BRAND } from "../app/brand.js";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;

function wrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("wrangler exited " + code))));
  });
}

async function call(worker, path, { method = "GET", body, session, admin = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  const cookie = (response.headers.getSetCookie?.() || []).map((l) => l.split(";")[0]).find((p) => p.startsWith("nudge_session=")) || session?.cookie || "";
  return { status: response.status, data, text, cookie, headers: response.headers };
}

async function owner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
  const settings = await call(worker, "/api/settings", { session });
  return { session, slug: settings.data.settings.bookingSlug };
}

const LIGHT = { mode: "simple", simple: { base: "light", primary: "#1f3a5f", accent: "#1f3a5f", background: "#ffffff", text: "#111111" }, pair: "modern" };
const DARK = { mode: "simple", simple: { base: "dark", primary: "#e8d060", accent: "#e8d060", background: "#0b0b0b", text: "#f5f0e6" }, pair: "classic" };
const UNREADABLE = { mode: "simple", simple: { base: "light", primary: "#ffff66", accent: "#dddddd", background: "#ffffff", text: "#bbbbbb" }, pair: "standard" };

test("brand settings: contrast gate, trial gating, admin assisted setup, QR + manifest", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-brand-settings-"));
  let worker;
  const sql = (command) => wrangler(["d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--command", command]);
  try {
    await wrangler(["d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off", PLATFORM_ADMIN_EMAILS: "assisted-owner@example.test" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const paid = await owner(worker, "paid-owner@example.test", "Paid Sample Limo");
    const trial = await owner(worker, "trial-owner@example.test", "Trial Sample Rides");
    await owner(worker, "assisted-owner@example.test", "Assisted Sample Cars");
    await sql(`UPDATE companies SET trial_status = 'active' WHERE booking_slug = '${paid.slug}'`);

    // Trial owner: locked screen, cannot save, no brand renders.
    const tGet = await call(worker, "/api/brand", { session: trial.session });
    assert.equal(tGet.status, 200);
    assert.equal(tGet.data.locked, true);
    assert.match(tGet.data.lockedText, /free trial uses the standard/i);
    const tPut = await call(worker, "/api/brand", { method: "PUT", session: trial.session, body: LIGHT });
    assert.equal(tPut.status, 403);
    assert.equal((await call(worker, `/book/${trial.slug}/theme.css`)).text, "");

    // An owner-source brand smuggled onto a trial company is ignored at render.
    const ownerJson = JSON.stringify({ ...GSL_BRAND, source: "owner" }).replace(/'/g, "''");
    await sql(`INSERT INTO invoice_settings (company_id, brand_json, updated_at) SELECT id, '${ownerJson}', 0 FROM companies WHERE booking_slug = '${trial.slug}' AND 1 ON CONFLICT(company_id) DO UPDATE SET brand_json = excluded.brand_json`);
    assert.equal((await call(worker, `/book/${trial.slug}/theme.css`)).text, "");
    assert.match((await call(worker, `/book/${trial.slug}/`)).text, /<meta name="theme-color" content="#0b0b0b">/);
    assert.equal((await call(worker, `/book/${trial.slug}/qr/theme.css`)).text, "");

    // Paid owner: unlocked; unreadable colors are rejected server-side with problems.
    const pGet = await call(worker, "/api/brand", { session: paid.session });
    assert.equal(pGet.data.locked, false);
    const bad = await call(worker, "/api/brand", { method: "PUT", session: paid.session, body: UNREADABLE });
    assert.equal(bad.status, 400);
    assert.ok(bad.data.problems.length >= 3, JSON.stringify(bad.data));
    const check = await call(worker, "/api/brand/check", { method: "POST", session: paid.session, body: UNREADABLE });
    assert.ok(check.data.problems.some((p) => p.key === "text-bg"));
    const noCsrf = await call(worker, "/api/brand/check", { method: "POST", session: { cookie: paid.session.cookie }, body: LIGHT });
    assert.equal(noCsrf.status, 403);

    // Paid owner saves light brand + logo; renders on booking page, QR, manifests.
    const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const ok = await call(worker, "/api/brand", { method: "PUT", session: paid.session, body: { ...LIGHT, logoDataUrl: logo } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.renders, true);
    assert.equal(ok.data.brand.source, "owner");
    assert.equal(ok.data.logoDataUrl, logo);
    const css = await call(worker, `/book/${paid.slug}/theme.css`);
    assert.match(css.text, /--bg:#ffffff/);
    assert.match(css.text, /Montserrat/);
    const qrPage = await call(worker, `/book/${paid.slug}/qr/`);
    assert.match(qrPage.text, new RegExp(`href="/book/${paid.slug}/qr/theme.css"`));
    assert.match((await call(worker, `/book/${paid.slug}/qr/theme.css`)).text, /body\.qrpage/);
    const man = await call(worker, `/book/${paid.slug}/manifest.webmanifest`);
    assert.equal(man.data.background_color, "#ffffff");
    const qrMan = await call(worker, `/book/${paid.slug}/qr/manifest.webmanifest`);
    assert.equal(qrMan.data.background_color, "#ffffff");
    const preview = await call(worker, "/api/brand/preview.css?b=" + encodeURIComponent(JSON.stringify(ok.data.brand)), { session: paid.session });
    assert.match(preview.text, /#brand-live \.bookpage-mock\{/);
    assert.doesNotMatch(preview.text, /html\{/);
    assert.equal((await call(worker, "/api/brand/preview.css?b=x")).status, 401);

    // Dark save works (Draft D palette).
    const dark = await call(worker, "/api/brand", { method: "PUT", session: paid.session, body: DARK });
    assert.equal(dark.status, 200, JSON.stringify(dark.data));
    assert.match((await call(worker, `/book/${paid.slug}/theme.css`)).text, /color-scheme:dark/);

    // Reset to standard look.
    const reset = await call(worker, "/api/brand", { method: "DELETE", session: paid.session, body: {} });
    assert.equal(reset.status, 200);
    assert.equal(reset.data.brand, null);
    assert.equal((await call(worker, `/book/${paid.slug}/theme.css`)).text, "");

    // Platform admin (assisted setup) brands a trial company; it renders despite the trial.
    await sql(`UPDATE users SET platform_admin = 1 WHERE email = 'assisted-owner@example.test'`);
    const adminLogin = await call(worker, "/api/login", { method: "POST", body: { email: "assisted-owner@example.test", password: "sample-owner-pass" } });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
    const adminSession = { cookie: adminLogin.cookie, csrf: adminLogin.data.csrf || "" };
    const ids = await call(worker, "/api/platform/accounts", { session: adminSession });
    assert.equal(ids.status, 200, JSON.stringify(ids.data));
    const trialId = ids.data.accounts.find((x) => x.name === "Trial Sample Rides").id;
    const notOwner = await call(worker, `/api/platform/companies/${trialId}/brand`, { method: "PUT", session: paid.session, body: LIGHT });
    assert.equal(notOwner.status, 404);
    const aPut = await call(worker, `/api/platform/companies/${trialId}/brand`, { method: "PUT", session: adminSession, body: DARK });
    assert.equal(aPut.status, 200, JSON.stringify(aPut.data));
    assert.equal(aPut.data.brand.source, "admin");
    assert.equal(aPut.data.renders, true);
    assert.match((await call(worker, `/book/${trial.slug}/theme.css`)).text, /--bg:#0b0b0b/);
    const tAfter = await call(worker, "/api/brand", { session: trial.session });
    assert.equal(tAfter.data.locked, true);
    assert.match(tAfter.data.lockedText, /set up for you/);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
