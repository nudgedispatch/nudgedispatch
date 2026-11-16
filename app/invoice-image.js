// Client-side invoice image and PDF. The Worker never sends mail or texts.
// Loaded as a module at /invoice-image.js and used by the operator app for Email/Text share.
// Also imported by unit tests.

export const INVOICE_IMAGE_WIDTH = 1080;
export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const INK = "#161616";
const MUTED = "#5c5850";
const RULE = "#ece8e1";
const ACCENT = "#0b6e63";
const BG = "#ffffff";
const MAX_FIELD = 2000;

export function cleanText(value, max = MAX_FIELD) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

export function formatIssued(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return cleanText(iso);
  const dt = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+match[2] - 1];
  return `${dow}, ${mon} ${+match[3]}, ${match[1]}`;
}

export function formatTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return cleanText(value);
  let hour = +match[1];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${match[2]} ${suffix}`;
}

export function invoiceFileName(invoice, ext) {
  const raw = cleanText(invoice && invoice.number, 80) || "invoice";
  const safe = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
  const suffix = ext === "pdf" ? "pdf" : "png";
  return `invoice-${safe}.${suffix}`;
}

function businessNameOf(invoice) {
  const business = (invoice && invoice.business) || {};
  return cleanText(business.name).replace(/\.+$/, "") || "Invoice";
}

export function invoiceShareTitle(invoice) {
  return `Invoice ${cleanText(invoice && invoice.number, 80) || ""} from ${businessNameOf(invoice)}`.replace(/  +/g, " ").trim();
}

export function invoiceShareText(invoice) {
  const name = businessNameOf(invoice);
  const number = cleanText(invoice && invoice.number, 80);
  const fare = cleanText(invoice && invoice.fare, 40);
  const lines = [`${name}: invoice ${number} for ${fare}.`.replace(/  +/g, " ").trim()];
  const payWith = Array.isArray(invoice && invoice.payWith) ? invoice.payWith : [];
  const linked = payWith.find((o) => o && o.url);
  if (linked) {
    lines.push(`Pay with ${cleanText(linked.label, 40)}: ${cleanText(linked.url, 500)}`);
  } else {
    const payLines = Array.isArray(invoice && invoice.payLines) ? invoice.payLines : [];
    if (payLines.length) {
      lines.push("Pay with:");
      for (const line of payLines.slice(0, 6)) lines.push(cleanText(line, 300));
    } else {
      const note = cleanText(invoice && invoice.business && invoice.business.paymentInstructions, 300);
      if (note) lines.push("How to pay: " + note);
    }
  }
  lines.push("Thank you!");
  return lines.join("\n");
}

// mailto:/sms: fallbacks. Nothing is sent by the server.
export function invoiceSendLinks(invoice) {
  const business = (invoice && invoice.business) || {};
  const name = businessNameOf(invoice);
  const payLines = Array.isArray(invoice && invoice.payLines) ? invoice.payLines : [];
  const email = cleanText(invoice && invoice.billTo && invoice.billTo.email, 200);
  const phone = cleanText(invoice && invoice.billTo && invoice.billTo.phone, 40).replace(/[^\d+]/g, "");
  let body = String((invoice && invoice.snapshotText) || "")
    .split("\n")
    .filter((line) => !/^Nothing was sent automatically/.test(line))
    .join("\n")
    .trim();
  if (payLines.length && !/(^|\n)Pay with\n/.test(body)) body += "\n\nPay with\n" + payLines.join("\n");
  const mailto = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? "mailto:" + encodeURIComponent(email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent(`Invoice ${invoice.number} from ${name}`) + "&body=" + encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))
    : "";
  const text = [`${name}: invoice ${cleanText(invoice && invoice.number, 80)} for ${cleanText(invoice && invoice.fare, 40)}.`];
  if (payLines.length) text.push("Pay with:", ...payLines.map((line) => cleanText(line, 400)));
  else if (business.paymentInstructions) text.push("How to pay: " + cleanText(business.paymentInstructions, 400));
  text.push("Thank you!");
  const sms = phone.replace(/\D/g, "").length >= 7 ? "sms:" + phone + "?&body=" + encodeURIComponent(text.join("\n")) : "";
  return { mailto, sms };
}

export function canShareFile(file) {
  if (!file || typeof navigator === "undefined" || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// Email prefers a PDF (Mail attaches it cleanly); Text prefers a PNG (Messages previews images).
export function preferredShareFile(kind, files) {
  if (!files) return null;
  if (kind === "email") return files.pdf || files.png || null;
  return files.png || files.pdf || null;
}

export function defaultMeasureText(text, fontSize) {
  const s = String(text || "");
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.58;
  return w;
}

export function wrapLines(text, maxWidth, measure, fontSize) {
  const raw = String(text == null ? "" : text).replace(/\r\n/g, "\n");
  const paragraphs = raw.split("\n");
  const out = [];
  const widthOf = (s) => measure(s, fontSize);
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((w) => w.length);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const trial = line ? line + " " + word : word;
      if (widthOf(trial) <= maxWidth) {
        line = trial;
        continue;
      }
      if (line) out.push(line);
      if (widthOf(word) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        if (chunk && widthOf(chunk + ch) > maxWidth) {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

function font(weight, size) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function tripRows(invoice) {
  const trip = (invoice && invoice.trip) || {};
  const when = [formatIssued(trip.date), formatTime(trip.time)].filter(Boolean).join(" ");
  const rows = [];
  if (when) rows.push(["When", when]);
  if (trip.pickup) rows.push(["Pickup", cleanText(trip.pickup)]);
  const stops = Array.isArray(trip.stops) ? trip.stops : [];
  stops.forEach((stop, i) => {
    const text = typeof stop === "string" ? stop : stop && (stop.address || stop.name || stop.label);
    if (text) rows.push([`Stop ${i + 1}`, cleanText(text)]);
  });
  if (trip.dropoff) rows.push(["Drop-off", cleanText(trip.dropoff)]);
  if (trip.passengers != null && trip.passengers !== "") rows.push(["Passengers", cleanText(trip.passengers, 20)]);
  if (trip.flight) rows.push(["Flight", cleanText(trip.flight, 80)]);
  const fare = cleanText(invoice && invoice.fare, 40);
  if (fare) rows.push(["Car service", fare]);
  return rows;
}

function payRows(invoice) {
  const payWith = Array.isArray(invoice && invoice.payWith) ? invoice.payWith : [];
  return payWith.map((o) => {
    const label = cleanText(o && (o.label || o.kind), 40);
    const display = cleanText(o && o.display, 200);
    const url = cleanText(o && o.url, 500);
    const title = display ? `${label} · ${display}` : label;
    return { title, url };
  });
}

// Lay out the invoice as draw commands. measure(text, fontSize) returns px width.
export function buildInvoiceLayout(invoice, opts = {}) {
  const measure = opts.measure || defaultMeasureText;
  const width = opts.width || INVOICE_IMAGE_WIDTH;
  const pad = opts.pad || 64;
  const logoBox = opts.logoBox || (opts.logoSize ? Math.max(opts.logoSize.width, opts.logoSize.height, 1) : 0);
  const hasLogo = logoBox > 0;
  const logoSize = hasLogo ? Math.min(140, logoBox || 140) : 0;
  const contentRight = width - pad;
  const commands = [];
  const texts = [];
  let y = pad;

  const addText = (text, x, yy, size, weight, color, align) => {
    const value = String(text);
    commands.push({ type: "text", text: value, x, y: yy, font: font(weight, size), size, color, align: align || "left" });
    texts.push(value);
  };
  const addLines = (text, x, yy, size, weight, color, maxWidth) => {
    const lines = wrapLines(text, maxWidth, measure, size);
    const lineH = Math.round(size * 1.35);
    for (const line of lines) {
      addText(line, x, yy, size, weight, color);
      yy += lineH;
    }
    return yy;
  };

  commands.push({ type: "rect", x: 0, y: 0, w: width, h: 0, color: BG, fillAll: true });

  const business = (invoice && invoice.business) || {};
  const name = cleanText(business.name) || "Invoice";
  const contact = [business.address, business.phone, business.email, business.website].map((v) => cleanText(v, 200)).filter(Boolean).join("  ·  ");
  const textLeft = hasLogo ? pad + logoSize + 28 : pad;
  const textWidth = contentRight - textLeft;
  const headerTop = y;
  addText("INVOICE", textLeft, y, 18, 700, ACCENT);
  y += 28;
  y = addLines(name, textLeft, y, 32, 700, INK, textWidth);
  y += 4;
  if (contact) y = addLines(contact, textLeft, y, 20, 400, MUTED, textWidth);
  if (hasLogo) {
    commands.push({ type: "image", x: pad, y: headerTop, w: logoSize, h: logoSize });
    y = Math.max(y, headerTop + logoSize);
  }
  y += 36;

  const number = cleanText(invoice && invoice.number, 80);
  if (number) {
    addText(number, pad, y, 24, 700, INK);
    y += 32;
  }
  addText("Issued " + (formatIssued(invoice && invoice.issuedOn) || cleanText(invoice && invoice.issuedOn, 40)), pad, y, 20, 400, MUTED);
  y += 28;
  addText("Due on receipt", pad, y, 20, 400, MUTED);
  y += 40;

  const fare = cleanText(invoice && invoice.fare, 40);
  if (fare) {
    addText(fare, pad, y, 52, 800, INK);
    y += 72;
  }

  const bill = (invoice && invoice.billTo) || {};
  addText("Bill to", pad, y, 16, 700, MUTED);
  y += 26;
  if (bill.name) y = addLines(cleanText(bill.name, 200), pad, y, 22, 700, INK, contentRight - pad);
  const billContact = [cleanText(bill.phone, 80), cleanText(bill.email, 200)].filter(Boolean).join("  ");
  if (billContact) y = addLines(billContact, pad, y, 20, 400, INK, contentRight - pad);
  y += 24;

  const labelW = 180;
  const valueX = pad + labelW;
  const valueW = contentRight - valueX;
  const rows = tripRows(invoice);
  for (const [label, value] of rows) {
    const start = y;
    commands.push({ type: "line", x1: pad, y1: y, x2: contentRight, y2: y, color: RULE });
    y += 14;
    addText(label, pad, y, 18, 600, MUTED);
    const after = addLines(value, valueX, y, 18, 400, INK, valueW);
    y = Math.max(after, y + 24) + 10;
    if (y - start < 44) y = start + 44;
  }
  commands.push({ type: "line", x1: pad, y1: y, x2: contentRight, y2: y, color: RULE });
  y += 20;

  if (fare) {
    addText("Amount due", pad, y, 20, 600, MUTED);
    addText(fare, contentRight, y, 24, 800, INK, "right");
    y += 44;
  }

  const pays = payRows(invoice);
  const payNote = cleanText(business.paymentInstructions, 800);
  if (pays.length) {
    addText("Pay with", pad, y, 16, 700, MUTED);
    y += 28;
    for (const pay of pays) {
      y = addLines(pay.title, pad, y, 20, 700, INK, contentRight - pad);
      if (pay.url) y = addLines(pay.url, pad, y, 18, 400, ACCENT, contentRight - pad);
      y += 12;
    }
    if (payNote) {
      addText("Payment note", pad, y, 16, 700, MUTED);
      y += 26;
      y = addLines(payNote, pad, y, 18, 400, INK, contentRight - pad);
      y += 16;
    }
  } else {
    addText("How to pay", pad, y, 16, 700, MUTED);
    y += 26;
    y = addLines(payNote || "Pay the operator directly.", pad, y, 18, 400, INK, contentRight - pad);
    y += 16;
  }

  const terms = [cleanText(business.terms, 800), cleanText(business.gratuityNote, 400)].filter(Boolean).join("  ");
  if (terms) {
    y += 8;
    y = addLines(terms, pad, y, 16, 400, MUTED, contentRight - pad);
  }

  y += pad;
  const height = Math.max(Math.ceil(y), 640);
  return { width, height, commands, texts, logo: hasLogo ? { x: pad, y: headerTop, w: logoSize, h: logoSize } : null };
}

export function paintInvoiceLayout(ctx, layout, logo) {
  const { width, height, commands } = layout;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  for (const cmd of commands) {
    if (cmd.type === "rect") {
      ctx.fillStyle = cmd.color;
      ctx.fillRect(cmd.x, cmd.y, cmd.w || width, cmd.h || height);
    } else if (cmd.type === "line") {
      ctx.strokeStyle = cmd.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
    } else if (cmd.type === "text") {
      ctx.fillStyle = cmd.color;
      ctx.font = cmd.font;
      ctx.textAlign = cmd.align || "left";
      ctx.fillText(cmd.text, cmd.x, cmd.y);
    } else if (cmd.type === "image" && logo) {
      const iw = logo.width || logo.naturalWidth || cmd.w;
      const ih = logo.height || logo.naturalHeight || cmd.h;
      if (!iw || !ih) continue;
      const scale = Math.min(cmd.w / iw, cmd.h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = cmd.x + (cmd.w - dw) / 2;
      const dy = cmd.y + (cmd.h - dh) / 2;
      try {
        ctx.drawImage(logo, dx, dy, dw, dh);
      } catch {
        // Logo is optional; a tainted or broken image must not block the invoice.
      }
    }
  }
}

const LOGO_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i;

export function isSafeLogoDataUrl(value) {
  return typeof value === "string" && value.length <= 200000 && LOGO_RE.test(value);
}

export async function loadLogoImage(dataUrl, ImageCtor) {
  if (!isSafeLogoDataUrl(dataUrl)) return null;
  const Ctor = ImageCtor || (typeof Image !== "undefined" ? Image : null);
  if (!Ctor) return null;
  return new Promise((resolve) => {
    const img = new Ctor();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    try {
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

function measureWithContext(ctx) {
  return (text, fontSize, weight = 400) => {
    ctx.font = font(weight, fontSize);
    return ctx.measureText(String(text)).width;
  };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined" && document.createElement) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  return null;
}

export async function renderInvoiceCanvas(invoice, opts = {}) {
  const probe = makeCanvas(16, 16);
  if (!probe || !probe.getContext) throw new Error("Canvas is not available.");
  const probeCtx = probe.getContext("2d");
  const logo = opts.logo !== undefined
    ? opts.logo
    : await loadLogoImage(invoice && invoice.business && invoice.business.logoDataUrl, opts.Image);
  const logoSize = logo ? { width: logo.width || logo.naturalWidth || 140, height: logo.height || logo.naturalHeight || 140 } : null;
  const measure = opts.measure || measureWithContext(probeCtx);
  const layout = buildInvoiceLayout(invoice, { measure, logoSize, width: opts.width });
  const canvas = makeCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  paintInvoiceLayout(ctx, layout, logo);
  return { canvas, layout, logo };
}

export function canvasToPngBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make a PNG."))), "image/png");
  });
}

function rgbaToRgb(rgba, width, height) {
  const rgb = new Uint8Array(width * height * 3);
  let i = 0;
  let o = 0;
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    i += 4;
    if (a === 255) {
      rgb[o++] = r;
      rgb[o++] = g;
      rgb[o++] = b;
    } else if (a === 0) {
      rgb[o++] = 255;
      rgb[o++] = 255;
      rgb[o++] = 255;
    } else {
      const t = a / 255;
      rgb[o++] = Math.round(r * t + 255 * (1 - t));
      rgb[o++] = Math.round(g * t + 255 * (1 - t));
      rgb[o++] = Math.round(b * t + 255 * (1 - t));
    }
  }
  return rgb;
}

async function deflateBytes(data) {
  if (typeof CompressionStream === "function") {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { deflateSync } = await import("node:zlib");
  return deflateSync(data);
}

function ascii(text) {
  return new TextEncoder().encode(text);
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function xrefEntry(offset, gen, used) {
  return `${String(offset).padStart(10, "0")} ${String(gen).padStart(5, "0")} ${used ? "n" : "f"} \n`;
}

// Minimal PDF 1.4: one page, the invoice raster as a Flate DeviceRGB image, scaled to letter width.
export async function rgbToPdf(width, height, rgb) {
  const w = width | 0;
  const h = height | 0;
  if (w < 1 || h < 1 || !rgb || rgb.length < w * h * 3) throw new Error("Invalid image for PDF.");
  const compressed = await deflateBytes(rgb);
  const pageW = 612;
  const pageH = Math.max(1, Math.round((612 * h) / w));
  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  const contentBytes = ascii(content);

  const objs = [];
  const add = (body) => {
    objs.push(typeof body === "string" ? ascii(body) : body);
    return objs.length;
  };
  add("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  add("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  add(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >> endobj\n`);
  add(concatBytes([ascii(`4 0 obj << /Length ${contentBytes.length} >> stream\n`), contentBytes, ascii("endstream\nendobj\n")]));
  add(concatBytes([
    ascii(`5 0 obj << /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >> stream\n`),
    compressed,
    ascii("\nendstream\nendobj\n"),
  ]));

  const header = ascii("%PDF-1.4\n%\x80\x80\x80\x80\n");
  const offsets = [0];
  let cursor = header.length;
  const parts = [header];
  for (const obj of objs) {
    offsets.push(cursor);
    parts.push(obj);
    cursor += obj.length;
  }
  const xrefStart = cursor;
  let xref = `xref\n0 ${objs.length + 1}\n` + xrefEntry(0, 65535, false);
  for (let i = 1; i <= objs.length; i++) xref += xrefEntry(offsets[i], 0, true);
  xref += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(ascii(xref));
  return concatBytes(parts);
}

export async function rgbaToPdf(width, height, rgba) {
  return rgbToPdf(width, height, rgbaToRgb(rgba, width, height));
}

function canvasRgba(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, rgba: data };
}

function toFile(blob, name, type) {
  if (typeof File === "function") {
    try {
      return new File([blob], name, { type });
    } catch {
      // Some older WebKit builds throw if the type is unusual.
    }
  }
  try {
    blob.name = name;
  } catch {
    // Blob name is not writable everywhere; download still works from an object URL.
  }
  return blob;
}

export async function invoiceFiles(invoice, opts = {}) {
  const { canvas, layout } = await renderInvoiceCanvas(invoice, opts);
  const pngBlob = await canvasToPngBlob(canvas);
  const png = toFile(pngBlob, invoiceFileName(invoice, "png"), "image/png");
  let pdf = null;
  try {
    const { width, height, rgba } = canvasRgba(canvas);
    const pdfBytes = await rgbaToPdf(width, height, rgba);
    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
    pdf = toFile(pdfBlob, invoiceFileName(invoice, "pdf"), "application/pdf");
  } catch {
    pdf = null;
  }
  return { png, pdf, width: layout.width, height: layout.height };
}

const api = {
  invoiceFileName,
  invoiceShareTitle,
  invoiceShareText,
  invoiceSendLinks,
  canShareFile,
  preferredShareFile,
  renderInvoiceCanvas,
  invoiceFiles,
  canvasToPngBlob,
};

if (typeof globalThis !== "undefined") globalThis.NudgeInvoiceShare = api;

export default api;
