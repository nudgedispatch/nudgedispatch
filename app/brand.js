// Per-company booking page branding (invoice_settings.brand_json).
// Empty or invalid JSON means no brand: the page keeps the Nudge default (or the single theme_color header).
// Only allow-listed, self-hosted fonts are used, so the booking page CSP (default-src 'self') is unchanged.

import { normalizeThemeHex, contrastRatio } from "./theme.js";

export const BRAND_COLOR_KEYS = ["accent", "accentDark", "accentLight", "ink", "inkSoft", "muted", "bg", "paper", "line"];

export const BRAND_FONTS = {
  "cormorant-garamond": { family: "Cormorant Garamond", fallback: "\"Times New Roman\", Georgia, serif", weights: [600] },
  "libre-franklin": { family: "Libre Franklin", fallback: "system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif", weights: [400, 600, 700] },
};

export const BRAND_FONT_PATH = "/book-fonts/";

// The Gold Standard Limo (slug tgs), from Mark's brochure palette. Reference value for seeding.
export const GSL_BRAND = {
  v: 1,
  colors: {
    accent: "#a8842f", accentDark: "#8a6d24", accentLight: "#e8d060",
    ink: "#111111", inkSoft: "#3b3833", muted: "#6b655a",
    bg: "#f5f0e6", paper: "#fbf8f1", line: "#d9cfbb",
  },
  fonts: { heading: "cormorant-garamond", body: "libre-franklin" },
};

const MAX_BRAND_JSON = 2000;

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
    if (typeof f[slot] === "string" && Object.prototype.hasOwnProperty.call(BRAND_FONTS, f[slot])) fonts[slot] = f[slot];
  }
  return { v: 1, colors, fonts };
}

export function brandProblem(value) {
  if (value == null || value === "") return "";
  return parseBrand(value) ? "" : "Brand needs all of " + BRAND_COLOR_KEYS.join(", ") + " as hex colors.";
}

// Text color with the best contrast on bg, from the brand's own ink/paper plus pure white.
export function bestText(bg, candidates) {
  let best = candidates[0];
  for (const c of candidates) if (contrastRatio(bg, c) > contrastRatio(bg, best)) best = c;
  return best;
}

export function brandTokens(brand) {
  const b = parseBrand(brand);
  if (!b) return null;
  const c = b.colors;
  const onAccent = bestText(c.accent, [c.ink, c.paper, "#ffffff"]);
  const onAccentDark = bestText(c.accentDark, [c.ink, c.paper, "#ffffff"]);
  return { ...c, onAccent, onAccentDark, fonts: b.fonts };
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
export function brandCss(brand, selector) {
  const t = brandTokens(brand);
  if (!t) return "";
  const s = selector || "body.bookpage";
  const head = fontStack(t.fonts.heading);
  const body = fontStack(t.fonts.body);
  return brandFontFaces(brand)
    + `html{background:${t.bg};}`
    + `${s}{--bg:${t.bg};--card:${t.paper};--line:${t.line};--teal:${t.accent};--teal-2:${t.accentDark};--gold:${t.accent};--gold2:${t.accentDark};--text:${t.ink};--muted:${t.muted};color-scheme:light;background:${t.bg};color:${t.ink};${body ? `font-family:${body};` : ""}}`
    + `${s} .top{background:${t.paper};border-bottom:1px solid ${t.ink};padding-top:calc(12px + env(safe-area-inset-top));padding-bottom:12px;}`
    + `${s} .logo{width:auto;height:48px;max-width:96px;border-radius:0;background:transparent;}`
    + `${s} .brand{color:${t.ink};}`
    + `${s} .brand .coname{${head ? `font-family:${head};` : ""}font-weight:600;font-size:24px;letter-spacing:.01em;line-height:1.1;}`
    + `${s} .brand small{color:${t.accentDark};font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;margin-top:2px;}`
    + `${s} h1,${s} .steph,${s} .card .title{${head ? `font-family:${head};` : ""}font-weight:600;}`
    + `${s} h1{color:${t.accentDark};font-size:38px;line-height:1.05;margin:8px 0 14px;}`
    + `${s} .steph{color:${t.ink};font-size:24px;text-transform:none;letter-spacing:0;border-bottom:1px solid ${t.line};padding-bottom:6px;margin-top:26px;}`
    + `${s} .card .title{font-size:22px;}`
    + `${s} label{color:${t.inkSoft};font-weight:500;}`
    + `${s} .muted,${s} .fine,${s} .sub{color:${t.muted};}`
    + `${s} input,${s} select,${s} textarea{background:#ffffff;border-color:#bfb193;border-radius:4px;color:${t.ink};}`
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
    + `${s} .qconfirm,${s} .airport-line{color:${t.accentDark};}`
    + `${s} .quote-box{background:${t.paper};border-color:${t.line};}`
    + `${s} .quote-box .qlines td{border-top-color:${t.line};}`
    + `${s} .sugg{background:#ffffff;border-color:${t.line};border-radius:4px;}`
    + `${s} .sugg button{color:${t.ink};}`
    + `${s} .sugg button:hover,${s} .sugg button:focus{background:${t.bg};}`
    + `${s} .install-hint{background:${t.paper};border-color:${t.accent};color:${t.ink};}`
    + `${s} .install-dismiss,${s} .stoprow .stop-remove{color:${t.inkSoft};border-radius:4px;}`
    + `${s} table.review th{color:${t.muted};}`
    + `${s} a{color:${t.ink};text-decoration-color:${t.accent};}`
    + `${s} .err{color:#a1281a;}`;
}
