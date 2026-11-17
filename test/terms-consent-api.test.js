import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { SIGNUP_TERMS_VERSION, TERMS_CONSENT_ERROR } from "../app/signup.js";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;

async function call(worker, path, { method = "GET", body, admin = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }
  return { status: response.status, data };
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: ROOT, env: { ...process.env, CI: "1" } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error("exit " + code))));
  });
}

async function sql(persistTo, text) {
  const file = join(persistTo, "q-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".sql");
  await writeFile(file, text);
  const out = await run(["wrangler", "d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--file", file, "--json"]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

test("terms version is the Nov 17, 2026 terms", () => {
  assert.equal(SIGNUP_TERMS_VERSION, "nudgedispatch.com/terms.html#2026-11-17");
  assert.equal(TERMS_CONSENT_ERROR, "Please agree to the Terms of Service and Privacy Policy.");
});

test("setup-link account creation requires Terms + Privacy consent and records it; password resets don't", { timeout: 180000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-terms-"));
  let worker;
  try {
    await run(["wrangler", "d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await unstable_dev("app/index.js", {
      config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
      vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
      experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
    });
    const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "consent@example.test", companyName: "Consent Cars", accountKind: "fleet" } });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const token = invite.data.inviteToken;

    for (const termsAccepted of [undefined, false, "true", 1]) {
      const refused = await call(worker, "/api/invites/accept", { method: "POST", body: { token, password: "consent-owner-pass", termsAccepted } });
      assert.equal(refused.status, 400, JSON.stringify(refused.data));
      assert.equal(refused.data.error, TERMS_CONSENT_ERROR);
    }
    const none = await sql(persistTo, "SELECT COUNT(*) AS n FROM users WHERE email = 'consent@example.test'");
    assert.equal(none[0].n, 0);

    // The link was released, so ticking the box now works.
    const before = Date.now();
    const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token, password: "consent-owner-pass", termsAccepted: true } });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    const user = (await sql(persistTo, "SELECT u.terms_accepted_at AS at, u.terms_version AS v, c.terms_accepted_at AS cat, c.terms_version AS cv FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = 'consent@example.test'"))[0];
    assert.ok(user.at >= before);
    assert.equal(user.v, SIGNUP_TERMS_VERSION);
    assert.ok(user.cat >= before);
    assert.equal(user.cv, SIGNUP_TERMS_VERSION);

    const reset = await call(worker, "/api/admin/resets", { method: "POST", admin: true, body: { email: "consent@example.test" } });
    assert.equal(reset.status, 201, JSON.stringify(reset.data));
    const peek = await call(worker, "/api/invites/peek", { method: "POST", body: { token: reset.data.inviteToken } });
    assert.equal(peek.data.kind, "reset");
    const changed = await call(worker, "/api/invites/accept", { method: "POST", body: { token: reset.data.inviteToken, password: "consent-owner-pass-2" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});

test("setup page and signup page both show an unchecked Terms + Privacy checkbox with both links", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["../app/client-app.txt", "../app/client-signup.txt"]) {
    const src = await readFile(new URL(file, import.meta.url), "utf8");
    const m = /<label[^>]*><input id="termsAccepted" type="checkbox"[^>]*>\s*<span>I agree to the <a href="([^"]+)"[^>]*>Terms of Service<\/a> and <a href="([^"]+)"[^>]*>Privacy Policy<\/a>\.<\/span><\/label>/.exec(src);
    assert.ok(m, file + " has the consent checkbox");
    assert.doesNotMatch(m[0], /checked/);
  }
  const app = await readFile(new URL("../app/client-app.txt", import.meta.url), "utf8");
  assert.match(app, /href="https:\/\/nudgedispatch\.com\/terms\.html"/);
  assert.match(app, /href="https:\/\/nudgedispatch\.com\/privacy\.html"/);
  assert.match(app, /termsAccepted: needsTerms \? termsBox\.checked : false/);
});
