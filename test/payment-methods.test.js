import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePaymentMethods,
  parseStoredPaymentMethods,
  payOptions,
  payLines,
  payUrl,
  normalizeHandle,
  emptyPaymentMethods,
} from "../app/payment-methods.js";

test("handles normalize from the forms owners actually type", () => {
  assert.deepEqual(normalizeHandle("cashapp", " $TGSLimo "), { handle: "TGSLimo", error: "" });
  assert.deepEqual(normalizeHandle("cashapp", "https://cash.app/$TGSLimo"), { handle: "TGSLimo", error: "" });
  assert.deepEqual(normalizeHandle("venmo", "@TGS-Limo"), { handle: "TGS-Limo", error: "" });
  assert.deepEqual(normalizeHandle("venmo", "https://venmo.com/u/TGS-Limo"), { handle: "TGS-Limo", error: "" });
  assert.deepEqual(normalizeHandle("paypal", "paypal.me/TGSLimo"), { handle: "TGSLimo", error: "" });
  assert.deepEqual(normalizeHandle("paypal", "https://www.paypal.me/TGSLimo/"), { handle: "TGSLimo", error: "" });
  assert.deepEqual(normalizeHandle("zelle", "+1 404.555.0123"), { handle: "(404) 555-0123", error: "" });
  assert.deepEqual(normalizeHandle("zelle", "Pay@Example.com"), { handle: "pay@example.com", error: "" });
});

test("bad handles are rejected with a plain message", () => {
  for (const [kind, value] of [
    ["cashapp", "$123"],
    ["cashapp", "$has space"],
    ["cashapp", "$<script>"],
    ["venmo", "@bad name"],
    ["venmo", "x".repeat(31)],
    ["paypal", "Tgs_Limo"],
    ["paypal", "x".repeat(21)],
    ["zelle", "555-1234"],
    ["zelle", "not-an-email@"],
  ]) {
    const result = normalizeHandle(kind, value);
    assert.ok(result.error, `${kind} ${value} should fail`);
    assert.equal(result.handle, "");
  }
});

test("validatePaymentMethods needs a handle for each method turned on", () => {
  assert.match(validatePaymentMethods({ venmo: { on: true, handle: "" } }).error, /Venmo @username, or turn Venmo off/);
  assert.match(validatePaymentMethods("cash").error, /must be an object/);
  assert.match(validatePaymentMethods({ cashapp: "TGS" }).error, /Cash App/);
  const ok = validatePaymentMethods({ cash: { on: true }, venmo: { on: false, handle: "@Later_1" }, junk: { on: true } });
  assert.equal(ok.error, "");
  assert.deepEqual(ok.methods.cash, { on: true, handle: "" });
  assert.deepEqual(ok.methods.venmo, { on: false, handle: "Later_1" });
  assert.equal(ok.methods.junk, undefined);
});

test("stored JSON from before the migration or bad rows reads as nothing turned on", () => {
  assert.deepEqual(parseStoredPaymentMethods(undefined), emptyPaymentMethods());
  assert.deepEqual(parseStoredPaymentMethods("{}"), emptyPaymentMethods());
  assert.deepEqual(parseStoredPaymentMethods("not json"), emptyPaymentMethods());
  const tampered = parseStoredPaymentMethods(JSON.stringify({ cashapp: { on: true, handle: "<b>x" }, cash: { on: true } }));
  assert.deepEqual(tampered.cashapp, { on: false, handle: "" });
  assert.deepEqual(tampered.cash, { on: true, handle: "" });
});

test("pay links carry the amount and invoice number", () => {
  assert.equal(payUrl("cashapp", "TGSLimo", 12500, "TGS-1001"), "https://cash.app/$TGSLimo/125.00");
  assert.equal(payUrl("venmo", "TGS-Limo", 12550, "TGS 1001"), "https://venmo.com/TGS-Limo?txn=pay&amount=125.50&note=Invoice%20TGS%201001");
  assert.equal(payUrl("paypal", "TGSLimo", 9999, "1"), "https://paypal.me/TGSLimo/99.99USD");
  assert.equal(payUrl("paypal", "TGSLimo", 0, "1"), "https://paypal.me/TGSLimo");
  const { methods } = validatePaymentMethods({
    cash: { on: true },
    cashapp: { on: true, handle: "$TGSLimo" },
    zelle: { on: true, handle: "4045550123" },
    venmo: { on: false, handle: "@Off_One" },
    paypal: { on: true, handle: "TGSLimo" },
  });
  const options = payOptions(methods, 12500, "TGS-1001");
  assert.deepEqual(options.map((o) => o.kind), ["cashapp", "paypal", "zelle", "cash"]);
  assert.equal(options.find((o) => o.kind === "zelle").copy, "(404) 555-0123");
  assert.deepEqual(payLines(options), [
    "Cash App: $TGSLimo https://cash.app/$TGSLimo/125.00",
    "PayPal: paypal.me/TGSLimo https://paypal.me/TGSLimo/125.00USD",
    "Zelle: (404) 555-0123",
    "Cash: Pay your driver in cash",
  ]);
});
