// Booking / QR theme color. Empty means the current Nudge dark header (teal text on #0b0b0b).
// A stored hex is the header background; text is chosen for WCAG contrast.

export const DEFAULT_THEME_HEX = "#0b0b0b";
export const THEME_TEXT_LIGHT = "#f5f5f5";
export const THEME_TEXT_DARK = "#111111";
export const LOGO_MAX_EDGE = 384;
export const LOGO_MAX_BYTES = 120000;
export const LOGO_MAX_DATA_URL = 180000;

export const THEME_PRESETS = [
  { id: "nudge", name: "Nudge dark", hex: "" },
  { id: "navy", name: "Navy", hex: "#0f1c2e" },
  { id: "forest", name: "Forest", hex: "#14302a" },
  { id: "burgundy", name: "Burgundy", hex: "#3b1218" },
  { id: "gold", name: "Gold", hex: "#c4a35a" },
  { id: "ivory", name: "Ivory", hex: "#f4efe6" },
];

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f]{3})$/i;

// Canonical #rrggbb, or "" if empty/default/invalid.
export function normalizeThemeHex(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw || raw.toLowerCase() === "default" || raw.toLowerCase() === "nudge") return "";
  const six = HEX6.exec(raw);
  if (six) return "#" + six[1].toLowerCase();
  const three = HEX3.exec(raw);
  if (three) {
    const [a, b, c] = three[1].toLowerCase().split("");
    return "#" + a + a + b + b + c + c;
  }
  return null;
}

export function themeProblem(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  if (normalizeThemeHex(value) === null) return "Enter a color as a 6-digit hex code, like #0b0b0b.";
  return "";
}

function channel(n) {
  const s = n / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex) {
  const norm = normalizeThemeHex(hex) || DEFAULT_THEME_HEX;
  const n = parseInt(norm.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(bgHex, fgHex) {
  const a = relativeLuminance(bgHex);
  const b = relativeLuminance(fgHex);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

// Pick light or dark text so body copy stays at least 4.5:1 against the theme background.
export function contrastText(bgHex) {
  const bg = normalizeThemeHex(bgHex) || DEFAULT_THEME_HEX;
  const light = contrastRatio(bg, THEME_TEXT_LIGHT);
  const dark = contrastRatio(bg, THEME_TEXT_DARK);
  return light >= dark ? THEME_TEXT_LIGHT : THEME_TEXT_DARK;
}

export function mutedText(bgHex, fgHex) {
  const bg = normalizeThemeHex(bgHex) || DEFAULT_THEME_HEX;
  const fg = fgHex || contrastText(bg);
  const br = parseInt(bg.slice(1), 16);
  const fr = parseInt(fg.slice(1), 16);
  const mix = (shift, amount) => {
    const b = (br >> shift) & 255;
    const f = (fr >> shift) & 255;
    return Math.round(b * (1 - amount) + f * amount);
  };
  const hex = (n) => n.toString(16).padStart(2, "0");
  return "#" + hex(mix(16, 0.72)) + hex(mix(8, 0.72)) + hex(mix(0, 0.72));
}

export function themeVars(hex) {
  const stored = normalizeThemeHex(hex);
  if (stored === null) return null;
  if (!stored) {
    return { hex: "", background: DEFAULT_THEME_HEX, text: "", muted: "", custom: false };
  }
  const text = contrastText(stored);
  return { hex: stored, background: stored, text, muted: mutedText(stored, text), custom: true };
}

export function themeCss(hex, selector) {
  const t = themeVars(hex);
  if (!t || !t.custom) return "";
  const sel = selector || "body.bookpage";
  return `${sel}{--book-theme:${t.background};--book-theme-text:${t.text};--book-theme-muted:${t.muted};}`
    + `${sel} .top,${sel} .qr-head{background:${t.background};border-bottom-color:${t.muted};}`
    + `${sel} .brand,${sel} .qr-head h1,${sel} .coname{color:${t.text};}`
    + `${sel} .brand small,${sel} .qr-hint,${sel} .qr-lead{color:${t.muted};}`
    + `${sel} .logo,${sel} .qr-logo{background:${t.background};}`;
}
