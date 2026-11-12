import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}

async function call(worker, path, { method = "GET", body, session, admin = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text };
  }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || ""), text, headers: response.headers };
}

function sessionOf(result) {
  return { cookie: result.cookie, csrf: result.data.csrf || "" };
}

async function applyMigrations(persistTo) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo],
      { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, CI: "1" }, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

test("booking HTML is rendered per slug with escaped titles and no-store", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-book-pwa-"));
  let worker;
  try {
    await applyMigrations(persistTo);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml",
      local: true,
      persist: true,
      persistTo,
      logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });

    const invite = await call(worker, "/api/admin/invites", {
      method: "POST",
      admin: true,
      body: { email: "pwa-owner@example.test", companyName: `Acme <Rides> & "Co'`, accountKind: "fleet" },
    });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", {
      method: "POST",
      body: { token: invite.data.inviteToken, password: "sample-owner-pass" },
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    const session = sessionOf(accepted);
    const settings = await call(worker, "/api/settings", { session });
    assert.equal(settings.status, 200, JSON.stringify(settings.data));
    const slug = settings.data.settings.bookingSlug;
    assert.ok(slug);

    const page = await call(worker, `/book/${slug}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control") || "", /no-store/i);
    assert.match(page.headers.get("content-type") || "", /text\/html/);
    assert.match(page.text, /<title>Acme &lt;Rides&gt; &amp; &quot;Co&#39;<\/title>/);
    assert.match(page.text, /<meta name="apple-mobile-web-app-title" content="Acme">/);
    assert.doesNotMatch(page.text, /<title>Book a ride<\/title>/);
    assert.doesNotMatch(page.text, contentRe("Acme <Rides>"));
    assert.match(page.text, /id="installBar"/);
    assert.match(page.text, /src="\/book\.js\?v=/);

    const manifest = await call(worker, `/book/${slug}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get("cache-control") || "", /no-store/i);
    assert.equal(manifest.data.short_name, "Acme");
    assert.equal(manifest.data.name, `Acme <Rides> & "Co' — Book a ride`);
    assert.equal(manifest.data.start_url, `/book/${slug}/`);

    const missing = await call(worker, "/book/this-slug-does-not-exist/");
    assert.equal(missing.status, 200);
    assert.match(missing.headers.get("cache-control") || "", /no-store/i);
    assert.match(missing.text, /<title>Book a ride<\/title>/);
    assert.match(missing.text, /<meta name="apple-mobile-web-app-title" content="Book a ride">/);

    const sw = await call(worker, `/book/${slug}/sw.js`);
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get("cache-control") || "", /no-store/i);
    assert.match(sw.text, /nudge-book-shell-v5/);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

function contentRe(raw) {
  return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
