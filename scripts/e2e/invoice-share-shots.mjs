#!/usr/bin/env node
// Local screenshots and headless checks for invoice PNG/PDF share. Never talks to production.
// Usage: node scripts/e2e/invoice-share-shots.mjs [logo.png]
// SCREENSHOT_DIR defaults to ../nudge-invoice-share-preview
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const shots = process.env.SCREENSHOT_DIR || join(root, "../nudge-invoice-share-preview");
mkdirSync(shots, { recursive: true });
const ADMIN = "shots-admin-token";
const logoPath = process.argv[2] || "";

function dataUrl(path) {
  return path ? "data:image/png;base64," + readFileSync(path).toString("base64") : "";
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

const persistTo = mkdtempSync(join(tmpdir(), "nudge-invoice-share-shots-"));
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

  const invite = await call(worker, "/api/admin/invites", { method: "POST", admin: true, body: { email: "tgs-share@example.test", companyName: "The Gold Standard Limo", accountKind: "individual" } });
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const acc = await call(worker, "/api/invites/accept", { method: "POST", body: { token: invite.data.inviteToken, password: "shots-owner-pass-1" } });
  const session = { cookie: acc.cookie, csrf: acc.data.csrf };
  const settings = await call(worker, "/api/settings", { session });
  const put = await call(worker, "/api/settings", {
    method: "PUT",
    session,
    body: {
      businessName: "The Gold Standard Limo",
      address: "Atlanta, GA",
      phone: "(404) 555-0100",
      email: "thegoldstandardlimo@gmail.com",
      website: "goldstandard.example",
      prefix: "TGS-",
      nextNumber: settings.data.settings.nextNumber,
      paymentInstructions: "Card accepted in the car.",
      terms: "Due on receipt.",
      gratuityNote: "Price does not include gratuity.",
      logoDataUrl: dataUrl(logoPath),
      paymentMethods: {
        cash: { on: true },
        cashapp: { on: true, handle: "$TGSLimo" },
        zelle: { on: true, handle: "404-555-0123" },
        venmo: { on: true, handle: "@TGS-Limo" },
        paypal: { on: false, handle: "" },
      },
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));

  const client = await call(worker, "/api/clients", { method: "POST", session, body: { name: "Avery Cole", phone: "404-555-0199", email: "avery@example.test" } });
  assert.equal(client.status, 201, JSON.stringify(client.data));
  const ride = await call(worker, "/api/rides", {
    method: "POST",
    session,
    body: { clientId: client.data.client.id, date: "2026-11-18", time: "09:30", pickup: "Hotel Indigo Atlanta", dropoff: "Hartsfield-Jackson Atlanta International Airport", passengers: 2, fare: "125", flight: "DL 1234", stops: ["Atlantic Station"] },
  });
  assert.equal(ride.status, 201, JSON.stringify(ride.data));
  const rideId = ride.data.ride.id;
  let from = "";
  for (const step of ["En route", "Arrived", "Picked up", "Completed"]) {
    const moved = await call(worker, "/api/rides/" + rideId + "/progress", { method: "POST", session, body: { step, from } });
    assert.equal(moved.status, 200, step + " " + JSON.stringify(moved.data));
    from = step;
  }
  const made = await call(worker, "/api/rides/" + rideId + "/invoice", { method: "POST", session, body: {} });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const invoice = made.data.invoice;
  const invoiceUrl = `${origin}/#/invoices/${invoice.id}`;

  const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
  browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox", "--disable-gpu"] });
  const [cookieName, cookieValue] = session.cookie.split("=");

  async function openInvoice(width, height, initScript) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width <= 400 ? 2 : 1, serviceWorkers: "block" });
    if (initScript) await context.addInitScript(initScript);
    await context.addCookies([{ name: cookieName, value: cookieValue, url: origin }]);
    const page = await context.newPage();
    await page.goto(invoiceUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("#sheet");
    await page.waitForFunction(() => typeof window.NudgeInvoiceShare === "object" && document.querySelector("#dl-png"));
    return { context, page };
  }

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    const { context, page } = await openInvoice(width, height);
    const file = join(shots, `invoice-page-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const labels = await page.locator(".actions.noprint .btn").allTextContents();
    assert.ok(labels.includes("Email") && labels.includes("Text"));
    assert.ok(labels.includes("Download PNG") && labels.includes("Download PDF"));
    console.log("wrote", file, "buttons=", labels.map((t) => t.trim()).filter(Boolean).join(", "));
    await context.close();
  }

  // Capture the rendered share PNG (and PDF) through the same client module the app uses.
  {
    const { context, page } = await openInvoice(390, 844);
    const result = await page.evaluate(async () => {
      const invoiceId = location.hash.replace("#/invoices/", "");
      const res = await fetch("/api/invoices/" + invoiceId, { headers: { "X-Nudge-Client": "1" } });
      const data = await res.json();
      const files = await window.NudgeInvoiceShare.invoiceFiles(data.invoice);
      const pngBuf = await files.png.arrayBuffer();
      const pdfBuf = files.pdf ? await files.pdf.arrayBuffer() : null;
      const bytesToB64 = (buf) => {
        const bytes = new Uint8Array(buf);
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
      };
      return {
        pngName: files.png.name,
        pdfName: files.pdf && files.pdf.name,
        pngType: files.png.type,
        pdfType: files.pdf && files.pdf.type,
        width: files.width,
        height: files.height,
        pngB64: bytesToB64(pngBuf),
        pdfB64: pdfBuf ? bytesToB64(pdfBuf) : "",
        title: window.NudgeInvoiceShare.invoiceShareTitle(data.invoice),
        text: window.NudgeInvoiceShare.invoiceShareText(data.invoice),
      };
    });
    assert.equal(result.pngName, "invoice-TGS-1001.png");
    assert.equal(result.pdfName, "invoice-TGS-1001.pdf");
    assert.equal(result.pngType, "image/png");
    assert.equal(result.pdfType, "application/pdf");
    const pngPath = join(shots, "invoice-image.png");
    const pdfPath = join(shots, "invoice-image.pdf");
    writeFileSync(pngPath, Buffer.from(result.pngB64, "base64"));
    writeFileSync(pdfPath, Buffer.from(result.pdfB64, "base64"));
    const pngHdr = readFileSync(pngPath).subarray(0, 8);
    assert.deepEqual(Uint8Array.from(pngHdr), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const pdfHdr = readFileSync(pdfPath).subarray(0, 5).toString();
    assert.equal(pdfHdr, "%PDF-");
    assert.match(result.text, /Pay with Cash App:/);
    console.log("wrote", pngPath, "and", pdfPath, "size=", result.width, "x", result.height);

    const view = await context.newPage();
    await view.goto("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>Invoice PNG</title><body style="margin:0;background:#111"><img id="inv" src="data:image/png;base64,${result.pngB64}" style="display:block;width:100%;height:auto">`));
    await view.setViewportSize({ width: 540, height: 960 });
    const box = await view.$eval("#inv", (img) => ({ w: img.naturalWidth, h: img.naturalHeight, ok: img.complete }));
    assert.equal(box.ok, true);
    assert.equal(box.w, result.width);
    await view.locator("#inv").screenshot({ path: join(shots, "invoice-image-photo.png") });
    console.log("wrote", join(shots, "invoice-image-photo.png"), "natural=", box.w, "x", box.h);
    await context.close();
  }

  // Render the PDF in Chrome so the preview folder has a visual of the attached file.
  {
    const pdfPath = join(shots, "invoice-image.pdf");
    const context = await browser.newContext({ viewport: { width: 700, height: 1000 } });
    const page = await context.newPage();
    await page.goto("file://" + pdfPath, { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "invoice-image-pdf.png"), fullPage: true });
    console.log("wrote", join(shots, "invoice-image-pdf.png"));
    await context.close();
  }

  // Share behaviour: stub navigator.share/canShare; Email attaches the PDF, Text attaches the PNG, and url is omitted.
  {
    const { context, page } = await openInvoice(390, 844, () => {
      window.__shared = [];
      navigator.share = (data) => {
        window.__shared.push({
          title: data.title,
          text: data.text,
          url: data.url,
          files: (data.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        });
        return Promise.resolve();
      };
      navigator.canShare = (data) => Boolean(data && data.files && data.files.length);
    });
    await page.waitForFunction(async () => {
      const btn = document.querySelector("#dl-png");
      return btn && !btn.disabled;
    });
    // Give prefetch a moment to finish (logo decode + canvas + pdf).
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shots, "invoice-share-supported-390.png"), fullPage: true });
    await page.click("#send-email");
    await page.click("#send-text");
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.length, 2, JSON.stringify(shared));
    assert.equal(shared[0].files.length, 1);
    assert.equal(shared[0].files[0].type, "application/pdf");
    assert.equal(shared[0].files[0].name, "invoice-TGS-1001.pdf");
    assert.equal(shared[0].url, undefined);
    assert.match(shared[0].text, /cash\.app/);
    assert.equal(shared[1].files[0].type, "image/png");
    assert.equal(shared[1].files[0].name, "invoice-TGS-1001.png");
    assert.equal(shared[1].url, undefined);
    const note = await page.textContent(".send-note");
    assert.match(note, /share sheet/);
    console.log("share with files ok", JSON.stringify(shared));
    await context.close();
  }

  // Fallback when Web Share is missing: mailto/sms stay, and Download PNG/PDF still work.
  {
    const { context, page } = await openInvoice(390, 844, () => {
      try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) { /* ignore */ }
    });
    await page.waitForTimeout(400);
    const emailHref = await page.getAttribute("#send-email", "href");
    const textHref = await page.getAttribute("#send-text", "href");
    assert.match(emailHref || "", /^mailto:avery@example\.test/);
    assert.match(textHref || "", /^sms:/);
    await page.screenshot({ path: join(shots, "invoice-share-fallback-390.png"), fullPage: true });
    const [pngDownload] = await Promise.all([page.waitForEvent("download"), page.click("#dl-png")]);
    const savedPng = join(shots, "downloaded-" + pngDownload.suggestedFilename());
    await pngDownload.saveAs(savedPng);
    const [pdfDownload] = await Promise.all([page.waitForEvent("download"), page.click("#dl-pdf")]);
    const savedPdf = join(shots, "downloaded-" + pdfDownload.suggestedFilename());
    await pdfDownload.saveAs(savedPdf);
    assert.equal(pngDownload.suggestedFilename(), "invoice-TGS-1001.png");
    assert.equal(pdfDownload.suggestedFilename(), "invoice-TGS-1001.pdf");
    assert.deepEqual(Uint8Array.from(readFileSync(savedPng).subarray(0, 8)), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.equal(readFileSync(savedPdf).subarray(0, 5).toString(), "%PDF-");
    console.log("download fallback ok", savedPng, savedPdf);
    await context.close();
  }

  writeFileSync(join(shots, "README.txt"), `Generated by scripts/e2e/invoice-share-shots.mjs on a local Worker (${origin}).\nSample data is TGS-like and stays local; this does not touch production.\n`);
  console.log("invoice share shots ok");
} finally {
  if (browser) await browser.close();
  if (worker) await worker.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
