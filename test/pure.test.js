import assert from "node:assert/strict";
import test from "node:test";
import { billingAccess } from "../app/access.js";
import { kindForPlan, normPlan, smsAllowed, stripeKeyProblem } from "../app/billing.js";
import { computeQuote, validateRateSheet } from "../app/quote-engine.js";
import { sendBlandSms, smsMode, textingProblem, usCanadaE164 } from "../app/sms.js";
import { verifyStripeSignature } from "../app/stripe_webhook.js";
import { trialState } from "../app/trial.js";

test("hourly quote uses the vehicle rate and the hour minimum", () => {
  const parsed = validateRateSheet({
    vehicles: [{ name: "SUV", seats: 6, hourlyRate: "80", minHours: 2 }],
  });
  assert.equal(parsed.error, undefined);
  const quote = computeQuote(parsed.sheet, {
    tripType: "hourly",
    vehicle: parsed.sheet.vehicles[0].id,
    hours: 3,
  }, null);
  assert.equal(quote.available, true);
  assert.equal(quote.basis, "hourly");
  assert.equal(quote.totalCents, 24000);
});

test("a flat airport fare does not need a distance lookup", () => {
  const parsed = validateRateSheet({
    vehicles: [{ name: "SUV", seats: 6 }],
    flatFares: [{
      place: "ATL Airport",
      placeKeywords: "atl, airport",
      prices: { SUV: { oneWay: "125", roundTrip: "230" } },
    }],
  });
  assert.equal(parsed.error, undefined);
  const quote = computeQuote(parsed.sheet, {
    tripType: "one-way",
    vehicle: parsed.sheet.vehicles[0].id,
    pickup: "Hotel lobby",
    dropoff: "ATL Airport",
  }, null);
  assert.equal(quote.available, true);
  assert.equal(quote.basis, "flat");
  assert.equal(quote.totalCents, 12500);
});

test("the free trial ends at 15 completed rides", () => {
  const now = Date.UTC(2026, 10, 11);
  const state = trialState({
    trial_status: "trial",
    trial_started_at: now,
    trial_ride_limit: 15,
    trial_days: 30,
  }, 15, now + 1000);
  assert.equal(state.open, false);
  assert.equal(state.endedReason, "rides");
});

test("a failed payment stays open for 7 days and then locks", () => {
  const start = 1_700_000_000_000;
  const company = {
    stripe_subscription_id: "sub_test",
    billing_status: "past_due",
    billing_past_due_at: start,
  };
  const day = 24 * 60 * 60 * 1000;
  assert.equal(billingAccess(company, start + 6 * day).state, "grace");
  assert.equal(billingAccess(company, start + 6 * day).locked, false);
  assert.equal(billingAccess(company, start + 8 * day).locked, true);
});

test("plan names and texting eligibility stay on the published plans", () => {
  assert.equal(normPlan("small fleet"), "small");
  assert.equal(smsAllowed("solo"), false);
  assert.equal(smsAllowed("fleet"), true);
  assert.equal(kindForPlan("solo"), "individual");
});

test("Stripe live keys are refused and a missing key does not call Stripe", () => {
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_live_example" }), /not a test-mode key/);
  assert.match(stripeKeyProblem({}), /not connected/);
});

test("texting stays off unless SMS_MODE and a Bland key are both set", async () => {
  assert.equal(smsMode({}), "off");
  assert.equal(usCanadaE164("(404) 555-0199"), "+14045550199");
  assert.match(textingProblem({ SMS_MODE: "off", BLAND_API_KEY: "test" }), /switched off/);
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network");
  };
  try {
    const result = await sendBlandSms({ SMS_MODE: "off" }, "+14045550199", "On the way", "idem");
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("Stripe webhook signatures reject a tampered body", async () => {
  const secret = "whsec_test_secret";
  const body = "{\"id\":\"evt_test\"}";
  const t = 1_700_000_000;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=${hex}`, secret, t), "");
  assert.equal(await verifyStripeSignature(body + " ", `t=${t},v1=${hex}`, secret, t), "signature mismatch");
});
