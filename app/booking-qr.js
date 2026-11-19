import { themeVars, themeCss } from "./theme.js";
// Shareable QR page for a company's public booking link: /book/<slug>/qr/.
// QR is encoded in the Worker (vendored MIT encoder, error correction H) as SVG and PNG.
// Every value placed in HTML or SVG goes through escapeHtml.
import qrcodegen from "./vendor/qrcodegen.js";
import { escapeHtml } from "./booking-shell.js";
import { decodePng, encodePng, blitContain } from "./icon-compose.js";

const { QrCode } = qrcodegen;
export const QR_BORDER = 4;
const LOGO_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

export function bookingUrlFor(origin, slug) {
  return String(origin).replace(/\/+$/, "") + "/book/" + slug + "/";
}

export function qrShortName(name) {
  const text = String(name || "").trim();
  if (!text) return "Booking QR";
  if (text.length <= 9) return text + " QR";
  const initials = text.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "").charAt(0)).join("").toUpperCase().slice(0, 5);
  return (initials.length >= 2 ? initials : text.slice(0, 9).trim()) + " QR";
}

export function encodeQr(text) {
  const qr = QrCode.encodeText(String(text), QrCode.Ecc.HIGH);
  const size = qr.size;
  const dark = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(qr.getModule(x, y));
    dark.push(row);
  }
  return { size, version: qr.version, ecc: "H", dark };
}

// Centered logo area in module units: an odd square near 22% of the symbol,
// plus a one-module quiet margin. Covers well under the ~30% that level H can recover.
export function logoBox(size) {
  let n = Math.round(size * 0.22);
  if (n % 2 === 0) n += 1;
  const plate = n + 2;
  const start = (size - plate) / 2;
  return { start, plate, inner: n };
}

function usableLogo(dataUrl) {
  return typeof dataUrl === "string" && dataUrl.length <= 180000 && LOGO_RE.test(dataUrl.trim()) ? dataUrl.trim() : "";
}

export function qrSvg(text, { logoDataUrl = "", title = "" } = {}) {
  const { size, dark } = encodeQr(text);
  const logo = usableLogo(logoDataUrl);
  const box = logo ? logoBox(size) : null;
  const full = size + QR_BORDER * 2;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark[y][x]) continue;
      if (box && x >= box.start && x < box.start + box.plate && y >= box.start && y < box.start + box.plate) continue;
      path += "M" + (x + QR_BORDER) + "," + (y + QR_BORDER) + "h1v1h-1z";
    }
  }
  let overlay = "";
  if (box) {
    const p = box.start + QR_BORDER + 1;
    overlay = '<rect x="' + p + '" y="' + p + '" width="' + box.inner + '" height="' + box.inner + '" rx="1.2" fill="#0b0b0b"/>'
      + '<image x="' + (p + box.inner * 0.07) + '" y="' + (p + box.inner * 0.07) + '" width="' + box.inner * 0.86 + '" height="' + box.inner * 0.86
      + '" preserveAspectRatio="xMidYMid meet" href="' + escapeHtml(logo) + '"/>';
  }
  const label = title ? "<title>" + escapeHtml(title) + "</title>" : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + " " + full + '" shape-rendering="crispEdges" role="img">'
    + label + '<rect width="' + full + '" height="' + full + '" fill="#ffffff"/><path d="' + path + '" fill="#000000"/>' + overlay + "</svg>";
}

function fillRect(rgba, width, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
}

async function decodeLogo(dataUrl) {
  const logo = usableLogo(dataUrl);
  const match = /^data:image\/png;base64,(.+)$/i.exec(logo);
  if (!match) return null;
  const bin = atob(match[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    return await decodePng(bytes);
  } catch {
    return null;
  }
}

// PNG of the same symbol. The logo is composited only for PNG logos (the Worker has no JPEG/WebP decoder);
// other logos get a plain QR, which scans the same.
export async function qrPng(text, { logoDataUrl = "", target = 1024 } = {}) {
  const { size, dark } = encodeQr(text);
  const full = size + QR_BORDER * 2;
  const scale = Math.max(4, Math.floor(target / full));
  const px = full * scale;
  const rgba = new Uint8Array(px * px * 4).fill(255);
  const logo = await decodeLogo(logoDataUrl);
  const box = logo ? logoBox(size) : null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark[y][x]) continue;
      if (box && x >= box.start && x < box.start + box.plate && y >= box.start && y < box.start + box.plate) continue;
      fillRect(rgba, px, (x + QR_BORDER) * scale, (y + QR_BORDER) * scale, scale, scale, [0, 0, 0]);
    }
  }
  if (box && logo) {
    const side = box.inner * scale;
    const plate = new Uint8Array(side * side * 4);
    for (let i = 0; i < plate.length; i += 4) {
      plate[i] = 11;
      plate[i + 1] = 11;
      plate[i + 2] = 11;
      plate[i + 3] = 255;
    }
    const r = Math.round(scale * 1.2);
    blitContain(logo.rgba, logo.width, logo.height, plate, side, Math.floor(side * 0.86));
    const ox = (box.start + QR_BORDER + 1) * scale;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const cx = x < r ? r - x : x >= side - r ? x - (side - r - 1) : 0;
        const cy = y < r ? r - y : y >= side - r ? y - (side - r - 1) : 0;
        if (cx && cy && cx * cx + cy * cy > r * r) continue;
        const s = (y * side + x) * 4;
        const d = ((ox + y) * px + ox + x) * 4;
        rgba[d] = plate[s];
        rgba[d + 1] = plate[s + 1];
        rgba[d + 2] = plate[s + 2];
        rgba[d + 3] = 255;
      }
    }
  }
  return encodePng(rgba, px, px);
}

export function qrManifest(slug, companyName, themeColor, brandChrome = null) {
  const base = "/book/" + slug + "/";
  const qr = base + "qr/";
  const name = String(companyName || "").trim() || "Booking";
  const theme = themeVars(themeColor || "");
  return {
    id: qr,
    name: name + " QR",
    short_name: qrShortName(name),
    description: "QR code for " + name.replace(/\.+$/, "") + "'s booking page.",
    start_url: qr,
    scope: qr,
    display: "standalone",
    background_color: brandChrome ? brandChrome.background : theme.background,
    theme_color: brandChrome ? brandChrome.header : theme.background,
    icons: [
      { src: base + "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: base + "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: base + "icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: base + "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function qrPageHtml({ slug, companyName, bookingUrl, logoDataUrl = "", themeColor = "", assetTag = "", brandChrome = null }) {
  const name = String(companyName || "").trim() || "Booking page";
  const e = escapeHtml;
  const base = "/book/" + slug + "/";
  const v = assetTag ? "?v=" + e(assetTag) : "";
  const file = slug + "-booking-qr.png";
  const headLogo = usableLogo(logoDataUrl) || base + "icon-192.png";
  const theme = themeVars(themeColor || "");
  const themeStyle = theme.custom ? "<style>" + themeCss(themeColor, "body.qrpage") + "</style>" : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${e(brandChrome ? brandChrome.background : theme.background)}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${e(qrShortName(name))}">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="Scan to book a ride with ${e(name)}.">
<title>${e(name)} QR</title>
<link rel="manifest" href="${e(base)}qr/manifest.webmanifest">
<link rel="icon" href="${e(base)}icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="${e(base)}apple-touch-icon.png">
<link rel="stylesheet" href="/book-qr.css${v}">
${brandChrome ? `<link rel="stylesheet" href="${e(base)}qr/theme.css">` : themeStyle}
</head>
<body class="qrpage${theme.custom || brandChrome ? " themed" : ""}" data-url="${e(bookingUrl)}" data-name="${e(name)}" data-file="${e(file)}" data-png="${e(base)}qr.png" data-sw="${e(base)}qr/sw.js">
<main>
  <header class="qr-head">
    <img class="qr-logo" src="${e(headLogo)}" alt="" width="56" height="56">
    <h1>${e(name)}</h1>
  </header>
  <p class="qr-lead">Scan to book a ride</p>
  <div class="qr-frame">
    <img id="qrImg" class="qr-img" src="${e(base)}qr.png" width="1024" height="1024" alt="QR code for ${e(bookingUrl)}">
  </div>
  <p class="qr-url"><a href="${e(bookingUrl)}">${e(bookingUrl)}</a></p>
  <div class="qr-actions">
    <button type="button" id="qrShare" class="qr-btn primary">Share</button>
    <a id="qrSave" class="qr-btn" href="${e(base)}qr.png" download="${e(file)}">Save image</a>
  </div>
  <p class="qr-more"><a href="${e(base)}qr.svg" download="${e(slug)}-booking-qr.svg">SVG for print</a> · <a href="${e(base)}">Open booking page</a></p>
  <p id="qrNote" class="qr-note" role="status" aria-live="polite"></p>
  <p class="qr-hint">Add this page to your home screen to open the QR in one tap.</p>
</main>
<script src="/book-qr.js${v}"></script>
</body>
</html>
`;
}

export function qrUnavailableHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not available</title>
<link rel="stylesheet" href="/book-qr.css">
</head>
<body class="qrpage">
<main><p class="qr-lead" role="alert">This booking page is not available.</p></main>
</body>
</html>
`;
}
