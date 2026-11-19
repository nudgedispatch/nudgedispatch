import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

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


test("brand suggest API: paid only, rejects unsafe URLs without fetching, per-company rate limit", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-brand-suggest-"));
  let worker;
  const sql = (command) => wrangler(["d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--command", command]);
  try {
    await wrangler(["d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const paid = await owner(worker, "suggest-paid@example.test", "Suggest Paid Cars");
    const trial = await owner(worker, "suggest-trial@example.test", "Suggest Trial Cars");
    await sql(`UPDATE companies SET trial_status = 'active' WHERE booking_slug = '${paid.slug}'`);
    const t = await call(worker, "/api/brand/suggest", { method: "POST", session: trial.session, body: { url: "https://example.com" } });
    assert.equal(t.status, 403);
    for (const url of ["http://example.com", "https://127.0.0.1", "https://169.254.169.254/latest/meta-data", "https://localhost:8787", "https://[::1]/"]) {
      const r = await call(worker, "/api/brand/suggest", { method: "POST", session: paid.session, body: { url } });
      assert.equal(r.status, 400, url + " " + JSON.stringify(r.data));
      assert.equal(r.data.code, "url");
    }
    for (let i = 0; i < 5; i++) await call(worker, "/api/brand/suggest", { method: "POST", session: paid.session, body: { url: "ftp://x" } });
    const limited = await call(worker, "/api/brand/suggest", { method: "POST", session: paid.session, body: { url: "ftp://x" } });
    assert.equal(limited.status, 429);
    const noCsrf = await call(worker, "/api/brand/suggest", { method: "POST", session: { cookie: paid.session.cookie }, body: { url: "https://example.com" } });
    assert.equal(noCsrf.status, 403);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
