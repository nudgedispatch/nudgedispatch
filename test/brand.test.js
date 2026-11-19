import assert from "node:assert/strict";
import test from "node:test";
import { parseBrand, brandProblem, brandTokens, brandCss, brandFontFaces, GSL_BRAND, BRAND_FONTS } from "../app/brand.js";
import { contrastRatio } from "../app/theme.js";
import { BRAND_FONT_FILES } from "../app/fonts/brand-fonts.js";

test("parseBrand accepts the GSL brand and normalizes hex", () => {
  const b = parseBrand(JSON.stringify({ ...GSL_BRAND, colors: { ...GSL_BRAND.colors, accent: "#A8842F" } }));
  assert.equal(b.colors.accent, "#a8842f");
  assert.equal(b.fonts.heading, "cormorant-garamond");
  assert.equal(b.fonts.body, "libre-franklin");
  assert.deepEqual(parseBrand(GSL_BRAND), parseBrand(JSON.stringify(GSL_BRAND)));
});

test("parseBrand rejects empty, broken, partial, and hostile values", () => {
  assert.equal(parseBrand(""), null);
  assert.equal(parseBrand(null), null);
  assert.equal(parseBrand("{not json"), null);
  assert.equal(parseBrand(JSON.stringify({ colors: { accent: "#a8842f" } })), null);
  const evil = { ...GSL_BRAND, colors: { ...GSL_BRAND.colors, bg: "red;}body{display:none" } };
  assert.equal(parseBrand(evil), null);
  const badFont = parseBrand({ ...GSL_BRAND, fonts: { heading: "url(https://evil)", body: "libre-franklin" } });
  assert.equal(badFont.fonts.heading, undefined);
  assert.equal(parseBrand("x".repeat(5000)), null);
  assert.equal(brandProblem(""), "");
  assert.match(brandProblem("{}"), /hex/);
});

test("brand text colors meet contrast", () => {
  const t = brandTokens(GSL_BRAND);
  assert.equal(t.onAccent, "#111111");
  assert.ok(contrastRatio(t.accent, t.onAccent) >= 4.5, "button text on gold");
  assert.ok(contrastRatio(t.accentDark, t.onAccentDark) >= 4.5, "hover text on dark gold");
  assert.ok(contrastRatio(t.bg, t.ink) >= 7, "body ink on ivory");
  assert.ok(contrastRatio(t.paper, t.muted) >= 4.5, "muted on paper");
  assert.ok(contrastRatio(t.bg, t.accentDark) >= 3, "large dark-gold headings");
});

test("brandCss sets palette, fonts, and only self-hosted font URLs", () => {
  assert.equal(brandCss(""), "");
  const css = brandCss(JSON.stringify(GSL_BRAND));
  assert.match(css, /--bg:#f5f0e6/);
  assert.match(css, /--teal:#a8842f/);
  assert.match(css, /"Cormorant Garamond"/);
  assert.match(css, /"Libre Franklin"/);
  assert.doesNotMatch(css, /https?:/);
  const faces = brandFontFaces(GSL_BRAND);
  for (const m of faces.matchAll(/url\(\/book-fonts\/([^)]+)\)/g)) assert.ok(BRAND_FONT_FILES[m[1]], m[1]);
  for (const [id, f] of Object.entries(BRAND_FONTS)) for (const w of f.weights) assert.ok(BRAND_FONT_FILES[`${id}-${w}.woff2`]);
});
