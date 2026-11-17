import assert from "node:assert/strict";
import test from "node:test";
import { slugBase, slugProblem, normalizeSlug, BOOKING_RESERVED } from "../app/slug.js";
import {
  PUBLIC_BILLING_PLAN,
  signupFieldProblems,
  normalizeSignupPhone,
  signupWantsSms,
  signupLineItems,
  firstInvoiceCents,
  signupPublicConfig,
  checkoutParams,
  isSignupCheckout,
  signupSessionProblem,
  verifyTurnstile,
  bookingPreviewUrl,
  TEXTING_UPGRADE_NOTE,
  SOLO_MONTHLY_CENTS,
} from "../app/signup.js";
import { smsAllowed, LOOKUP } from "../app/billing.js";

test("slug format, reserved words, and suggestions", () => {
  assert.equal(slugBase("Gold Standard Limo"), "gold-standard-limo");
  assert.equal(slugBase("  A!!B  "), "a-b");
  assert.equal(slugProblem("gold-standard-limo"), "");
  assert.equal(slugProblem("Login"), "That company code is reserved. Try another.");
  assert.equal(slugProblem("A"), "Use at least 2 characters.");
  assert.equal(slugProblem("Bad_Slug"), "Use lowercase letters, numbers, and single hyphens. Don't start or end with a hyphen.");
  assert.ok(BOOKING_RESERVED.has("signup"));
  assert.equal(normalizeSlug("  TGS  "), "tgs");
  assert.equal(bookingPreviewUrl("tgs"), "https://app.nudgedispatch.com/book/tgs/");
});

test("public signup is Solo, no trial SMS, and requires terms plus permanent-code confirm", () => {
  assert.equal(PUBLIC_BILLING_PLAN, "solo");
  assert.equal(smsAllowed("solo"), false);
  assert.equal(smsAllowed("small"), true);
  const base = {
    companyName: "Gold Standard Limo",
    ownerName: "Jesse Bailey",
    email: "owner@example.test",
    bookingSlug: "gold-standard-limo",
    termsAccepted: true,
    slugPermanentConfirmed: true,
    ownerPhone: "404-555-0100",
  };
  assert.equal(signupFieldProblems(base), "");
  assert.equal(signupFieldProblems({ ...base, ownerPhone: undefined }), "Enter your phone number.");
  assert.equal(signupFieldProblems({ ...base, ownerPhone: "" }), "Enter your phone number.");
  assert.match(signupFieldProblems({ ...base, ownerPhone: "555-0100" }), /phone number/);
  assert.equal(signupFieldProblems({ ...base, ownerPhone: "(404) 555-0100" }), "");
  assert.equal(signupFieldProblems({ ...base, ownerPhone: "+1 404 555 0100" }), "");
  assert.equal(signupFieldProblems({ ...base, ownerPhone: "14045550100" }), "");
  assert.equal(signupFieldProblems({ ...base, businessPhone: "" }), "");
  assert.match(signupFieldProblems({ ...base, businessPhone: "555-0100" }), /business phone/);
  assert.equal(normalizeSignupPhone("404-555-0100"), "+14045550100");
  assert.equal(normalizeSignupPhone("(404) 555-0100"), "+14045550100");
  assert.equal(normalizeSignupPhone("1 404 555 0100"), "+14045550100");
  assert.equal(normalizeSignupPhone("+14045550100"), "+14045550100");
  assert.equal(normalizeSignupPhone("555-0100"), "");
  assert.equal(signupFieldProblems({ ...base, termsAccepted: false }), "Please agree to the Terms of Service and Privacy Policy.");
  assert.equal(signupFieldProblems({ ...base, slugPermanentConfirmed: false }), "Please confirm you understand the company code can't be changed.");
  assert.equal(signupFieldProblems({ ...base, plan: "fleet" }), "The public plan is Solo.");
  assert.equal(signupFieldProblems({ ...base, smsAddon: true }), "Texting is available on Small fleet and up.");
  assert.equal(signupFieldProblems({ ...base, themeColor: "" }), "");
  assert.match(signupFieldProblems({ ...base, themeColor: "blue" }), /hex/);
  assert.equal(signupFieldProblems({ ...base, logoDataUrl: "" }), "");
  assert.match(signupFieldProblems({ ...base, logoDataUrl: "data:text/plain,nope" }), /logo/i);

  assert.equal(signupWantsSms({ sms: true }), true);
  assert.match(TEXTING_UPGRADE_NOTE, /Small fleet and up/);
  assert.match(TEXTING_UPGRADE_NOTE, /\$75 setup/);
  const cfg = signupPublicConfig({});
  assert.equal(cfg.smsAllowed, false);
  assert.equal(cfg.setupWaived, true);
  assert.match(cfg.selfSetupLabel, /^Self setup \(you're doing it now\): setup fee waived$/);
  assert.equal(cfg.assistedSetupText, "Prefer we set it up for you? $299 one-time assisted setup.");
  assert.equal(cfg.assistedSetupMailto, "mailto:nudgedispatch@gmail.com?subject=Nudge%20Dispatch%20Solo%20assisted%20setup");
  assert.ok(cfg.textingUpgradeNote);
});

test("checkout line items omit plan setup and never add SMS on Solo", () => {
  const prices = {
    [LOOKUP.solo.base]: "price_solo",
    [LOOKUP.solo.setup]: "price_setup",
    [LOOKUP.sms.monthly]: "price_sms",
    [LOOKUP.sms.setup]: "price_sms_setup",
  };
  const built = signupLineItems(prices, false);
  assert.deepEqual(built.items, [{ price: "price_solo", quantity: 1 }]);
  assert.equal(built.missing.length, 0);
  assert.equal(built.addOverage, false);
  const withSms = signupLineItems(prices, true);
  assert.deepEqual(withSms.items, [{ price: "price_solo", quantity: 1 }]);
  assert.equal(firstInvoiceCents(false), SOLO_MONTHLY_CENTS);
  assert.equal(firstInvoiceCents(true), SOLO_MONTHLY_CENTS);
  const { params } = checkoutParams({
    origin: "https://app.nudgedispatch.com",
    customerEmail: "owner@example.test",
    signupId: "sig-1",
    slug: "tgs",
    sms: true,
    prices,
    pmc: "pmc_cardonlytest1",
  });
  assert.equal(params.mode, "subscription");
  assert.equal(params.allow_promotion_codes, undefined);
  assert.equal(params.payment_method_configuration, "pmc_cardonlytest1");
  assert.equal(params.line_items.length, 1);
  assert.equal(params.line_items[0].price, "price_solo");
  assert.equal(params.metadata.sms, "off");
  assert.equal(params.success_url, "https://app.nudgedispatch.com/signup/complete?session_id={CHECKOUT_SESSION_ID}");
});

test("signup checkout session checks", () => {
  const session = {
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    metadata: { purpose: "signup", signup_id: "abc" },
  };
  assert.equal(isSignupCheckout(session), true);
  assert.equal(isSignupCheckout({ mode: "setup", metadata: { purpose: "card" } }), false);
  assert.equal(signupSessionProblem(session, { id: "abc" }), "");
  assert.match(signupSessionProblem({ ...session, status: "open" }, { id: "abc" }), /not finished/);
  assert.match(signupSessionProblem({ ...session, metadata: { purpose: "signup", signup_id: "other" } }, { id: "abc" }), /different signup/);
});

test("Turnstile is skipped when no secret is configured", async () => {
  const skipped = await verifyTurnstile({}, "");
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  const blocked = await verifyTurnstile({ TURNSTILE_SECRET_KEY: "sec" }, "");
  assert.equal(blocked.ok, false);
});

test("signup plan card shows self setup as default and assisted setup as the emailed alternative", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../app/client-signup.txt", import.meta.url), "utf8");
  assert.match(src, /id="setup-self"/);
  assert.match(src, /cfg\.selfSetupLabel/);
  assert.match(src, /id="setup-assisted"/);
  assert.match(src, /cfg\.assistedSetupMailto/);
  assert.ok(src.indexOf('id="setup-self"') < src.indexOf('id="setup-assisted"'));
});
