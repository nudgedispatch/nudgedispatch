// Nudge Dispatch free trial (DRAFT, Nov 10, 2026).
// Rule (Jesse, Nov 9, 2026): the trial ends at 15 COMPLETED rides or 30 days from the account start,
// whichever comes first. Pure functions only, so they can be tested without a database.

export const TRIAL_RIDE_LIMIT = 15;
export const TRIAL_DAYS = 30;
export const WARN_RIDES_LEFT = 3;   // warn at 12 of 15 used
export const WARN_DAYS_LEFT = 5;    // warn with 5 days left
export const BETA_SPOTS = 3;
export const TRIAL_STATUSES = ["trial", "active", "ended"];
// Who an operator contacts to keep going. Shown to operators only, never on the public booking page.
export const TRIAL_CONTACT_NAME = "Jesse";
export const TRIAL_CONTACT_EMAIL = "nudgedispatch@gmail.com";

const DAY_MS = 24 * 60 * 60 * 1000;

function int(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function etDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

// company: { trial_status, trial_started_at, created_at, trial_ride_limit, trial_days, trial_ended_at, trial_end_reason }
// completed: number of rides with status 'completed' for the company.
export function trialState(company, completed, now = Date.now()) {
  const status = TRIAL_STATUSES.includes(company && company.trial_status) ? company.trial_status : "trial";
  const startedAt = int(company && (company.trial_started_at ?? company.created_at), now);
  const rideLimit = Math.max(0, int(company && company.trial_ride_limit, TRIAL_RIDE_LIMIT));
  const days = Math.max(0, int(company && company.trial_days, TRIAL_DAYS));
  const endsAt = startedAt + days * DAY_MS;
  const ridesUsed = Math.max(0, int(completed, 0));
  const ridesLeft = Math.max(0, rideLimit - ridesUsed);
  const msLeft = endsAt - now;
  const daysLeft = msLeft <= 0 ? 0 : Math.ceil(msLeft / DAY_MS);
  const base = { plan: status, startedAt, endsAt, rideLimit, days, ridesUsed, ridesLeft, daysLeft };

  if (status === "active") {
    return { ...base, state: "active", open: true, endedAt: null, endedReason: "", newlyEnded: false };
  }
  if (status === "ended") {
    return { ...base, state: "ended", open: false, endedAt: company.trial_ended_at ?? null, endedReason: company.trial_end_reason || "admin", newlyEnded: false };
  }
  // status === "trial": work out whether it has run out.
  let endedReason = "";
  if (ridesUsed >= rideLimit) endedReason = "rides";
  else if (now >= endsAt) endedReason = "days";
  if (endedReason) {
    return { ...base, plan: "ended", state: "ended", open: false, endedAt: now, endedReason, newlyEnded: true };
  }
  const warning = ridesLeft <= WARN_RIDES_LEFT || daysLeft <= WARN_DAYS_LEFT;
  return { ...base, state: warning ? "warning" : "normal", open: true, endedAt: null, endedReason: "", newlyEnded: false };
}

// What the operator sees on the Rides screen. Calm, plain words.
export function trialBanner(t, contactEmail = TRIAL_CONTACT_EMAIL) {
  const contact = TRIAL_CONTACT_NAME + " at " + contactEmail;
  if (t.state === "active") return null;
  const rides = `${t.ridesUsed} of ${t.rideLimit} rides used`;
  const daysText = t.daysLeft <= 1 ? "last day" : plural(t.daysLeft, "day", "days") + " left";
  if (t.state === "ended") {
    const why = t.endedReason === "rides"
      ? `You completed ${plural(t.ridesUsed, "ride", "rides")}, which uses up the free trial.`
      : t.endedReason === "days"
        ? `The 30-day free trial finished on ${etDate(t.endsAt)}.`
        : "The free trial is finished.";
    return {
      state: "ended",
      title: "Your free trial has ended",
      line: why,
      detail: "Your clients, rides, and invoices are all still here, and rides already on the schedule can still be completed. New rides and booking requests are paused for now.",
      contact: `To keep going, contact ${contact}.`,
      contactEmail
    };
  }
  const line = `Free trial: ${rides}, ${daysText}`;
  if (t.state === "warning") {
    return {
      state: "warning",
      title: "Free trial",
      line,
      detail: `Your trial is nearly done. It ends at ${t.rideLimit} completed rides or on ${etDate(t.endsAt)}, whichever comes first.`,
      contact: `To keep taking rides after that, contact ${contact}.`,
      contactEmail
    };
  }
  return {
    state: "normal",
    title: "Free trial",
    line,
    detail: `The trial ends at ${t.rideLimit} completed rides or on ${etDate(t.endsAt)}, whichever comes first.`,
    contact: "",
    contactEmail
  };
}

export function trialBlockedMessage(contactEmail = TRIAL_CONTACT_EMAIL) {
  return `Your free trial has ended, so new rides and booking approvals are paused. Your rides and clients are still here. To keep going, contact ${TRIAL_CONTACT_NAME} at ${contactEmail}.`;
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
  if (status && !TRIAL_STATUSES.includes(status)) return { error: "status must be trial, active, or ended." };
  if (!addRides && !addDays && !status) return { error: "Send addRides, addDays, or status." };
  next.trial_ride_limit += addRides;
  next.trial_days += addDays;
  if (status === "active") {
    next.trial_status = "active";
    next.trial_ended_at = null;
    next.trial_end_reason = "";
  } else if (status === "ended") {
    next.trial_status = "ended";
    next.trial_ended_at = now;
    next.trial_end_reason = "admin";
  } else if (status === "trial" || addRides || addDays) {
    // "Move back to free trial" (status trial) always returns to the trial. Extending a trial or an
    // ended trial reopens it; extending a paying customer only changes the stored limits.
    // Either way it ends again on its own if it is still over the limits.
    if (status === "trial" || next.trial_status !== "active") {
      next.trial_status = "trial";
      next.trial_ended_at = null;
      next.trial_end_reason = "";
    }
  }
  return { next };
}

export function trialJson(t) {
  return {
    plan: t.plan,
    state: t.state,
    open: t.open,
    ridesUsed: t.ridesUsed,
    rideLimit: t.rideLimit,
    ridesLeft: t.ridesLeft,
    days: t.days,
    daysLeft: t.daysLeft,
    startedAt: t.startedAt,
    endsAt: t.endsAt,
    endsOn: etDate(t.endsAt),
    endedAt: t.endedAt,
    endedReason: t.endedReason
  };
}
