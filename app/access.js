// Nudge Dispatch billing access (DRAFT, Nov 10, 2026). Pure functions, testable with a fixed clock.
// Rules (Jesse, Nov 10, 2026):
//  - No Stripe subscription on the company (trial / beta / manual companies): billing never locks; trial rules apply as before.
//  - active / trialing: full access.
//  - past_due: full access for 7 days from the FIRST failed payment, with an owner banner; then locked.
//  - canceled: full access until the paid-through date, with an owner banner; then locked.
//  - A later paid invoice sets the status back to active (and clears the failure date), which unlocks.
// Locked = owners and drivers see a locked page; data is kept; the platform admin is never locked.
import { etDate, TRIAL_CONTACT_EMAIL } from "./trial.js";

export const GRACE_DAYS = 7;
export const BILLING_CONTACT_EMAIL = TRIAL_CONTACT_EMAIL;   // nudgedispatch@gmail.com
const DAY_MS = 24 * 60 * 60 * 1000;

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

// company: { stripe_subscription_id, billing_status, billing_past_due_at, billing_paid_through, billing_last_paid_at, billing_event_at, billing_updated_at }
// Returns { state, locked, until, reason } where state is one of:
//   "none"   no Stripe subscription -> billing does not apply
//   "ok"     paying (or waiting for the first invoice)
//   "grace"  payment failed, still inside the 7 days (until = grace end)
//   "ending" canceled, still inside the paid period (until = paid-through)
//   "locked" access paused (reason "payment" or "canceled")
export function billingAccess(company, now = Date.now()) {
  if (!company || !company.stripe_subscription_id) return { state: "none", locked: false, until: null, reason: "" };
  const status = company.billing_status || "";
  if (status === "past_due") {
    // Start of the grace period = first failure. Older rows without it fall back to the last billing event.
    const start = num(company.billing_past_due_at) || num(company.billing_event_at) || num(company.billing_updated_at);
    if (!start) return { state: "grace", locked: false, until: null, reason: "payment" };
    const until = start + GRACE_DAYS * DAY_MS;
    if (now < until) return { state: "grace", locked: false, until, reason: "payment" };
    return { state: "locked", locked: true, until, reason: "payment" };
  }
  if (status === "canceled") {
    const paidThrough = num(company.billing_paid_through);
    // Never paid at all (e.g. the first invoice expired unpaid): this company never became a paying customer,
    // so billing does not lock it; its trial rules still apply.
    if (!paidThrough && !num(company.billing_last_paid_at)) return { state: "none", locked: false, until: null, reason: "" };
    if (paidThrough && now < paidThrough) return { state: "ending", locked: false, until: paidThrough, reason: "canceled" };
    return { state: "locked", locked: true, until: paidThrough, reason: "canceled" };
  }
  // active, incomplete (first invoice not paid yet), or anything unknown: no lock.
  return { state: "ok", locked: false, until: null, reason: "" };
}

// Owner-facing banner while access is still open but at risk. null when nothing to show.
export function billingBanner(access) {
  if (!access) return null;
  if (access.state === "grace") {
    const by = access.until ? etDate(access.until) : "the end of the week";
    return { state: "grace", title: "Your payment failed.", line: `Your payment failed. Update your card by ${by} to keep access.`,
      detail: `Email ${BILLING_CONTACT_EMAIL} and we'll help you update it. Everything keeps working until then.`, contactEmail: BILLING_CONTACT_EMAIL, until: access.until };
  }
  if (access.state === "ending") {
    const end = etDate(access.until);
    return { state: "ending", title: "Your subscription was canceled.", line: `Your subscription was canceled. You have full access until ${end}.`,
      detail: `To keep using Nudge Dispatch after that, email ${BILLING_CONTACT_EMAIL}. Your rides and clients are kept.`, contactEmail: BILLING_CONTACT_EMAIL, until: access.until };
  }
  return null;
}

// Locked-page text for owners and drivers.
export function lockedView(access, role) {
  if (!access || !access.locked) return null;
  const why = access.reason === "payment"
    ? "The payment for this account didn't go through, and the 7-day grace period has ended."
    : `The subscription for this account ended${access.until ? " on " + etDate(access.until) : ""}.`;
  const how = role === "driver"
    ? `Please ask your company's owner to reactivate it. They can email ${BILLING_CONTACT_EMAIL}.`
    : `To reactivate, email ${BILLING_CONTACT_EMAIL} and we'll get you set up again.`;
  return { title: "This account is paused", why, how, kept: "Your rides, clients and invoices are kept. Nothing has been deleted.", contactEmail: BILLING_CONTACT_EMAIL };
}

export function lockedMessage(access, role) {
  const v = lockedView(access, role);
  return v ? `${v.title}. ${v.why} ${v.how}` : "";
}
