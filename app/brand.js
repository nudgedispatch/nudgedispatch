// Per-company booking page branding (invoice_settings.brand_json).
// Empty or invalid JSON means no brand: the page keeps the Nudge default (or the single theme_color header).
// Only allow-listed, self-hosted fonts are used, so the booking page CSP (default-src 'self') is unchanged.
//
// brand_json shape (v1, back-compatible with PR #31):
//   { v: 1, base?: "light"|"dark", source?: "owner"|"admin",
//     colors: { accent, accentDark, accentLight, ink, inkSoft, muted, bg, paper, line },
//     fonts: { heading?, body? } }
// Roles: accent = button background; accentDark = hover background (and, on light, headings);
// accentLight = focus ring (and, on dark, headings); ink = body text; bg = page; paper = header/cards.
// A brand without "source" predates the settings screen (set by a platform admin), so it counts as "admin".
//
// Gating (Jesse, Nov 19, 2026: "free trial uses standard stock"): an owner-set brand renders only for
// paying companies. An admin-set brand (assisted setup) renders for any company.

import { normalizeThemeHex, contrastRatio } from "./theme.js";

export const BRAND_COLOR_KEYS = ["accent", "accentDark", "accentLight", "ink", "inkSoft", "muted", "bg", "paper", "line"];
export const BRAND_BASES = ["light", "dark"];
export const BRAND_SOURCES = ["owner", "admin"];

// All SIL Open Font License 1.1, latin subset, served from /book-fonts/.
export const BRAND_FONTS = {
  "cormorant-garamond": { family: "Cormorant Garamond", fallback: "\"Times New Roman\", Georgia, serif", weights: [600], headWeight: 600 },
  "libre-franklin": { family: "Libre Franklin", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 600, 700], headWeight: 700 },
  "playfair-display": { family: "Playfair Display", fallback: "Georgia, \"Times New Roman\", serif", weights: [700], headWeight: 700 },
  "lato": { family: "Lato", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 700], headWeight: 700 },
  "montserrat": { family: "Montserrat", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [600], headWeight: 600 },
  "source-sans-3": { family: "Source Sans 3", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 600], headWeight: 600 },
  "oswald": { family: "Oswald", fallback: "Impact, \"Arial Narrow\", Arial, sans-serif", weights: [600], headWeight: 600 },
  "inter": { family: "Inter", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 600, 700], headWeight: 700 },
  "dm-serif-display": { family: "DM Serif Display", fallback: "Georgia, \"Times New Roman\", serif", weights: [400], headWeight: 400 },
  "dm-sans": { family: "DM Sans", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 600], headWeight: 600 },
  "lora": { family: "Lora", fallback: "Georgia, \"Times New Roman\", serif", weights: [600], headWeight: 600 },
  "nunito-sans": { family: "Nunito Sans", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 600], headWeight: 600 },
};

export const FONT_PAIRS = [
  { id: "standard", name: "Standard (phone's own fonts)", heading: "", body: "" },
  { id: "classic", name: "Classic: Cormorant Garamond + Libre Franklin", heading: "cormorant-garamond", body: "libre-franklin" },
  { id: "elegant", name: "Elegant: Playfair Display + Lato", heading: "playfair-display", body: "lato" },
  { id: "modern", name: "Modern: Montserrat + Source Sans 3", heading: "montserrat", body: "source-sans-3" },
  { id: "bold", name: "Bold: Oswald + Inter", heading: "oswald", body: "inter" },
  { id: "editorial", name: "Editorial: DM Serif Display + DM Sans", heading: "dm-serif-display", body: "dm-sans" },
  { id: "warm", name: "Warm: Lora + Nunito Sans", heading: "lora", body: "nunito-sans" },
  { id: "clean", name: "Clean: Inter", heading: "inter", body: "inter" },
];

export const BRAND_FONT_PATH = "/book-fonts/";

// The Gold Standard Limo (slug tgs), from Mark's brochure palette (light, Draft B).
export const GSL_BRAND = {
  v: 1,
  colors: {
    accent: "#a8842f", accentDark: "#8a6d24", accentLight: "#e8d060",
    ink: "#111111", inkSoft: "#3b3833", muted: "#6b655a",
    bg: "#f5f0e6", paper: "#fbf8f1", line: "#d9cfbb",
  },
  fonts: { heading: "cormorant-garamond", body: "libre-franklin" },
};

// Gold Standard Draft D (dark): #0b0b0b page, ivory text, gold buttons with dark text.
export const GSL_DARK_BRAND = {
  v: 1,
  base: "dark",
  colors: {
    accent: "#e8d060", accentDark: "#a8842f", accentLight: "#e8d060",
    ink: "#f5f0e6", inkSoft: "#d9cfbb", muted: "#b3aa98",
    bg: "#0b0b0b", paper: "#161512", line: "#3a352b",
  },
  fonts: { heading: "cormorant-garamond", body: "libre-franklin" },
};

const MAX_BRAND_JSON = 2000;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Sanitized brand object, or null when absent/invalid. Never throws.
export function parseBrand(value) {
  let raw = value;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    if (raw.length > MAX_BRAND_JSON) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || !raw.colors || typeof raw.colors !== "object") return null;
  const colors = {};
  for (const key of BRAND_COLOR_KEYS) {
    const hex = normalizeThemeHex(raw.colors[key]);
    if (!hex) return null;
    colors[key] = hex;
  }
  const fonts = {};
  const f = raw.fonts && typeof raw.fonts === "object" ? raw.fonts : {};
  for (const slot of ["heading", "body"]) {
    if (typeof f[slot] === "string" && own(BRAND_FONTS, f[slot])) fonts[slot] = f[slot];
  }
  const out = { v: 1, colors, fonts };
  if (raw.base === "dark") out.base = "dark";
  out.source = BRAND_SOURCES.includes(raw.source) ? raw.source : "admin";
  return out;
}

export function baseOf(brand) {
  return brand && brand.base === "dark" ? "dark" : "light";
}

// Should this brand render? Owner-set brands need a paying company; admin-set (assisted) always render.
export function brandRenders(brand, paid) {
  const b = parseBrand(brand);
  if (!b) return false;
  return b.source !== "owner" || !!paid;
}

// Stored JSON (stable key order) for a sanitized brand.
export function brandJson(brand, source) {
  const b = parseBrand(brand);
  if (!b) return "";
  const out = { v: 1 };
  if (b.base === "dark") out.base = "dark";
  out.source = BRAND_SOURCES.includes(source) ? source : b.source;
  out.colors = b.colors;
  out.fonts = b.fonts;
  return JSON.stringify(out);
}

// ---- color helpers ----
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hexOf([r, g, b]) { return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
export function mix(a, b, amount) {
  const x = rgb(a); const y = rgb(b);
  return hexOf(x.map((v, i) => v * (1 - amount) + y[i] * amount));
}
// Move fg toward `toward` until it reaches `min` contrast on bg (or gives up at `toward`).
export function ensureContrast(fg, bg, min, toward) {
  let c = fg;
  for (let i = 1; i <= 20 && contrastRatio(bg, c) < min; i++) c = mix(fg, toward, i / 20);
  return c;
}

// Text color with the best contrast on bg.
export function bestText(bg, candidates) {
  let best = candidates[0];
  for (const c of candidates) if (contrastRatio(bg, c) > contrastRatio(bg, best)) best = c;
  return best;
}

// ---- owner "simple" fields <-> full palette ----
// simple: { base, primary (buttons), accent (headings/highlights), background, text }
export function deriveBrand(simple, fontPair) {
  const base = simple && simple.base === "dark" ? "dark" : "light";
  const primary = normalizeThemeHex(simple && simple.primary);
  const accent = normalizeThemeHex(simple && simple.accent) || primary;
  const bg = normalizeThemeHex(simple && simple.background);
  const ink = normalizeThemeHex(simple && simple.text);
  if (!primary || !bg || !ink) return null;
  const pair = FONT_PAIRS.find((p) => p.id === fontPair) || FONT_PAIRS[0];
  const fonts = {};
  if (pair.heading) fonts.heading = pair.heading;
  if (pair.body) fonts.body = pair.body;
  let colors;
  if (base === "dark") {
    const paper = mix(bg, ink, 0.06);
    colors = {
      accent: primary, accentDark: mix(primary, "#000000", 0.28), accentLight: accent,
      ink, inkSoft: ensureContrast(mix(ink, bg, 0.15), paper, 7, ink),
      muted: ensureContrast(mix(ink, bg, 0.3), paper, 4.5, ink),
      bg, paper, line: mix(bg, ink, 0.2),
    };
  } else {
    const paper = mix(bg, "#ffffff", 0.45);
    colors = {
      accent: primary, accentDark: accent, accentLight: mix(primary, "#ffffff", 0.45),
      ink, inkSoft: ensureContrast(mix(ink, bg, 0.2), paper, 7, ink),
      muted: ensureContrast(mix(ink, bg, 0.4), paper, 4.5, ink),
      bg, paper, line: mix(bg, ink, 0.16),
    };
  }
  const out = { v: 1, colors, fonts };
  if (base === "dark") out.base = "dark";
  return out;
}

export function simpleOf(brand) {
  const b = parseBrand(brand);
  if (!b) return null;
  const dark = b.base === "dark";
  return { base: dark ? "dark" : "light", primary: b.colors.accent, accent: dark ? b.colors.accentLight : b.colors.accentDark, background: b.colors.bg, text: b.colors.ink };
}

export function pairOf(brand) {
  const b = parseBrand(brand);
  if (!b) return "standard";
  const hit = FONT_PAIRS.find((p) => (p.heading || undefined) === b.fonts.heading && (p.body || undefined) === b.fonts.body);
  return hit ? hit.id : "custom";
}

export function brandTokens(brand) {
  const b = parseBrand(brand);
  if (!b) return null;
  const c = b.colors;
  const dark = b.base === "dark";
  const cands = dark ? [c.bg, "#111111", c.ink, "#ffffff"] : [c.ink, c.paper, "#ffffff"];
  const onAccent = bestText(c.accent, cands);
  const onAccentDark = bestText(c.accentDark, dark ? [c.bg, "#111111", c.ink, "#ffffff"] : [c.ink, c.paper, "#ffffff"]);
  const headWeight = b.fonts.heading ? BRAND_FONTS[b.fonts.heading].headWeight : 600;
  return {
    ...c, base: dark ? "dark" : "light", onAccent, onAccentDark, fonts: b.fonts, source: b.source, headWeight,
    accentText: dark ? c.accentLight : c.accentDark,
    fieldBg: dark ? mix(c.bg, c.ink, 0.07) : "#ffffff",
    fieldBorder: dark ? mix(c.bg, c.ink, 0.35) : "#bfb193",
    headerRule: dark ? c.accentDark : c.ink,
    errColor: dark ? "#ff9b8f" : "#a1281a",
  };
}

// WCAG checks that block saving. Returns [] when readable.
// Body text >= 4.5:1, large headings and button shapes >= 3:1, button text on button >= 4.5:1.
export function brandContrastProblems(brand) {
  const t = brandTokens(brand);
  if (!t) return [{ key: "colors", label: "Colors", ratio: 0, need: 0, message: "Pick a color for every field." }];
  const checks = [
    ["text-bg", "Body text on the page background", t.ink, t.bg, 4.5],
    ["text-paper", "Body text on cards and the header", t.ink, t.paper, 4.5],
    ["text-field", "Typed text in form fields", t.ink, t.fieldBg, 4.5],
    ["labels", "Field labels", t.inkSoft, t.bg, 4.5],
    ["muted", "Small print", t.muted, t.paper, 4.5],
    ["heading", "Large headings", t.accentText, t.bg, 3],
    ["button-shape", "Button against the page", t.accent, t.bg, 3],
    ["button-text", "Button text", t.onAccent, t.accent, 4.5],
    ["button-hover", "Button text when pressed", t.onAccentDark, t.accentDark, 4.5],
  ];
  const out = [];
  for (const [key, label, fg, bg, need] of checks) {
    const ratio = Math.round(contrastRatio(bg, fg) * 100) / 100;
    if (ratio < need) out.push({ key, label, ratio, need, message: `${label} is hard to read (${ratio.toFixed(2)}:1, needs ${need}:1).` });
  }
  return out;
}

export function brandProblem(value) {
  if (value == null || value === "") return "";
  return parseBrand(value) ? "" : "Brand needs all of " + BRAND_COLOR_KEYS.join(", ") + " as hex colors.";
}

function fontStack(id) {
  const f = BRAND_FONTS[id];
  return f ? `"${f.family}", ${f.fallback}` : "";
}

export function brandFontFaces(brand) {
  const b = parseBrand(brand);
  if (!b) return "";
  const ids = [...new Set([b.fonts.heading, b.fonts.body].filter(Boolean))];
  return ids.map((id) => BRAND_FONTS[id].weights.map((w) =>
    `@font-face{font-family:"${BRAND_FONTS[id].family}";font-style:normal;font-weight:${w};font-display:swap;src:url(${BRAND_FONT_PATH}${id}-${w}.woff2) format("woff2");}`
  ).join("")).join("");
}

// Full booking page stylesheet for a brand. Loaded after /app.css via /book/<slug>/theme.css.
// opts.scoped: for the settings live preview (no html rule; selector is a container, not body).
export function brandCss(brand, selector, opts = {}) {
  const t = brandTokens(brand);
  if (!t) return "";
  const s = selector || "body.bookpage";
  const head = fontStack(t.fonts.heading);
  const body = fontStack(t.fonts.body);
  const dark = t.base === "dark";
  const hw = t.headWeight;
  let css = brandFontFaces(brand)
    + (opts.scoped ? "" : `html{background:${t.bg};}`)
    + `${s}{--bg:${t.bg};--card:${t.paper};--line:${t.line};--teal:${t.accent};--teal-2:${t.accentText};--gold:${t.accent};--gold2:${t.accentText};--text:${t.ink};--muted:${t.muted};color-scheme:${dark ? "dark" : "light"};background:${t.bg};color:${t.ink};${body ? `font-family:${body};` : ""}}`
    + `${s} .top{background:${t.paper};border-bottom:1px solid ${t.headerRule};padding-top:calc(12px + env(safe-area-inset-top));padding-bottom:12px;}`
    + `${s} .logo{width:auto;height:48px;max-width:96px;border-radius:0;background:transparent;}`
    + `${s} .brand{color:${t.ink};}`
    + `${s} .brand .coname{${head ? `font-family:${head};` : ""}font-weight:${hw};font-size:24px;letter-spacing:.01em;line-height:1.1;}`
    + `${s} .brand small{color:${t.accentText};font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;margin-top:2px;}`
    + `${s} h1,${s} .steph,${s} .card .title{${head ? `font-family:${head};` : ""}font-weight:${hw};}`
    + `${s} h1{color:${t.accentText};font-size:38px;line-height:1.05;margin:8px 0 14px;}`
    + `${s} .steph{color:${t.ink};font-size:24px;text-transform:none;letter-spacing:0;border-bottom:1px solid ${t.line};padding-bottom:6px;margin-top:26px;}`
    + `${s} .card .title{font-size:22px;}`
    + `${s} label{color:${t.inkSoft};font-weight:500;}`
    + `${s} .muted,${s} .fine,${s} .sub{color:${t.muted};}`
    + `${s} input,${s} select,${s} textarea{background:${t.fieldBg};border-color:${t.fieldBorder};border-radius:4px;color:${t.ink};}`
    + `${s} input::placeholder,${s} textarea::placeholder{color:${t.muted};opacity:1;}`
    + `${s} input:focus,${s} select:focus,${s} textarea:focus{border-color:${t.accent};box-shadow:0 0 0 3px ${t.accentLight}66;}`
    + `${s} .btn{background:${t.accent};border-color:${t.accent};color:${t.onAccent};border-radius:2px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;font-size:15px;}`
    + `${s} .btn:hover:not(:disabled),${s} .btn:focus-visible{background:${t.accentDark};border-color:${t.accentDark};color:${t.onAccentDark};}`
    + `${s} .btn.ghost{background:transparent;color:${t.ink};border-color:${t.accent};}`
    + `${s} .btn.ghost:hover:not(:disabled),${s} .btn.ghost:focus-visible{background:${t.accentDark};border-color:${t.accentDark};color:${t.onAccentDark};}`
    + `${s} .card{background:${t.paper};border-color:${t.line};color:${t.ink};}`
    + `${s} .card.quote,${s} .card.closed-card{border-color:${t.accent};border-left-width:3px;}`
    + `${s} .card.quote .qprice{color:${t.ink};${head ? `font-family:${head};` : ""}}`
    + `${s} .okcard{border-color:${t.accent};}`
    + `${s} .chip{background:${t.paper};border-color:${t.accent};color:${t.ink};}`
    + `${s} .qconfirm,${s} .airport-line{color:${t.accentText};}`
    + `${s} .quote-box{background:${t.paper};border-color:${t.line};}`
    + `${s} .quote-box .qlines td{border-top-color:${t.line};}`
    + `${s} .sugg{background:${t.fieldBg};border-color:${t.line};border-radius:4px;}`
    + `${s} .sugg button{color:${t.ink};}`
    + `${s} .sugg button:hover,${s} .sugg button:focus{background:${t.bg};}`
    + `${s} .install-hint{background:${t.paper};border-color:${t.accent};color:${t.ink};}`
    + `${s} .install-dismiss,${s} .stoprow .stop-remove{color:${t.inkSoft};border-radius:4px;}`
    + `${s} table.review th{color:${t.muted};}`
    + `${s} a{color:${t.ink};text-decoration-color:${t.accent};}`
    + `${s} .err{color:${t.errColor};}`;
  if (dark) {
    css += `${s} select option{background:${t.fieldBg};color:${t.ink};}`
      + `${s} input::-webkit-calendar-picker-indicator{filter:invert(1);opacity:.85;}`
      + `${s} .qlines td{color:${t.muted};}${s} .qlines td:last-child,${s} .card.quote .qprice,${s} .quote-box .qtotal{color:${t.ink};}`
      + `${s} table.review td,${s} table.review th{border-top-color:${t.line};}`
      + `${s} .okcard,${s} #doneMeet{color:${t.ink};}`
      + `${s} .btn:disabled{opacity:.5;}`
      + `${s} label.check{color:${t.ink};}`;
  }
  return css;
}

// QR page (/book/<slug>/qr/) stylesheet for a brand.
export function brandQrCss(brand) {
  const t = brandTokens(brand);
  if (!t) return "";
  const s = "body.qrpage";
  const head = fontStack(t.fonts.heading);
  const body = fontStack(t.fonts.body);
  return brandFontFaces(brand)
    + `html,${s}{background:${t.bg};color:${t.ink};${body ? `font-family:${body};` : ""}}`
    + `${s} .qr-logo{background:transparent;border-radius:0;width:auto;max-width:96px;}`
    + `${s} .qr-head h1{color:${t.ink};${head ? `font-family:${head};` : ""}font-weight:${t.headWeight};font-size:26px;}`
    + `${s} .qr-lead{color:${t.accentText};}`
    + `${s} .qr-frame{border:1px solid ${t.line};}`
    + `${s} .qr-url a{color:${t.ink};text-decoration-color:${t.accent};}`
    + `${s} .qr-btn{border-color:${t.accent};color:${t.ink};border-radius:2px;}`
    + `${s} .qr-btn.primary{background:${t.accent};color:${t.onAccent};}`
    + `${s} .qr-btn:focus-visible,${s} .qr-url a:focus-visible,${s} .qr-more a:focus-visible{outline-color:${t.accent};}`
    + `${s} .qr-more,${s} .qr-more a,${s} .qr-hint{color:${t.muted};}`
    + `${s} .qr-note{color:${t.accentText};}`;
}

// Header color (meta theme-color) and page background for manifests.
export function brandChrome(brand) {
  const t = brandTokens(brand);
  return t ? { header: t.paper, background: t.bg } : null;
}
