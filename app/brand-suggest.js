// "Paste your website URL": suggest booking page colors, fonts, and a logo from an owner's site.
// Suggestions only. Nothing is saved until the owner reviews them and presses Save (which runs the
// normal contrast gate). Safety rules for the server-side fetch:
//   - https only, default port only, no user:pass@, hostname must be a public DNS name (no IP literals,
//     no localhost / .local / .internal / single-label names)
//   - every hostname (including each redirect target) is resolved over DNS-over-HTTPS and rejected if any
//     A/AAAA answer is private, loopback, link-local, CGNAT, multicast, or reserved
//   - redirects are followed by hand (max 3), each one re-checked
//   - total time budget (default 8 s), byte caps (HTML 1.5 MB, CSS 400 KB each, logo 1 MB)
//   - no cookies or caller headers are sent; fixed User-Agent; GET only
//   - per-company rate limit is enforced by the caller (index.js)

import { FONT_PAIRS, BRAND_FONTS } from "./brand.js";
import { normalizeThemeHex, contrastRatio } from "./theme.js";

export const SUGGEST_LIMITS = { htmlBytes: 1500000, cssBytes: 400000, logoBytes: 1000000, timeoutMs: 8000, maxRedirects: 3, maxStylesheets: 2 };
export const SUGGEST_UA = "NudgeDispatchBrandSuggest/1.0 (+https://nudgedispatch.com)";

export class SuggestError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".arpa", ".invalid", ".test", ".example"];

// Parse and vet a URL typed by the owner. Returns a URL or throws SuggestError.
export function checkSuggestUrl(raw) {
  let text = String(raw || "").trim();
  if (!text) throw new SuggestError("url", "Paste your website address.");
  if (text.length > 500) throw new SuggestError("url", "That address is too long.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = "https://" + text;
  let url;
  try { url = new URL(text); } catch { throw new SuggestError("url", "That doesn't look like a website address."); }
  if (url.protocol !== "https:") throw new SuggestError("url", "Use an https:// address.");
  if (url.username || url.password) throw new SuggestError("url", "Remove the user name or password from the address.");
  if (url.port && url.port !== "443") throw new SuggestError("url", "Use the normal https address without a port number.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || /^[0-9.]+$/.test(host) || /^0x/i.test(host) || host.includes(":")) {
    throw new SuggestError("url", "Use your website's name, not an IP address.");
  }
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SuggestError("url", "That address isn't a public website.");
  }
  url.hash = "";
  return url;
}

function ipv4Private(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 192 && b === 0 && p[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113);
}

// True for any address a server-side fetch must never reach.
export function isPrivateIp(ip) {
  const s = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!s) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return ipv4Private(s);
  if (!s.includes(":")) return true;
  const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) || /^::(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return ipv4Private(mapped[1]);
  if (s === "::" || s === "::1" || /^0*:0*:0*:0*:0*:0*:0*:0*1?$/.test(s)) return true;
  const first = parseInt(s.split(":")[0] || "0", 16);
  if (first === 0) return true;                   // ::/16: unspecified, loopback, IPv4-mapped/compatible (any form)
  if ((first & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true;   // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true;   // multicast
  if (first === 0x2001 && parseInt(s.split(":")[1] || "0", 16) === 0x0db8) return true; // documentation
  if (first === 0x0064 && s.startsWith("64:ff9b:")) return true; // NAT64
  return false;
}

// DNS-over-HTTPS resolver (Cloudflare). Returns all A/AAAA answers.
export async function dohResolve(host, fetchImpl, signal) {
  const out = [];
  for (const type of ["A", "AAAA"]) {
    const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal, redirect: "manual" });
    if (!r.ok) throw new SuggestError("dns", "Couldn't look up that website.");
    const data = await r.json().catch(() => ({}));
    for (const a of data.Answer || []) if (a.type === 1 || a.type === 28) out.push(String(a.data));
  }
  return out;
}

async function assertPublicHost(host, resolve, signal) {
  const ips = await resolve(host, signal);
  if (!ips.length) throw new SuggestError("dns", "That website's address didn't resolve.");
  if (ips.some(isPrivateIp)) throw new SuggestError("blocked", "That address points to a private network, so we can't read it.");
}

async function readCapped(response, cap) {
  const len = Number(response.headers.get("content-length") || "0");
  if (len > cap) throw new SuggestError("size", "That page is too large to read.");
  if (!response.body || typeof response.body.getReader !== "function") {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.length > cap) throw new SuggestError("size", "That page is too large to read.");
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { try { await reader.cancel(); } catch { /* ignore */ } throw new SuggestError("size", "That page is too large to read."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Safe GET: vetted URL, DNS check on every hop, manual redirects, byte cap, no cookies.
export async function safeFetch(rawUrl, { fetchImpl, resolve, signal, cap, accept, types }) {
  let url = rawUrl instanceof URL ? rawUrl : checkSuggestUrl(rawUrl);
  for (let hop = 0; hop <= SUGGEST_LIMITS.maxRedirects; hop++) {
    await assertPublicHost(url.hostname, resolve, signal);
    const r = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { "user-agent": SUGGEST_UA, accept: accept || "text/html" },
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new SuggestError("fetch", "That website sent a broken redirect.");
      url = checkSuggestUrl(new URL(loc, url).toString());
      continue;
    }
    if (!r.ok) throw new SuggestError("fetch", `That website answered with an error (${r.status}).`);
    const type = (r.headers.get("content-type") || "").toLowerCase();
    if (types && !types.some((t) => type.includes(t))) throw new SuggestError("type", "That address isn't a web page we can read.");
    return { url, type, bytes: await readCapped(r, cap) };
  }
  throw new SuggestError("fetch", "That website redirected too many times.");
}

// ---- extraction (plain text parsing; nothing from the page is executed) ----
const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
}
function tags(html, name) { return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || []; }
function sat(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}
function lum(hex) { return contrastRatio(hex, "#000000"); }

export function extractCss(html) {
  const blocks = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).map((b) => b.replace(/<\/?style\b[^>]*>/gi, ""));
  const inline = tags(html, "[a-z0-9]+").map((t) => attr(t, "style")).filter(Boolean);
  return blocks.join("\n") + "\n" + inline.map((s) => `x{${s}}`).join("\n");
}

export function stylesheetLinks(html, base) {
  const out = [];
  for (const t of tags(html, "link")) {
    if (!/\bstylesheet\b/i.test(attr(t, "rel"))) continue;
    const href = attr(t, "href");
    if (!href) continue;
    try { out.push(new URL(href, base)); } catch { /* skip */ }
  }
  return out;
}

export function suggestFromPage(html, css, baseUrl) {
  const found = { themeColor: "", background: "", text: "", primary: "", accent: "", fonts: [], logo: "" };
  for (const t of tags(html, "meta")) {
    if (/^theme-color$/i.test(attr(t, "name"))) found.themeColor = normalizeThemeHex(attr(t, "content")) || "";
  }
  const all = css + "\n" + html.slice(0, 200000);
  const bodyRule = /(?:^|[}\s,])(?:html|body|:root)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = bodyRule.exec(css))) {
    const decl = m[1];
    const bg = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(decl);
    const fg = /(?:^|;|\s)color\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(decl);
    if (bg && !found.background) found.background = normalizeThemeHex(bg[1]) || "";
    if (fg && !found.text) found.text = normalizeThemeHex(fg[1]) || "";
  }
  // Button / link colors first, then the most common saturated color.
  const btn = /(?:\.btn|button|\.button|a)\b[^{]*\{([^}]*)\}/gi;
  const counts = new Map();
  while ((m = btn.exec(css))) {
    const c = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(m[1]) || /(?:^|;|\s)color\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(m[1]);
    const hex = c && normalizeThemeHex(c[1]);
    if (hex && sat(hex) > 0.25) counts.set(hex, (counts.get(hex) || 0) + 3);
  }
  for (const h of all.match(HEX_RE) || []) {
    const hex = normalizeThemeHex(h);
    if (hex && sat(hex) > 0.25 && lum(hex) > 1.3 && lum(hex) < 19) counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  if (found.themeColor && sat(found.themeColor) > 0.25) ranked.unshift(found.themeColor);
  found.primary = ranked[0] || "";
  found.accent = ranked.find((h) => h !== found.primary) || found.primary;
  // Fonts: Google Fonts links and font-family declarations.
  const families = [];
  for (const t of tags(html, "link")) {
    const href = attr(t, "href");
    const fam = /fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/i.exec(href);
    if (fam) for (const part of fam[1].split("&")) { const f = /^family=([^:&]+)/i.exec(part); if (f) families.push(decodeURIComponent(f[1].replace(/\+/g, " "))); }
  }
  for (const d of css.match(/font-family\s*:\s*([^;}]+)/gi) || []) {
    const first = d.replace(/font-family\s*:\s*/i, "").split(",")[0].replace(/["']/g, "").trim();
    if (first && !/^(inherit|initial|var\(|-apple-system|system-ui|sans-serif|serif)$/i.test(first)) families.push(first);
  }
  found.fonts = [...new Set(families)].filter((f) => f && !/^var\(|^inherit$|^initial$|^-apple-system$|^system-ui$|^sans-serif$|^serif$/i.test(f)).slice(0, 6);
  // Logo: apple-touch-icon, og:image, an <img> that says logo, then icon.
  const cands = [];
  for (const t of tags(html, "img")) {
    if (/logo/i.test(attr(t, "class") + attr(t, "id") + attr(t, "alt") + attr(t, "src"))) cands.push([attr(t, "src"), 3]);
  }
  for (const t of tags(html, "link")) {
    const rel = attr(t, "rel").toLowerCase();
    if (rel.includes("apple-touch-icon")) cands.push([attr(t, "href"), 2]);
    else if (/\bicon\b/.test(rel)) cands.push([attr(t, "href"), 0]);
  }
  for (const t of tags(html, "meta")) if (/^og:(image|logo)$/i.test(attr(t, "property"))) cands.push([attr(t, "content"), 1]);
  cands.sort((a, b) => b[1] - a[1]);
  for (const [src] of cands) {
    if (!src || /^data:/i.test(src) || /\.svg(\?|$)/i.test(src)) continue;
    try { const u = new URL(src, baseUrl); if (u.protocol === "https:") { found.logo = u.toString(); break; } } catch { /* skip */ }
  }
  return found;
}

// Map what we found onto the owner's simple fields + a font pair. Always readable fallbacks.
export function toSimple(found) {
  const bg = found.background || "#ffffff";
  const dark = contrastRatio(bg, "#000000") < contrastRatio(bg, "#ffffff");
  const text = found.text && contrastRatio(bg, found.text) >= 4.5 ? found.text : (dark ? "#f5f5f5" : "#111111");
  const primary = found.primary || (dark ? "#e8d060" : "#1f3a5f");
  const accent = found.accent && contrastRatio(bg, found.accent) >= 3 ? found.accent : primary;
  const famIds = found.fonts.map((f) => Object.entries(BRAND_FONTS).find(([, v]) => v.family.toLowerCase() === f.toLowerCase())).filter(Boolean).map(([id]) => id);
  let pair = FONT_PAIRS.find((p) => famIds.includes(p.heading) && famIds.includes(p.body)) ||
    FONT_PAIRS.find((p) => famIds.includes(p.heading) || famIds.includes(p.body));
  if (!pair) {
    const serif = found.fonts.some((f) => /serif|garamond|playfair|lora|georgia|times|didot|bodoni|baskerville/i.test(f) && !/sans/i.test(f));
    pair = FONT_PAIRS.find((p) => p.id === (found.fonts.length ? (serif ? "classic" : "modern") : "standard"));
  }
  return { base: dark ? "dark" : "light", primary, accent, background: bg, text, pair: pair.id };
}

// Full pipeline. Injected fetch/resolve make it testable without a network.
export async function suggestBrand(rawUrl, { fetchImpl = fetch, resolve, timeoutMs = SUGGEST_LIMITS.timeoutMs } = {}) {
  const start = checkSuggestUrl(rawUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = ctrl.signal;
  const res = resolve || ((h, s) => dohResolve(h, fetchImpl, s));
  const guard = new Promise((_, reject) => signal.addEventListener("abort", () => reject(new SuggestError("timeout", "That website took too long to answer.")), { once: true }));
  const run = async () => {
    const page = await safeFetch(start, { fetchImpl, resolve: res, signal, cap: SUGGEST_LIMITS.htmlBytes, types: ["text/html", "application/xhtml"] });
    const html = new TextDecoder().decode(page.bytes);
    let css = extractCss(html);
    for (const link of stylesheetLinks(html, page.url).slice(0, SUGGEST_LIMITS.maxStylesheets)) {
      try {
        checkSuggestUrl(link.toString());
        const sheet = await safeFetch(link, { fetchImpl, resolve: res, signal, cap: SUGGEST_LIMITS.cssBytes, accept: "text/css", types: ["text/css"] });
        css += "\n" + new TextDecoder().decode(sheet.bytes);
      } catch (e) { if (e && e.code === "timeout") throw e; /* skip unreadable stylesheet */ }
    }
    const found = suggestFromPage(html, css, page.url);
    let logoDataUrl = "";
    if (found.logo) {
      try {
        const img = await safeFetch(found.logo, { fetchImpl, resolve: res, signal, cap: SUGGEST_LIMITS.logoBytes, accept: "image/png,image/jpeg,image/webp", types: ["image/png", "image/jpeg", "image/webp"] });
        const mime = img.type.split(";")[0].trim();
        let bin = "";
        for (let i = 0; i < img.bytes.length; i += 0x8000) bin += String.fromCharCode(...img.bytes.subarray(i, i + 0x8000));
        logoDataUrl = `data:${mime};base64,${btoa(bin)}`;
      } catch (e) { if (e && e.code === "timeout") throw e; }
    }
    return { url: page.url.toString(), found: { ...found, logo: found.logo ? "found" : "" }, simple: toSimple(found), logoDataUrl };
  };
  try {
    return await Promise.race([run(), guard]);
  } catch (e) {
    if (signal.aborted) throw new SuggestError("timeout", "That website took too long to answer.");
    if (e instanceof SuggestError) throw e;
    console.log(JSON.stringify({ level: "warn", msg: "brand suggest failed", name: e && e.name, detail: String(e && e.message || "").slice(0, 200) }));
    throw new SuggestError("fetch", "We couldn't read that website.");
  } finally {
    clearTimeout(timer);
  }
}
