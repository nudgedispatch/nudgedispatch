import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import qrcodegen from "../app/vendor/qrcodegen.js";
import { encodePng } from "../app/icon-compose.js";
import { bookingUrlFor, encodeQr, logoBox, qrManifest, qrPageHtml, qrPng, qrShortName, qrSvg, QR_BORDER } from "../app/booking-qr.js";

const { QrCode, QrSegment } = qrcodegen;
const vectors = JSON.parse(readFileSync(new URL("./fixtures/qr-vectors.json", import.meta.url), "utf8"));

// Decoding uses python3 + pyzbar when available (installed on the dev box); the vector tests always run.
const PY = spawnSync("python3", ["-c", "import pyzbar.pyzbar, PIL"], { encoding: "utf8" });
const canDecode = PY.status === 0;

function decodeImageFile(path) {
  const out = spawnSync("python3", ["-c", [
    "import sys",
    "from PIL import Image",
    "from pyzbar.pyzbar import decode, ZBarSymbol",
    "img = Image.open(sys.argv[1]).convert('L')",
    "res = decode(img, symbols=[ZBarSymbol.QRCODE])",
    "print('\\n'.join(r.data.decode('utf-8') for r in res))",
  ].join("\n"), path], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

function samplePngLogo() {
  // 120x80 transparent PNG with a gold bar and a white block: exercises alpha and aspect fit.
  const w = 120;
  const h = 80;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y > 20 && y < 60) { rgba[i] = 212; rgba[i + 1] = 175; rgba[i + 2] = 55; rgba[i + 3] = 255; }
      if (x > 40 && x < 80 && y > 30 && y < 50) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 255; }
    }
  }
  return encodePng(rgba, w, h).then((bytes) => "data:image/png;base64," + Buffer.from(bytes).toString("base64"));
}

// Rasterize our own SVG output (path squares + logo plate) to a PGM so a real decoder reads it.
function svgToPgm(svg, scale = 8) {
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const full = Number(view[1]);
  const px = full * scale;
  const pix = new Uint8Array(px * px).fill(255);
  const paint = (x0, y0, w, h, v) => {
    for (let y = Math.round(y0 * scale); y < Math.round((y0 + h) * scale); y++) {
      for (let x = Math.round(x0 * scale); x < Math.round((x0 + w) * scale); x++) pix[y * px + x] = v;
    }
  };
  const d = /<path d="([^"]*)"/.exec(svg)[1];
  for (const m of d.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) paint(Number(m[1]), Number(m[2]), 1, 1, 0);
  const plate = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx/.exec(svg);
  if (plate) paint(Number(plate[1]), Number(plate[2]), Number(plate[3]), Number(plate[4]), 11);
  return Buffer.concat([Buffer.from(`P5\n${px} ${px}\n255\n`), Buffer.from(pix)]);
}

test("vendored encoder matches python-qrcode 8.2 reference matrices (level H, fixed mask)", () => {
  assert.ok(vectors.length >= 3);
  for (const v of vectors) {
    const qr = QrCode.encodeSegments([QrSegment.makeBytes([...Buffer.from(v.text)])], QrCode.Ecc.HIGH, v.version, v.version, v.mask, false);
    assert.equal(qr.size, v.rows.length, v.text);
    for (let y = 0; y < qr.size; y++) {
      let row = "";
      for (let x = 0; x < qr.size; x++) row += qr.getModule(x, y) ? "1" : "0";
      assert.equal(row, v.rows[y], `${v.text} mask ${v.mask} row ${y}`);
    }
  }
});

test("encodeQr uses level H and the logo box stays small and centered", () => {
  const url = "https://app.nudgedispatch.com/book/tgs/";
  const qr = encodeQr(url);
  assert.equal(qr.ecc, "H");
  assert.equal(qr.size, 37);
  const box = logoBox(qr.size);
  assert.equal(box.start * 2 + box.plate, qr.size);
  assert.ok((box.plate * box.plate) / (qr.size * qr.size) < 0.1);
  assert.equal(bookingUrlFor("https://app.nudgedispatch.com/", "tgs"), url);
});

test("qrSvg escapes the title and logo and draws a plate only with a valid logo", () => {
  const plain = qrSvg("https://x.test/book/a/", { title: `<script>"&'` });
  assert.match(plain, /<title>&lt;script&gt;&quot;&amp;&#39;<\/title>/);
  assert.doesNotMatch(plain, /<script/);
  assert.doesNotMatch(plain, /<image/);
  const bogus = qrSvg("https://x.test/book/a/", { logoDataUrl: `javascript:alert(1)"/><script>` });
  assert.doesNotMatch(bogus, /<image|<script|javascript:/);
  const logo = qrSvg("https://x.test/book/a/", { logoDataUrl: "data:image/webp;base64,AAAA" });
  assert.match(logo, /<image [^>]*href="data:image\/webp;base64,AAAA"/);
  assert.ok(plain.includes(`viewBox="0 0 ${encodeQr("https://x.test/book/a/").size + QR_BORDER * 2}`));
});

const urls = [
  "https://app.nudgedispatch.com/book/tgs/",
  "http://127.0.0.1:8787/book/bailey-consulting/",
  "https://app.nudgedispatch.com/book/" + "a".repeat(40) + "-rides-20/",
];

test("generated PNG and SVG decode to the exact booking URL, with and without a logo", { skip: canDecode ? false : "python3 pyzbar not available" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nudge-qr-"));
  try {
    const logo = await samplePngLogo();
    for (const url of urls) {
      for (const logoDataUrl of ["", logo]) {
        const png = join(dir, "q.png");
        writeFileSync(png, await qrPng(url, { logoDataUrl }));
        assert.equal(decodeImageFile(png), url, `png ${url} logo=${Boolean(logoDataUrl)}`);
        const pgm = join(dir, "q.pgm");
        writeFileSync(pgm, svgToPgm(qrSvg(url, { logoDataUrl })));
        assert.equal(decodeImageFile(pgm), url, `svg ${url} logo=${Boolean(logoDataUrl)}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("QR manifest has its own id and scope under the booking page", () => {
  const m = qrManifest("tgs", "The Gold Standard Limo");
  assert.equal(m.id, "/book/tgs/qr/");
  assert.equal(m.start_url, "/book/tgs/qr/");
  assert.equal(m.scope, "/book/tgs/qr/");
  assert.equal(m.name, "The Gold Standard Limo QR");
  assert.equal(m.short_name, "TGSL QR");
  assert.equal(m.display, "standalone");
  assert.ok(m.icons.every((i) => i.src.startsWith("/book/tgs/icon-")));
  assert.equal(qrShortName("Acme"), "Acme QR");
  assert.equal(qrShortName(""), "Booking QR");
});

test("qrPageHtml escapes everything it prints", () => {
  const html = qrPageHtml({ slug: "acme", companyName: `Acme <b>"x"</b> & 'Co'`, bookingUrl: `https://h.test/book/acme/?"><script>` });
  assert.doesNotMatch(html, /<b>|<script>/);
  assert.match(html, /<title>Acme &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; &#39;Co&#39; QR<\/title>/);
  assert.match(html, /<link rel="manifest" href="\/book\/acme\/qr\/manifest.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/book\/acme\/apple-touch-icon.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<script src="\/book-qr.js"><\/script>/);
  assert.doesNotMatch(html, /<script>/);
});
