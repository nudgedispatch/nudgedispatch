import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import {
  parseBrand, brandCss, brandQrCss, brandContrastProblems, deriveBrand, simpleOf, pairOf, brandRenders, brandJson,
  brandTokens, brandChrome, GSL_BRAND, GSL_DARK_BRAND, FONT_PAIRS, BRAND_FONTS,
} from "../app/brand.js";
import { contrastRatio } from "../app/theme.js";
import { BRAND_FONT_FILES } from "../app/fonts/brand-fonts.js";

test("tgs (PR #31) brand CSS is byte-for-byte unchanged", () => {
  const before = readFileSync(new URL("./fixtures/gsl-brand-v1.css", import.meta.url), "utf8");
  assert.equal(brandCss(JSON.stringify(GSL_BRAND)), before);
});

test("legacy brand without source counts as admin-set and renders on any plan", () => {
  assert.equal(parseBrand(GSL_BRAND).source, "admin");
  assert.equal(brandRenders(GSL_BRAND, false), true);
  assert.equal(brandRenders({ ...GSL_BRAND, source: "owner" }, false), false);
  assert.equal(brandRenders({ ...GSL_BRAND, source: "owner" }, true), true);
  assert.equal(brandRenders("", true), false);
  assert.equal(parseBrand({ ...GSL_BRAND, source: "hacker" }).source, "admin");
});

test("contrast validation: shipped palettes pass, unreadable combos are blocked", () => {
  assert.deepEqual(brandContrastProblems(GSL_BRAND), []);
  assert.deepEqual(brandContrastProblems(GSL_DARK_BRAND), []);
  const grey = deriveBrand({ base: "light", primary: "#ffff66", accent: "#dddddd", background: "#ffffff", text: "#bbbbbb" }, "standard");
  const keys = brandContrastProblems(grey).map((p) => p.key);
  for (const k of ["text-bg", "heading", "button-shape"]) assert.ok(keys.includes(k), k);
  // Body text exactly at the edge.
  const edge = deriveBrand({ base: "light", primary: "#1f3a5f", accent: "#1f3a5f", background: "#ffffff", text: "#777777" }, "standard");
  assert.ok(contrastRatio("#ffffff", "#777777") < 4.5);
  assert.ok(brandContrastProblems(edge).some((p) => p.key === "text-bg"));
  // Button text must be >= 4.5:1 even if the button shape passes 3:1.
  const midButton = deriveBrand({ base: "light", primary: "#808080", accent: "#1f3a5f", background: "#ffffff", text: "#111111" }, "standard");
  const t = brandTokens(midButton);
  if (contrastRatio(t.accent, t.onAccent) < 4.5) assert.ok(brandContrastProblems(midButton).some((p) => p.key === "button-text"));
  assert.equal(brandContrastProblems(null)[0].key, "colors");
});

test("every problem reports ratio and threshold", () => {
  const bad = deriveBrand({ base: "dark", primary: "#222222", accent: "#333333", background: "#000000", text: "#444444" }, "standard");
  const probs = brandContrastProblems(bad);
  assert.ok(probs.length >= 3);
  for (const p of probs) { assert.ok(p.ratio < p.need); assert.match(p.message, /needs/); }
});

test("deriveBrand: light and dark presets derive readable full palettes", () => {
  const presets = [
    { base: "light", primary: "#a8842f", accent: "#8a6d24", background: "#f5f0e6", text: "#111111" },
    { base: "dark", primary: "#e8d060", accent: "#e8d060", background: "#0b0b0b", text: "#f5f0e6" },
    { base: "light", primary: "#1f3a5f", accent: "#1f3a5f", background: "#ffffff", text: "#111111" },
    { base: "dark", primary: "#5fd6c4", accent: "#8ee6d8", background: "#121417", text: "#f2efe8" },
    { base: "light", primary: "#1d5c47", accent: "#1d5c47", background: "#f4f1ea", text: "#132018" },
  ];
  for (const p of presets) {
    const b = deriveBrand(p, "classic");
    assert.ok(parseBrand(b), JSON.stringify(p));
    assert.deepEqual(brandContrastProblems(b), [], JSON.stringify(p));
    assert.deepEqual(simpleOf(b), p);
    assert.equal(pairOf(b), "classic");
  }
  assert.equal(deriveBrand({ base: "light", primary: "nope", background: "#fff", text: "#000" }), null);
});

test("dark CSS covers native controls and errors", () => {
  const css = brandCss(GSL_DARK_BRAND);
  assert.match(css, /color-scheme:dark/);
  assert.match(css, /select option\{background:/);
  assert.match(css, /calendar-picker-indicator/);
  assert.match(css, /\.sugg\{background:/);
  assert.match(css, /\.err\{color:#ff9b8f/);
  assert.ok(contrastRatio(GSL_DARK_BRAND.colors.paper, "#ff9b8f") >= 4.5);
  assert.equal(brandTokens(GSL_DARK_BRAND).onAccent, "#0b0b0b");
});

test("scoped preview CSS has no html rule; QR CSS and chrome", () => {
  const scoped = brandCss(GSL_DARK_BRAND, "#brand-live .bookpage-mock", { scoped: true });
  assert.doesNotMatch(scoped, /html\{/);
  assert.match(brandQrCss(GSL_DARK_BRAND), /body\.qrpage .qr-btn\.primary\{background:#e8d060;color:#0b0b0b/);
  assert.deepEqual(brandChrome(GSL_BRAND), { header: "#fbf8f1", background: "#f5f0e6" });
});

test("brandJson stamps source and is stable", () => {
  const j = JSON.parse(brandJson(GSL_DARK_BRAND, "owner"));
  assert.equal(j.source, "owner");
  assert.equal(j.base, "dark");
  assert.equal(brandJson("{}", "owner"), "");
});

test("font pairs: allow-listed, bundled, and OFL-licensed", () => {
  assert.ok(FONT_PAIRS.length >= 7 && FONT_PAIRS.length <= 9);
  assert.ok(FONT_PAIRS.some((p) => p.heading === "cormorant-garamond" && p.body === "libre-franklin"));
  for (const p of FONT_PAIRS) for (const id of [p.heading, p.body].filter(Boolean)) assert.ok(BRAND_FONTS[id], id);
  for (const [id, f] of Object.entries(BRAND_FONTS)) {
    for (const w of f.weights) assert.ok(BRAND_FONT_FILES[`${id}-${w}.woff2`], `${id}-${w}`);
    const lic = new URL(`../app/fonts/LICENSE-${id}.txt`, import.meta.url);
    assert.ok(existsSync(lic), id);
    assert.match(readFileSync(lic, "utf8"), /SIL OPEN FONT LICENSE/i, id);
  }
});
