// Nudge Dispatch free trial.
// Rules:
//  - Nov 9, 2026 (Jesse): the trial ends at 15 COMPLETED rides.
//  - Nov 17, 2026 (Jesse): no time expiry. The 15-ride cap is the only limit (TRIAL_TIME_LIMIT_DAYS = 0).
//  - Nov 17, 2026 (Jesse): self-serve Solo signups get a 15-ride free trial with a card on file
//    (trial_billing = 'auto'). The card is not charged during the trial. When the 15th ride is completed
//    the trial converts to the paid Solo plan ($39/month) automatically: no opt-in, no prompt, no choice
//    screen, and booking is never blocked by the conversion. The owner sees an informational notice only.
//  - Cancel stays available but not prominent: a small link in More > Your plan, with an exit survey.
//    Cancelling before the 15th ride means no charge, ever.
// A "ride" is a ride with status 'completed' for the company. Requests, drafts, declined and cancelled
// rides never count. Pure functions only, so they can be tested without a database.

export const TRIAL_RIDE_LIMIT = 15;
// Time expiry: 0 = none (Jesse, Nov 17, 2026). Set a number of days here to bring a time limit back.
export const TRIAL_TIME_LIMIT_DAYS = 0;
export const TRIAL_DAYS = TRIAL_TIME_LIMIT_DAYS; // legacy name, kept for the admin API
export const WARN_AT_RIDES = 12;                // heads-up at 12 of 15 used
export const WARN_RIDES_LEFT = TRIAL_RIDE_LIMIT - WARN_AT_RIDES;
export const WARN_DAYS_LEFT = 5;                 // only used if a time limit is configured
export const TRIAL_STATUSES = ["trial", "active", "ended"];
// Statuses a platform admin may set. "active" (paying) is set only from Stripe.
export const ADMIN_TRIAL_STATUSES = ["trial", "ended"];
export const PAYING_FROM_STRIPE = "Paying status comes from Stripe (trial conversion or a paid subscription) and can't be set by hand.";
// Self-serve auto-converting trial.
export const AUTO_TRIAL = "auto";
export const TRIAL_PRICE_TEXT = "$39/month";
// Mid-trial cancel (decided by Jesse, Nov 17, 2026 8:01 PM ET; hardcoded, no setting): the account closes right
// after the exit survey, the Stripe subscription is canceled immediately with no invoice and no charge, leftover
// free rides are forfeited, and booking access ends at once. Data is kept read-only (export from More).
export const TRIAL_CANCEL_MODE = "end_now";
// Stripe trials are time-based, so the subscription's trial_end is set to Stripe's maximum (730 days)
// and is ended programmatically at the 15th completed ride. A trial_will_end webhook pushes it out again.
export const TRIAL_STRIPE_HORIZON_DAYS = 730;
// Exit survey reasons (cancel screen).
export const CANCEL_REASONS = [
  ["too_expensive", "Too expensive"],
  ["too_hard", "Too hard to use"],
  ["doesnt_meet_needs", "Doesn't meet my needs"],
  ["switching_tools", "Switching to another tool"],
  ["not_driving", "Not driving anymore"],
  ["other", "Other"]
];
export const CANCEL_REASON_KEYS = CANCEL_REASONS.map(([k]) => k);
export const CANCEL_DETAILS_MAX = 1000;
// Who an operator contacts. Shown to operators only, never on the public booking page.
export const TRIAL_CONTACT_NAME = "Jesse";
export const TRIAL_CONTACT_EMAIL = "nudgedispatch@gmail.com";

const DAY_MS = 24 * 60 * 60 * 1000;

function int(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

export function etDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

export function isAutoTrial(company) {
  return !!company && company.trial_billing === AUTO_TRIAL;
}

// company: { trial_status, trial_started_at, created_at, trial_ride_limit, trial_days, trial_ended_at, trial_end_reason,
//            trial_billing, trial_converted_at, trial_canceled_at, trial_notice_dismissed_at }
// completed: number of rides with status 'completed' for the company.
// timeLimitDays: 0 = no time expiry (default).
export function trialState(company, completed, now = Date.now(), timeLimitDays = TRIAL_TIME_LIMIT_DAYS) {
  const status = TRIAL_STATUSES.includes(company && company.trial_status) ? company.trial_status : "trial";
  const startedAt = int(company && (company.trial_started_at ?? company.created_at), now);
  const rideLimit = Math.max(0, int(company && company.trial_ride_limit, TRIAL_RIDE_LIMIT));
  const timed = timeLimitDays > 0;
  const days = timed ? Math.max(0, int(company && company.trial_days, timeLimitDays) || timeLimitDays) : 0;
  const endsAt = timed ? startedAt + days * DAY_MS : null;
  const ridesUsed = Math.max(0, int(completed, 0));
  const ridesLeft = Math.max(0, rideLimit - ridesUsed);
  const daysLeft = timed ? (endsAt - now <= 0 ? 0 : Math.ceil((endsAt - now) / DAY_MS)) : null;
  const auto = isAutoTrial(company);
  const convertedAt = num(company && company.trial_converted_at);
  const canceledAt = num(company && company.trial_canceled_at);
  const base = {
    plan: status, startedAt, endsAt, rideLimit, days, ridesUsed, ridesLeft, daysLeft, timeLimited: timed,
    auto, convertedAt, canceledAt, needsConversion: false,
    noticeDismissed: !!num(company && company.trial_notice_dismissed_at)
  };

  if (status === "active") {
    // Paying. A self-serve trial that just converted shows one informational notice until dismissed.
    const state = auto && convertedAt && !base.noticeDismissed ? "converted" : "active";
    return { ...base, state, open: true, endedAt: null, endedReason: "", newlyEnded: false };
  }
  if (status === "ended") {
    return { ...base, state: "ended", open: false, endedAt: company.trial_ended_at ?? null, endedReason: company.trial_end_reason || "admin", newlyEnded: false };
  }
  // status === "trial"
  if (auto && convertedAt) {
    return { ...base, plan: "active", state: base.noticeDismissed ? "active" : "converted", open: true, endedAt: null, endedReason: "", newlyEnded: false };
  }
  if (auto && !canceledAt) {
    if (ridesUsed >= rideLimit) {
      // Converts to paid Solo automatically. Never blocks booking, never asks.
      return { ...base, state: "converting", open: true, endedAt: null, endedReason: "", newlyEnded: false, needsConversion: true };
    }
    const warning = ridesUsed >= Math.max(0, rideLimit - WARN_RIDES_LEFT);
    return { ...base, state: warning ? "warning" : "normal", open: true, endedAt: null, endedReason: "", newlyEnded: false };
  }
  if (auto && canceledAt) {
    // Canceled during the trial: closed at once, leftover free rides forfeited, never charged.
    return { ...base, plan: "ended", state: "ended", open: false, endedAt: now, endedReason: "canceled", newlyEnded: true };
  }
  // Manual (team-invited) trials: end at the ride limit.
  let endedReason = "";
  if (ridesUsed >= rideLimit) endedReason = "rides";
  else if (timed && now >= endsAt) endedReason = "days";
  if (endedReason) {
    return { ...base, plan: "ended", state: "ended", open: false, endedAt: now, endedReason, newlyEnded: true };
  }
  const warning = ridesUsed >= Math.max(0, rideLimit - WARN_RIDES_LEFT) || (timed && daysLeft <= WARN_DAYS_LEFT);
  return { ...base, state: warning ? "warning" : "normal", open: true, endedAt: null, endedReason: "", newlyEnded: false };
}

// Owner-facing copy on Rides. Calm, plain words. No buttons except "Dismiss" on the converted notice.
export function trialBanner(t, contactEmail = TRIAL_CONTACT_EMAIL) {
  const contact = TRIAL_CONTACT_NAME + " at " + contactEmail;
  if (t.state === "active") return null;
  const rides = `${t.ridesUsed} of ${t.rideLimit} free rides used`;
  if (t.state === "converted") {
    return {
      state: "converted",
      title: "Your Solo plan has started",
      line: `You've used your ${t.rideLimit} free rides, so your Solo plan started: ${TRIAL_PRICE_TEXT}, charged to the card you added.`,
      detail: "Nothing changes in how you work. Your receipt comes from Stripe.",
      contact: "",
      contactEmail,
      dismissible: true
    };
  }
  if (t.state === "converting") {
    return {
      state: "converting",
      title: "Free trial complete",
      line: `You've used your ${t.rideLimit} free rides. Your Solo plan (${TRIAL_PRICE_TEXT}) is starting on the card you added.`,
      detail: "Keep booking as usual.",
      contact: "",
      contactEmail
    };
  }
  if (t.state === "ended") {
    const why = t.endedReason === "canceled"
      ? (t.auto ? "You canceled your free trial. You were not charged." : "The free trial was canceled.")
      : t.endedReason === "rides"
        ? `You completed ${plural(t.ridesUsed, "ride", "rides")}, which uses up the free trial.`
        : t.endedReason === "days"
          ? `The free trial finished${t.endsAt ? " on " + etDate(t.endsAt) : ""}.`
          : "The free trial is finished.";
    return {
      state: "ended",
      title: t.endedReason === "canceled" ? "Your free trial was canceled" : "Your free trial has ended",
      line: why,
      detail: "Your clients, rides, and invoices are all still here, and rides already on the schedule can still be completed. New rides and booking requests are paused for now.",
      contact: `To start again, contact ${contact}.`,
      contactEmail
    };
  }
  const daysText = t.timeLimited ? (t.daysLeft <= 1 ? ", last day" : ", " + plural(t.daysLeft, "day", "days") + " left") : "";
  const line = `Free trial: ${rides}${daysText}`;
  if (t.auto) {
    const after = `After your ${ordinal(t.rideLimit)} completed ride, Solo is ${TRIAL_PRICE_TEXT}, charged automatically to the card you added. No setup fee.`;
    if (t.state === "warning") {
      return {
        state: "warning",
        title: "Free trial",
        line,
        detail: `Heads-up: ${plural(t.ridesLeft, "free ride", "free rides")} left. ${after} You don't need to do anything.`,
        cancelNote: "You can cancel in Account settings.",
        contact: "",
        contactEmail
      };
    }
    return { state: "normal", title: "Free trial", line, detail: `Your first ${t.rideLimit} completed rides are free. ${after}`, contact: "", contactEmail };
  }
  const endText = t.timeLimited
    ? `It ends at ${t.rideLimit} completed rides or on ${etDate(t.endsAt)}, whichever comes first.`
    : `It ends at ${t.rideLimit} completed rides.`;
  if (t.state === "warning") {
    return {
      state: "warning",
      title: "Free trial",
      line,
      detail: `Your trial is nearly done. ${endText}`,
      contact: `To keep taking rides after that, contact ${contact}.`,
      contactEmail
    };
  }
  return { state: "normal", title: "Free trial", line, detail: `The trial ${endText.replace(/^It /, "")}`, contact: "", contactEmail };
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function trialBlockedMessage(contactEmail = TRIAL_CONTACT_EMAIL) {
  return `Your free trial has ended, so new rides and booking approvals are paused. Your rides and clients are still here. To keep going, contact ${TRIAL_CONTACT_NAME} at ${contactEmail}.`;
}

// Can the owner cancel this trial from More? Only a self-serve trial that hasn't converted or been canceled.
export function canCancelTrial(company) {
  return isAutoTrial(company) && company.trial_status === "trial" && !num(company.trial_converted_at) && !num(company.trial_canceled_at) && !!company.stripe_subscription_id;
}

// Paid Solo (converted from the self-serve trial) can cancel from Profile & account too. No further charges.
export function canCancelPaid(company) {
  return isAutoTrial(company) && !!num(company.trial_converted_at) && !!company.stripe_subscription_id && company.billing_status !== "canceled";
}
export function canCancelAccount(company) {
  return canCancelTrial(company) || canCancelPaid(company);
}

// Column values to store when the owner cancels during the trial (always closes at once).
export function trialCancelColumns(now) {
  return { trial_canceled_at: now, trial_status: "ended", trial_ended_at: now, trial_end_reason: "canceled" };
}

// Exit survey. skip = true or no reasons -> reasons null. Returns { reasons, details } or { error }.
export function cancelFeedback(body) {
  const skip = !!(body && body.skip === true);
  if (skip) return { reasons: null, details: null, skipped: true };
  const raw = body && Array.isArray(body.reasons) ? body.reasons : [];
  if (raw.length > CANCEL_REASON_KEYS.length) return { error: "Choose up to " + CANCEL_REASON_KEYS.length + " reasons." };
  const reasons = [];
  for (const r of raw) {
    const k = String(r || "");
    if (!CANCEL_REASON_KEYS.includes(k)) return { error: "Unknown reason." };
    if (!reasons.includes(k)) reasons.push(k);
  }
  const text = typeof (body && body.details) === "string" ? body.details.trim().slice(0, CANCEL_DETAILS_MAX) : "";
  return { reasons: reasons.length ? reasons : null, details: text || null, skipped: false };
}

// Stripe trial_end for a new self-serve subscription (seconds).
export function stripeTrialEnd(nowMs = Date.now(), horizonDays = TRIAL_STRIPE_HORIZON_DAYS) {
  // One hour short of the maximum so clock skew never trips Stripe's limit.
  return Math.floor(nowMs / 1000) + horizonDays * 86400 - 3600;
}

// Admin changes. Returns the new column values or { error }.
export function applyTrialChange(company, body, now = Date.now()) {
  const next = {
    trial_status: TRIAL_STATUSES.includes(company.trial_status) ? company.trial_status : "trial",
    trial_ride_limit: int(company.trial_ride_limit, TRIAL_RIDE_LIMIT),
    trial_days: int(company.trial_days, TRIAL_DAYS),
    trial_started_at: int(company.trial_started_at ?? company.created_at, now),
    trial_ended_at: company.trial_ended_at ?? null,
    trial_end_reason: company.trial_end_reason || ""
  };
  const addRides = body.addRides === undefined || body.addRides === null || body.addRides === "" ? 0 : Number(body.addRides);
  const addDays = body.addDays === undefined || body.addDays === null || body.addDays === "" ? 0 : Number(body.addDays);
  if (!Number.isInteger(addRides) || addRides < 0 || addRides > 1000) return { error: "addRides must be a whole number from 0 to 1000." };
  if (!Number.isInteger(addDays) || addDays < 0 || addDays > 3650) return { error: "addDays must be a whole number from 0 to 3650." };
  const status = body.status === undefined ? "" : String(body.status);
  // No manual "paying" (Jesse, Nov 17, 2026): paying status comes only from Stripe (trial conversion or subscription webhooks).
  // trial_status = 'active' is still read everywhere; admins just can't set it by hand.
  if (status === "active") return { error: PAYING_FROM_STRIPE };
  if (status && !ADMIN_TRIAL_STATUSES.includes(status)) return { error: "status must be trial or ended." };
  if (!addRides && !addDays && !status) return { error: "Send addRides, addDays, or status." };
  next.trial_ride_limit += addRides;
  next.trial_days += addDays;
  if (status === "ended") {
    next.trial_status = "ended";
    next.trial_ended_at = now;
    next.trial_end_reason = "admin";
  } else if (status === "trial" || addRides || addDays) {
    if (status === "trial" || next.trial_status !== "active") {
      next.trial_status = "trial";
      next.trial_ended_at = null;
      next.trial_end_reason = "";
    }
  }
  return { next };
}

export function trialJson(t, company) {
  return {
    plan: t.plan,
    state: t.state,
    open: t.open,
    ridesUsed: t.ridesUsed,
    rideLimit: t.rideLimit,
    ridesLeft: t.ridesLeft,
    timeLimited: t.timeLimited,
    days: t.days,
    daysLeft: t.daysLeft,
    startedAt: t.startedAt,
    endsAt: t.endsAt,
    endsOn: t.endsAt ? etDate(t.endsAt) : "",
    endedAt: t.endedAt,
    endedReason: t.endedReason,
    auto: t.auto,
    convertedAt: t.convertedAt,
    canceledAt: t.canceledAt,
    canCancel: company ? canCancelTrial(company) : false,
    canCancelAccount: company ? canCancelAccount(company) : false,
    cancelKind: company ? (canCancelTrial(company) ? "trial" : canCancelPaid(company) ? "paid" : "") : "",
    cancelMode: TRIAL_CANCEL_MODE,
    priceText: TRIAL_PRICE_TEXT
  };
}

// "Move back to free trial" (platform admin, Jesse, Nov 18, 2026).
//  - Never paid (no trial conversion, no paid invoice): a fresh trial with TRIAL_RIDE_LIMIT completed rides left
//    from today (limit = rides already completed + 15). A self-serve trial keeps auto-conversion only while its
//    Stripe subscription is still usable (not canceled); otherwise it becomes a plain trial that never charges.
//  - Paid before: status goes back to trial with the current ride limit (if that is used up it shows as ended;
//    add rides). Auto-conversion is turned off so it can never charge again on its own.
//  - A live Stripe subscription (active, past_due, incomplete, or a trialing one from a paid account) is never
//    touched from here: the change is refused until it is canceled in Stripe.
//  - A canceled Stripe subscription is detached (stripe_subscription_id cleared, customer kept) so the old
//    cancellation no longer locks the account.
export const LIVE_SUB_STATUSES = ["active", "past_due", "incomplete", "trialing", "unpaid"];
export function moveBackToTrial(company, completed, now = Date.now()) {
  if (!company) return { error: "No company." };
  const sub = company.stripe_subscription_id || null;
  const billing = company.billing_status || "";
  const paidBefore = !!(num(company.trial_converted_at) || num(company.billing_last_paid_at) || num(company.billing_paid_through));
  const autoUnconverted = isAutoTrial(company) && !num(company.trial_converted_at) && !num(company.trial_canceled_at);
  const subCanceled = billing === "canceled";
  if (sub && !subCanceled && LIVE_SUB_STATUSES.includes(billing) && (paidBefore || !autoUnconverted)) {
    return { error: `This account has a live Stripe subscription (${billing}). Cancel it in Stripe first, then move it back to the free trial. Nothing was changed.` };
  }
  const used = Math.max(0, int(completed, 0));
  const keepAuto = autoUnconverted && !!sub && !subCanceled && !paidBefore;
  const next = {
    trial_status: "trial",
    trial_ended_at: null,
    trial_end_reason: "",
    trial_started_at: paidBefore ? int(company.trial_started_at ?? company.created_at, now) : now,
    trial_ride_limit: paidBefore ? Math.max(0, int(company.trial_ride_limit, TRIAL_RIDE_LIMIT)) : used + TRIAL_RIDE_LIMIT,
    trial_days: int(company.trial_days, TRIAL_DAYS),
    trial_billing: keepAuto ? AUTO_TRIAL : "",
    trial_converted_at: null,
    trial_convert_claimed_at: null,
    trial_convert_error: "",
    trial_canceled_at: null,
    trial_notice_dismissed_at: null,
    stripe_subscription_id: subCanceled ? null : sub
  };
  return { next, fresh: !paidBefore, detachedSubscription: subCanceled && !!sub };
}
