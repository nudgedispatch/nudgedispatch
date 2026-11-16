import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";

const ADMIN = "test-admin-token";

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

test("operator shell serves the invoice image module under the existing CSP", { timeout: 120000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-invoice-share-"));
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

    const html = await worker.fetch("http://127.0.0.1/");
    const page = await html.text();
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-security-policy") || "", /script-src 'self'/);
    assert.equal((html.headers.get("content-security-policy") || "").includes("unsafe-inline"), false);
    assert.match(page, /<script type="module" src="\/invoice-image\.js"><\/script>/);
    assert.match(page, /<script src="\/app\.js" defer><\/script>/);
    assert.match(page, /script-src 'self'/);
    assert.equal(page.includes("unsafe-inline"), false);
    assert.equal(page.includes("onclick="), false);

    const js = await worker.fetch("http://127.0.0.1/invoice-image.js");
    const body = await js.text();
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") || "", /javascript/);
    assert.match(js.headers.get("content-security-policy") || "", /script-src 'self'/);
    assert.match(body, /export async function invoiceFiles/);
    assert.match(body, /globalThis\.NudgeInvoiceShare/);
    assert.equal(body.includes("eval("), false);

    const app = await worker.fetch("http://127.0.0.1/app.js");
    const appJs = await app.text();
    assert.equal(app.status, 200);
    assert.match(appJs, /wireInvoiceShare/);
    assert.match(appJs, /Download PNG/);
    assert.match(appJs, /navigator\.share/);
    assert.match(appJs, /#dl-png/);

    const sw = await worker.fetch("http://127.0.0.1/sw.js");
    const swJs = await sw.text();
    assert.match(swJs, /nudge-app-shell-v20/);
    assert.match(swJs, /\/invoice-image\.js/);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
