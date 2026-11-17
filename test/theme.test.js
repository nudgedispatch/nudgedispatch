import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThemeHex, themeProblem, contrastText, contrastRatio, themeVars, themeCss, THEME_TEXT_LIGHT, THEME_TEXT_DARK } from "../app/theme.js";

test("theme hex normalization and validation", () => {
  assert.equal(normalizeThemeHex(""), "");
  assert.equal(normalizeThemeHex("nudge"), "");
  assert.equal(normalizeThemeHex("#0F1C2E"), "#0f1c2e");
  assert.equal(normalizeThemeHex("c4a"), "#cc44aa");
  assert.equal(normalizeThemeHex("not-a-color"), null);
  assert.equal(themeProblem(""), "");
  assert.match(themeProblem("blue"), /hex/);
});

test("contrast text meets 4.5:1", () => {
  assert.equal(contrastText("#0b0b0b"), THEME_TEXT_LIGHT);
  assert.equal(contrastText("#f4efe6"), THEME_TEXT_DARK);
  assert.equal(contrastText("#c4a35a"), THEME_TEXT_DARK);
  assert.ok(contrastRatio("#0b0b0b", contrastText("#0b0b0b")) >= 4.5);
  assert.ok(contrastRatio("#f4efe6", contrastText("#f4efe6")) >= 4.5);
  assert.ok(contrastRatio("#c4a35a", contrastText("#c4a35a")) >= 4.5);
  assert.ok(contrastRatio("#3b1218", contrastText("#3b1218")) >= 4.5);
});

test("theme CSS is empty for the default and set for a custom color", () => {
  assert.equal(themeVars("").custom, false);
  assert.equal(themeCss(""), "");
  const css = themeCss("#0f1c2e");
  assert.match(css, /--book-theme:#0f1c2e/);
  assert.match(css, /--book-theme-text:#f5f5f5/);
});
