import assert from "node:assert/strict";
import test from "node:test";
import { billingAccess } from "../app/access.js";
import { isListedPlatformAdmin, platformAdminEmails } from "../app/platform-admin.js";
import { kindForPlan, normPlan, smsAllowed, stripeKeyProblem } from "../app/billing.js";
import { computeQuote, validateRateSheet } from "../app/quote-engine.js";
import { arrivedMessage, onMyWayMessage, sendBlandSms, smsMode, textingProblem, usCanadaE164 } from "../app/sms.js";
import { meetingPointForArrived, shouldAutoOpenMaps } from "../app/progress-nav.js";
import { verifyStripeSignature } from "../app/stripe_webhook.js";
import { trialState } from "../app/trial.js";

test("platform admin emails fail closed unless listed", () => {
  assert.deepEqual(platformAdminEmails(undefined), []);
  assert.deepEqual(platformAdminEmails({}), []);
  assert.deepEqual(platformAdminEmails({ PLATFORM_ADMIN_EMAILS: "  , ," }), []);
  assert.equal(isListedPlatformAdmin({}, "owner@example.test"), false);
  assert.equal(isListedPlatformAdmin({ PLATFORM_ADMIN_EMAILS: "" }, "owner@example.test"), false);
  const env = { PLATFORM_ADMIN_EMAILS: " Owner@Example.test, dispatcher@example.test " };
  assert.deepEqual(platformAdminEmails(env), ["owner@example.test", "dispatcher@example.test"]);
  assert.equal(isListedPlatformAdmin(env, "owner@example.test"), true);
  assert.equal(isListedPlatformAdmin(env, "other@example.test"), false);
});

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

test("the same pickup and drop-off is not quoted as a zero-mile trip", () => {
  const parsed = validateRateSheet({
    vehicles: [{ name: "SUV", seats: 6, base: "20", perMile: "3" }],
    flatFares: [{
      place: "ATL Airport",
      placeKeywords: "atl, airport",
      prices: { SUV: { oneWay: "145" } },
    }],
  });
  assert.equal(parsed.error, undefined);
  const quote = computeQuote(parsed.sheet, {
    tripType: "one-way",
    vehicle: parsed.sheet.vehicles[0].id,
    pickup: "10300 Virginia Pine Ln, Alpharetta GA 30022",
    dropoff: "10300 Virginia Pine Ln, Alpharetta, GA 30022",
  }, { miles: 0, minutes: 0 });
  assert.equal(quote.available, false);
  assert.equal(quote.reason, "same-address");
  assert.match(quote.message, /same address/i);
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

test("a live Stripe key is refused unless STRIPE_MODE is live, and a missing key stays disconnected", () => {
  assert.match(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_live_example" }), /STRIPE_MODE is live/);
  assert.equal(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_live_example", STRIPE_MODE: "live" }), "");
  assert.equal(stripeKeyProblem({ STRIPE_SECRET_KEY: "sk_test_example" }), "");
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

test("the arrived passenger text matches the on-my-way style and stays short", () => {
  assert.match(onMyWayMessage("Fleet A", "Avery Cole", "09:30"), /Reply STOP to opt out\.$/);
  assert.equal(
    arrivedMessage({ companyName: "Fleet A", driverName: "Riley Cole", vehicle: "SUV", plate: "ATL1042", meetingPoint: "Legacy West Curb (W1 and W2)" }),
    "Fleet A: Your driver Riley has arrived in SUV ATL1042 at Legacy West Curb (W1 and W2). Reply STOP to opt out.",
  );
  assert.equal(
    arrivedMessage({ companyName: "Fleet A", driverName: "Mike" }),
    "Fleet A: Your driver Mike has arrived. Reply STOP to opt out.",
  );
  assert.equal(
    arrivedMessage({ companyName: "", driverName: "", vehicle: "", plate: "", meetingPoint: "" }),
    "Your car service: Your driver has arrived. Reply STOP to opt out.",
  );
  assert.equal(meetingPointForArrived({ side: "pickup", meet: { label: "Legacy West Curb (W1 and W2)" }, spotLabel: "Domestic Terminal North" }), "Legacy West Curb (W1 and W2)");
  assert.equal(meetingPointForArrived({ side: "pickup", spotLabel: "Domestic Terminal North" }), "Domestic Terminal North");
  assert.equal(meetingPointForArrived({ side: "dropoff", meet: { label: "Curbside" } }), "");
});

test("Maps auto-opens only after On my way and Picked up, never after Arrived, drop-off, or undo", () => {
  assert.equal(shouldAutoOpenMaps("En route"), true);
  assert.equal(shouldAutoOpenMaps("Picked up"), true);
  assert.equal(shouldAutoOpenMaps("Arrived"), false);
  assert.equal(shouldAutoOpenMaps("Completed"), false);
  assert.equal(shouldAutoOpenMaps("En route", true), false);
  assert.equal(shouldAutoOpenMaps("Picked up", true), false);
  assert.equal(shouldAutoOpenMaps(""), false);
});
