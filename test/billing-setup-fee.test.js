import assert from "node:assert/strict";
import test from "node:test";
import {
  LOOKUP,
  SETUP_FEE_CHOICES,
  billingJson,
  cardSummary,
  couponCoversProduct,
  normSetupFee,
  paymentMethodJson,
  setupFeeFromBody,
  setupFeeOf,
  setupPromoCode,
  smsSetupInvoiceItem,
  subscriptionPlanItems,
} from "../app/billing.js";

const PRICES = {
  nudge_small_base_monthly: "price_base",
  nudge_small_extra_driver_monthly: "price_extra",
  nudge_setup_small: "price_setup",
  nudge_sms_monthly: "price_sms_m",
  nudge_sms_overage_metered: "price_sms_o",
  nudge_sms_setup: "price_sms_setup",
};

test("setup fee choices: free is the default, legacy beta still works", () => {
  assert.deepEqual(SETUP_FEE_CHOICES, ["free", "charge", "beta"]);
  assert.equal(normSetupFee(" Charge "), "charge");
  assert.equal(normSetupFee("half"), "");
  assert.equal(setupFeeOf({}), "free");
  assert.equal(setupFeeOf({ setup_fee: "beta" }), "beta");
  assert.equal(setupFeeOf({ setup_fee: "junk" }), "free");
  assert.equal(setupFeeFromBody({}, { setup_fee: "charge" }), "charge");
  assert.equal(setupFeeFromBody({ beta: true }, { setup_fee: "free" }), "beta");
  assert.equal(setupFeeFromBody({ beta: false }, null), "free");
  assert.equal(setupFeeFromBody({ setupFee: "charge", beta: true }, null), "charge");
  assert.equal(setupFeeFromBody({ setupFee: "nope" }, null), "");
  assert.equal(setupPromoCode("free"), "FREESETUP");
  assert.equal(setupPromoCode("beta"), "BETA50");
  assert.equal(setupPromoCode("charge"), "");
});

test("subscriptionPlanItems discounts only the setup items, per choice", () => {
  for (const choice of ["free", "beta"]) {
    const built = subscriptionPlanItems("small", 3, false, PRICES, choice, "promo_x");
    assert.deepEqual(built.missing, []);
    assert.deepEqual(built.addInvoiceItems, [{ price: "price_setup", quantity: 1, discounts: [{ promotion_code: "promo_x" }] }]);
    for (const item of built.items) assert.equal(item.discounts, undefined);
    assert.deepEqual(built.items, [{ price: "price_base", quantity: 1 }, { price: "price_extra", quantity: 2 }]);
  }
  const charged = subscriptionPlanItems("small", 1, false, PRICES, "charge", "promo_x");
  assert.deepEqual(charged.addInvoiceItems, [{ price: "price_setup", quantity: 1 }]);
  // Legacy booleans: true = beta, false = charge.
  assert.ok(subscriptionPlanItems("small", 1, false, PRICES, true, "promo_b").addInvoiceItems[0].discounts);
  assert.equal(subscriptionPlanItems("small", 1, false, PRICES, false, "promo_b").addInvoiceItems[0].discounts, undefined);
  // With texting, the texting setup fee is discounted too; monthly texting is not.
  const sms = subscriptionPlanItems("small", 1, true, PRICES, "free", "promo_f");
  assert.deepEqual(sms.addInvoiceItems[1], { price: "price_sms_setup", quantity: 1, discounts: [{ promotion_code: "promo_f" }] });
  assert.ok(sms.items.every((it) => !it.discounts));
});

test("texting setup invoice item carries the promo only when given", () => {
  const free = smsSetupInvoiceItem("cus_1", "sub_1", "price_sms_setup", "co_1", "promo_free");
  assert.deepEqual(free, { customer: "cus_1", subscription: "sub_1", pricing: { price: "price_sms_setup" }, metadata: { app: "nudge-dispatch", company_id: "co_1" }, discounts: [{ promotion_code: "promo_free" }] });
  const charge = smsSetupInvoiceItem("cus_1", "sub_1", "price_sms_setup", "co_1", "");
  assert.equal(charge.discounts, undefined);
  assert.equal(LOOKUP.sms.setup, "nudge_sms_setup");
});

test("coupon coverage follows applies_to", () => {
  assert.equal(couponCoversProduct({ applies_to: { products: ["prod_a", "prod_b"] } }, "prod_b"), true);
  assert.equal(couponCoversProduct({ applies_to: { products: ["prod_a"] } }, "prod_sms"), false);
  assert.equal(couponCoversProduct({ id: "c" }, "prod_any"), true);
  assert.equal(couponCoversProduct(null, "prod_any"), false);
});

test("card summary keeps brand, last 4, and expiry only", () => {
  const pm = { id: "pm_1", card: { brand: "visa", display_brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030, fingerprint: "fp", number: "4242424242424242", cvc: "123" } };
  assert.deepEqual(cardSummary(pm), { brand: "visa", last4: "4242", expMonth: 4, expYear: 2030 });
  assert.equal(cardSummary({ card: { brand: "visa", last4: "42x2" } }), null);
  assert.equal(cardSummary({ type: "us_bank_account" }), null);
  assert.equal(cardSummary(null), null);
  assert.deepEqual(paymentMethodJson({ pm_brand: "amex", pm_last4: "0005", pm_exp_month: 1, pm_exp_year: 2031 }), { brand: "amex", last4: "0005", expMonth: 1, expYear: 2031 });
  assert.equal(paymentMethodJson({}), null);
  const b = billingJson({ billing_plan: "small", setup_fee: "charge", pm_brand: "visa", pm_last4: "4242" }, 1);
  assert.equal(b.setupFee, "charge");
  assert.match(b.setupFeeLabel, /Charge/);
  assert.equal(b.paymentMethod.last4, "4242");
});
