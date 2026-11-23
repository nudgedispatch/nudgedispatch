import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;
const SECRET_INSTRUCTIONS = "Zelle the office at 404-555-0199 only.";
const SECRET_HANDLE = "TGSLimoSecret";

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
      { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("local migration exited " + code))));
  });
}

function assertNoPrivateInvoiceLeak(result) {
  const text = result.text;
  assert.doesNotMatch(text, /paymentInstructions/);
  assert.doesNotMatch(text, /payment_instructions/);
  assert.doesNotMatch(text, /paymentMethods/);
  assert.doesNotMatch(text, /payment_methods/);
  assert.doesNotMatch(text, /gratuityNote/);
  assert.doesNotMatch(text, /gratuity_note/);
  assert.doesNotMatch(text, /"terms"/);
  assert.doesNotMatch(text, /nextNumber/);
  assert.doesNotMatch(text, /next_number/);
  assert.doesNotMatch(text, /prefix/);
  assert.doesNotMatch(text, new RegExp(SECRET_INSTRUCTIONS));
  assert.doesNotMatch(text, new RegExp(SECRET_HANDLE));
  const data = result.data;
  assert.equal(data.paymentInstructions, undefined);
  assert.equal(data.paymentMethods, undefined);
  assert.equal(data.gratuityNote, undefined);
  assert.equal(data.terms, undefined);
  assert.equal(data.settings, undefined);
}

test("public booking API exposes a sanitized website and no other invoice settings", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-book-website-"));
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
      body: { email: "website-owner@example.test", companyName: "Gold Standard Limo", accountKind: "fleet" },
    });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const accepted = await call(worker, "/api/invites/accept", {
      method: "POST",
      body: { token: invite.data.inviteToken, password: "sample-owner-pass", termsAccepted: true },
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    const session = sessionOf(accepted);
    const settings = await call(worker, "/api/settings", { session });
    assert.equal(settings.status, 200, JSON.stringify(settings.data));
    const slug = settings.data.settings.bookingSlug;
    assert.ok(slug);

    const page = await call(worker, `/book/${slug}/`);
    assert.equal(page.status, 200);
    assert.match(page.text, /id="coSite"/);
    assert.match(page.text, /id="coSite"[^>]*target="_blank"/);
    assert.match(page.text, /id="coSite"[^>]*rel="noopener noreferrer"/);

    const blank = await call(worker, "/api/public/book/" + slug);
    assert.equal(blank.status, 200, JSON.stringify(blank.data));
    assert.equal(blank.data.ok, true);
    assert.equal(blank.data.website, "");
    assertNoPrivateInvoiceLeak(blank);

    const cases = [
      { website: "goldstandardlimo.com", expect: "https://goldstandardlimo.com" },
      { website: "https://goldstandardlimo.com", expect: "https://goldstandardlimo.com" },
      { website: "http://goldstandardlimo.com", expect: "http://goldstandardlimo.com" },
      { website: "", expect: "" },
      { website: "javascript:alert(1)", expect: "" },
      { website: "data:text/html,hi", expect: "" },
      { website: "not a url", expect: "" },
    ];

    for (const { website, expect } of cases) {
      const saved = await call(worker, "/api/settings", {
        method: "PUT",
        session,
        body: {
          website,
          paymentInstructions: SECRET_INSTRUCTIONS,
          paymentMethods: {
            cash: { on: true },
            cashapp: { on: true, handle: SECRET_HANDLE },
            zelle: { on: false, handle: "404-555-0100" },
            venmo: { on: false, handle: "" },
            paypal: { on: false, handle: "" },
          },
        },
      });
      assert.equal(saved.status, 200, website + " " + JSON.stringify(saved.data));
      assert.equal(saved.data.settings.website, website);
      assert.equal(saved.data.settings.paymentInstructions, SECRET_INSTRUCTIONS);
      assert.equal(saved.data.settings.paymentMethods.cashapp.handle, SECRET_HANDLE);

      const pub = await call(worker, "/api/public/book/" + slug);
      assert.equal(pub.status, 200, website + " " + JSON.stringify(pub.data));
      assert.equal(pub.data.ok, true);
      assert.equal(pub.data.website, expect, website);
      assertNoPrivateInvoiceLeak(pub);
    }
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
