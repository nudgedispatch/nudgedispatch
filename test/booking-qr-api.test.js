import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { encodePng } from "../app/icon-compose.js";

const ADMIN = "test-admin-token";
const ROOT = new URL("..", import.meta.url).pathname;
const canDecode = spawnSync("python3", ["-c", "import pyzbar.pyzbar, PIL"]).status === 0;

function sessionCookie(response, previous = "") {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const next = lines.map((line) => line.split(";")[0]).find((part) => part.startsWith("nudge_session="));
  return next || previous;
}

async function call(worker, path, { method = "GET", body, session, admin = false, raw = false } = {}) {
  const headers = { "x-nudge-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrf && method !== "GET") headers["x-csrf-token"] = session.csrf;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const response = await worker.fetch("http://127.0.0.1" + path, {
    method,
    headers,
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text };
  }
  return { status: response.status, data, cookie: sessionCookie(response, session?.cookie || ""), text, headers: response.headers };
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], { cwd: ROOT, env: { ...process.env, CI: "1" }, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("wrangler exited " + code))));
  });
}

function decode(path) {
  const out = spawnSync("python3", ["-c", "import sys\nfrom PIL import Image\nfrom pyzbar.pyzbar import decode\nprint('\\n'.join(r.data.decode() for r in decode(Image.open(sys.argv[1]).convert('L'))))", path], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

async function owner(worker, email, companyName) {
  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email, companyName, accountKind: "fleet" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const accepted = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "sample-owner-pass" } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const session = { cookie: accepted.cookie, csrf: accepted.data.csrf || "" };
  const settings = await call(worker, "/api/settings", { session });
  return { session, settings: settings.data.settings, slug: settings.data.settings.bookingSlug };
}

test("booking QR page, manifest, PNG and SVG; unknown and suspended slugs 404", { timeout: 240000 }, async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "nudge-book-qr-"));
  let worker;
  const start = () => unstable_dev("app/index.js", {
    config: "wrangler.toml", local: true, persist: true, persistTo, logLevel: "error",
    vars: { ADMIN_TOKEN: ADMIN, SMS_MODE: "off" },
    experimental: { disableExperimentalWarning: true, watch: false, forceLocal: true },
  });
  try {
    await run(["d1", "migrations", "apply", "nudge-app-local", "--local", "--persist-to", persistTo]);
    worker = await start();
    const a = await owner(worker, "qr-owner@example.test", `Acme <Rides> & "Co'`);
    const slug = a.slug;
    assert.ok(slug);

    // Give the company a PNG logo so the PNG gets the overlay.
    const w = 64;
    const rgba = new Uint8Array(w * w * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 212; rgba[i + 1] = 175; rgba[i + 2] = 55; rgba[i + 3] = 255; }
    const logo = "data:image/png;base64," + Buffer.from(await encodePng(rgba, w, w)).toString("base64");
    const s = a.settings;
    const put = await call(worker, "/api/settings", { method: "PUT", session: a.session, body: {
      businessName: s.businessName, address: s.address, phone: s.phone, email: s.email, website: s.website,
      prefix: s.prefix, nextNumber: s.nextNumber, paymentInstructions: s.paymentInstructions, terms: s.terms,
      gratuityNote: s.gratuityNote, logoDataUrl: logo,
    } });
    assert.equal(put.status, 200, JSON.stringify(put.data));

    const redirect = await call(worker, `/book/${slug}/qr?x=1`);
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), `/book/${slug}/qr/?x=1`);

    const page = await call(worker, `/book/${slug}/qr/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") || "", /text\/html/);
    assert.match(page.headers.get("cache-control") || "", /no-store/);
    assert.match(page.headers.get("content-security-policy") || "", /script-src 'self'/);
    assert.match(page.text, /<title>Acme &lt;Rides&gt; &amp; &quot;Co&#39; QR<\/title>/);
    assert.doesNotMatch(page.text, /Acme <Rides>/);
    assert.ok(page.text.includes(`data-url="http://127.0.0.1/book/${slug}/"`));
    assert.ok(page.text.includes(`<link rel="manifest" href="/book/${slug}/qr/manifest.webmanifest">`));
    assert.ok(page.text.includes(`<link rel="apple-touch-icon" href="/book/${slug}/apple-touch-icon.png">`));
    assert.ok(page.text.includes(`src="data:image/png;base64,`), "header shows the company logo");
    assert.match(page.text, /<script src="\/book-qr\.js\?v=[a-z0-9]+"><\/script>/);
    assert.doesNotMatch(page.text, /<script>/);

    const manifest = await call(worker, `/book/${slug}/qr/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.data.start_url, `/book/${slug}/qr/`);
    assert.equal(manifest.data.scope, `/book/${slug}/qr/`);
    assert.equal(manifest.data.id, `/book/${slug}/qr/`);
    assert.equal(manifest.data.name, `Acme <Rides> & "Co' QR`);
    assert.equal(manifest.data.display, "standalone");
    const bookingManifest = await call(worker, `/book/${slug}/manifest.webmanifest`);
    assert.equal(bookingManifest.data.start_url, `/book/${slug}/`, "booking manifest unchanged");
    assert.notEqual(bookingManifest.data.id, manifest.data.id);
    const icon = await call(worker, manifest.data.icons[0].src, { raw: true });
    assert.equal(icon.status, 200);

    const sw = await call(worker, `/book/${slug}/qr/sw.js`);
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get("content-type") || "", /javascript/);
    assert.match(sw.text, /nudge-book-qr-v1/);

    const js = await call(worker, "/book-qr.js");
    assert.equal(js.status, 200);
    assert.match(js.text, /navigator\.canShare/);
    const css = await call(worker, "/book-qr.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") || "", /text\/css/);

    const png = await call(worker, `/book/${slug}/qr.png`, { raw: true });
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.deepEqual([...png.bytes.subarray(0, 4)], [137, 80, 78, 71]);
    const svg = await call(worker, `/book/${slug}/qr.svg`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-type") || "", /image\/svg\+xml/);
    assert.match(svg.text, /<title>Acme &lt;Rides&gt; &amp; &quot;Co&#39; booking link: http:\/\/127\.0\.0\.1\/book\//);
    assert.match(svg.text, /<image /);
    if (canDecode) {
      const file = join(persistTo, "qr.png");
      await writeFile(file, png.bytes);
      assert.equal(decode(file), `http://127.0.0.1/book/${slug}/`);
    }

    for (const path of ["/book/no-such-company/qr/", "/book/no-such-company/qr.png", "/book/no-such-company/qr.svg", "/book/no-such-company/qr/manifest.webmanifest"]) {
      const missing = await call(worker, path);
      assert.equal(missing.status, 404, path);
      assert.match(missing.headers.get("cache-control") || "", /no-store/);
    }
    const missingPage = await call(worker, "/book/no-such-company/qr/");
    assert.match(missingPage.text, /This booking page is not available\./);
    assert.doesNotMatch((await call(worker, "/book/BAD_slug/qr/")).text, /qr-frame/);
    assert.equal((await call(worker, `/book/${slug}/qr/other`)).status, 404);

    // Suspend the company directly in the local DB; the QR page must go away like the booking manifest does.
    await worker.stop();
    worker = null;
    await run(["d1", "execute", "nudge-app-local", "--local", "--persist-to", persistTo, "--command", `UPDATE companies SET status = 'suspended' WHERE booking_slug = '${slug}'`]);
    worker = await start();
    for (const path of [`/book/${slug}/qr/`, `/book/${slug}/qr.png`, `/book/${slug}/manifest.webmanifest`]) {
      assert.equal((await call(worker, path)).status, 404, path);
    }
    const suspendedPage = await call(worker, `/book/${slug}/qr/`);
    assert.match(suspendedPage.text, /This booking page is not available\./);
    assert.doesNotMatch(suspendedPage.text, /Acme/);
  } finally {
    if (worker) await worker.stop();
    await rm(persistTo, { recursive: true, force: true });
  }
});
