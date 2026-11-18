import assert from "node:assert/strict";
import test from "node:test";
import { applyTrialChange, PAYING_FROM_STRIPE, trialState, trialBanner, trialCancelColumns, cancelFeedback, canCancelTrial, stripeTrialEnd, TRIAL_TIME_LIMIT_DAYS, TRIAL_CANCEL_MODE, CANCEL_REASON_KEYS } from "../app/trial.js";

const DAY = 86400000;
const now = Date.UTC(2026, 10, 17);
const auto = { trial_status: "trial", trial_billing: "auto", trial_started_at: now - 400 * DAY, trial_ride_limit: 15, trial_days: 0, stripe_subscription_id: "sub_1" };

test("no time expiry: a trial 60+ days old with rides left is still open", () => {
  assert.equal(TRIAL_TIME_LIMIT_DAYS, 0);
  const legacy = trialState({ trial_status: "trial", trial_started_at: now - 60 * DAY, trial_ride_limit: 15, trial_days: 30 }, 3, now);
  assert.equal(legacy.open, true);
  assert.equal(legacy.daysLeft, null);
  assert.doesNotMatch(JSON.stringify(trialBanner(legacy)), /day|30/);
  const a = trialState(auto, 3, now);
  assert.equal(a.open, true);
  assert.equal(a.state, "normal");
});

test("counter: warning from 12, converting at 15 without blocking; manual trials still end at 15", () => {
  assert.equal(trialState(auto, 11, now).state, "normal");
  assert.equal(trialState(auto, 12, now).state, "warning");
  assert.equal(trialBanner(trialState(auto, 12, now)).cancelNote, "You can cancel in Account settings.");
  const at15 = trialState(auto, 15, now);
  assert.equal(at15.state, "converting");
  assert.equal(at15.open, true);
  assert.equal(at15.needsConversion, true);
  const converted = trialState({ ...auto, trial_status: "active", trial_converted_at: now }, 15, now);
  assert.equal(converted.state, "converted");
  assert.equal(converted.needsConversion, false);
  assert.equal(trialBanner(converted).dismissible, true);
  assert.equal(trialState({ ...auto, trial_status: "active", trial_converted_at: now, trial_notice_dismissed_at: now }, 20, now).state, "active");
  const manual = trialState({ trial_status: "trial", trial_started_at: now, trial_ride_limit: 15 }, 15, now);
  assert.equal(manual.open, false);
  assert.equal(manual.endedReason, "rides");
});

test("cancel during the trial closes at once: leftover free rides forfeited, never converts", () => {
  assert.equal(TRIAL_CANCEL_MODE, "end_now");
  const cols = trialCancelColumns(now);
  assert.equal(cols.trial_status, "ended");
  assert.equal(cols.trial_end_reason, "canceled");
  const early = trialState({ ...auto, trial_canceled_at: now }, 4, now);
  assert.equal(early.open, false, "access ends even with 11 free rides left");
  assert.equal(early.needsConversion, false);
  assert.equal(early.endedReason, "canceled");
  const late = trialState({ ...auto, trial_status: "ended", trial_end_reason: "canceled", trial_canceled_at: now }, 30, now);
  assert.equal(late.open, false);
  assert.equal(late.needsConversion, false);
  assert.equal(canCancelTrial(auto), true);
  assert.equal(canCancelTrial({ ...auto, trial_canceled_at: now }), false);
  assert.equal(canCancelTrial({ ...auto, trial_converted_at: now }), false);
  assert.equal(canCancelTrial({ ...auto, trial_billing: "" }), false);
});

test("exit survey parsing", () => {
  assert.deepEqual(CANCEL_REASON_KEYS, ["too_expensive", "too_hard", "doesnt_meet_needs", "switching_tools", "not_driving", "other"]);
  assert.deepEqual(cancelFeedback({ skip: true, reasons: ["other"], details: "x" }), { reasons: null, details: null, skipped: true });
  assert.deepEqual(cancelFeedback({ reasons: [], details: "  " }), { reasons: null, details: null, skipped: false });
  assert.deepEqual(cancelFeedback({ reasons: ["other", "other", "too_hard"], details: " hi " }), { reasons: ["other", "too_hard"], details: "hi", skipped: false });
  assert.ok(cancelFeedback({ reasons: ["nope"] }).error);
  assert.equal(cancelFeedback({ reasons: [], details: "x".repeat(5000) }).details.length, 1000);
});

test("Stripe trial_end stays inside Stripe's 730-day limit", () => {
  const end = stripeTrialEnd(now);
  assert.ok(end < now / 1000 + 730 * 86400);
  assert.ok(end > now / 1000 + 729 * 86400);
});

test("admins can't mark a company as paying; paying (active) rows are still read and kept", () => {
  assert.deepEqual(applyTrialChange(auto, { status: "active" }, now), { error: PAYING_FROM_STRIPE });
  const paying = { ...auto, trial_status: "active", trial_converted_at: now };
  assert.equal(trialState(paying, 20, now).plan, "active");
  // Adding rides to a paying company leaves it paying.
  assert.equal(applyTrialChange(paying, { addRides: 5 }, now).next.trial_status, "active");
  assert.equal(applyTrialChange(auto, { status: "ended" }, now).next.trial_status, "ended");
  assert.equal(applyTrialChange(paying, { status: "trial" }, now).next.trial_status, "trial");
});

test("move back to free trial: fresh 15 if never paid, current limit if paid before, refuses live subscriptions", async () => {
  const { moveBackToTrial } = await import("../app/trial.js");
  const now = Date.UTC(2026, 10, 18);
  const base = { id: "c1", created_at: now - 9e8, trial_ride_limit: 15, trial_days: 0, trial_started_at: now - 9e8 };
  // Plain trial ended at 15 rides, no subscription.
  let r = moveBackToTrial({ ...base, trial_status: "ended", trial_end_reason: "rides" }, 15, now);
  assert.equal(r.fresh, true);
  assert.equal(r.next.trial_ride_limit, 30);
  assert.equal(r.next.trial_started_at, now);
  assert.equal(r.next.trial_billing, "");
  assert.equal(trialState({ ...base, ...r.next }, 15, now).ridesLeft, 15);
  // Self-serve trial ended by admin, Stripe sub still trialing: stays auto (converts at the new limit).
  r = moveBackToTrial({ ...base, trial_billing: "auto", trial_status: "ended", stripe_subscription_id: "sub_1", billing_status: "trialing" }, 3, now);
  assert.equal(r.next.trial_billing, "auto");
  assert.equal(r.next.stripe_subscription_id, "sub_1");
  // Self-serve trial canceled by the owner: plain trial, sub detached, never charges.
  r = moveBackToTrial({ ...base, trial_billing: "auto", trial_status: "ended", trial_canceled_at: now - 1, stripe_subscription_id: "sub_1", billing_status: "canceled" }, 4, now);
  assert.equal(r.next.trial_billing, "");
  assert.equal(r.next.stripe_subscription_id, null);
  assert.equal(r.detachedSubscription, true);
  assert.equal(r.next.trial_canceled_at, null);
  // Paid before, subscription canceled: back to trial with the current limit, no auto-conversion.
  r = moveBackToTrial({ ...base, trial_billing: "auto", trial_status: "active", trial_converted_at: now - 5, stripe_subscription_id: "sub_1", billing_status: "canceled", billing_paid_through: now - 1 }, 20, now);
  assert.equal(r.fresh, false);
  assert.equal(r.next.trial_ride_limit, 15);
  assert.equal(r.next.trial_billing, "");
  assert.equal(r.next.trial_converted_at, null);
  assert.equal(trialState({ ...base, ...r.next }, 20, now).state, "ended");
  // Live subscriptions are never touched.
  for (const billing of ["active", "past_due", "incomplete"]) {
    assert.match(moveBackToTrial({ ...base, trial_status: "active", stripe_subscription_id: "sub_1", billing_status: billing }, 1, now).error, /Cancel it in Stripe first/);
  }
  assert.match(moveBackToTrial({ ...base, trial_billing: "auto", trial_status: "active", trial_converted_at: now, stripe_subscription_id: "sub_1", billing_status: "active" }, 16, now).error, /Stripe/);
});
