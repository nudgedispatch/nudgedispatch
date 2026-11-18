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
    const child = spawn("npx", ["wrangler", ...args], { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "inherit" });
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
  const buf = Buffer.from(await response.arrayBuffer());
  const text = buf.toString("utf8");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  const cookie = (response.headers.getSetCookie?.() || []).map((l) => l.split(";")[0]).find((p) => p.startsWith("nudge_session=")) || session?.cookie || "";
  return { status: response.status, data, text, buf, cookie, headers: response.headers };
}

async function owner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
  const settings = await call(worker, "/api/settings", { session });
  return settings.data.settings.bookingSlug;
}

test("brand_json themes only its own company's booking page", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-brand-"));
  let worker;
  try {
    await wrangler(["d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const branded = await owner(worker, "brand-owner@example.test", "Gold Sample Limo");
    const plain = await owner(worker, "plain-owner@example.test", "Plain Sample Rides");
    assert.ok(branded && plain && branded !== plain);

    const before = await call(worker, `/book/${branded}/theme.css`);
    assert.equal(before.status, 200);
    assert.equal(before.text, "");

    const json = JSON.stringify(GSL_BRAND).replace(/'/g, "''");
    await wrangler(["d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--command",
      `INSERT INTO invoice_settings (company_id, brand_json, updated_at) SELECT id, '${json}', 0 FROM companies WHERE booking_slug = '${branded}' AND 1 ON CONFLICT(company_id) DO UPDATE SET brand_json = excluded.brand_json`]);

    const css = await call(worker, `/book/${branded}/theme.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") || "", /text\/css/);
    assert.match(css.text, /--bg:#f5f0e6/);
    assert.match(css.text, /Cormorant Garamond/);

    const page = await call(worker, `/book/${branded}/`);
    assert.match(page.text, /<meta name="theme-color" content="#fbf8f1">/);

    const other = await call(worker, `/book/${plain}/theme.css`);
    assert.equal(other.text, "");
    const otherPage = await call(worker, `/book/${plain}/`);
    assert.match(otherPage.text, /<meta name="theme-color" content="#0b0b0b">/);

    const font = await call(worker, "/book-fonts/cormorant-garamond-600.woff2");
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal(font.buf.subarray(0, 4).toString("latin1"), "wOF2");
    assert.equal((await call(worker, "/book-fonts/%2e%2e%2fapp.css")).status, 404);
    assert.equal((await call(worker, "/book-fonts/nope.woff2")).status, 404);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
