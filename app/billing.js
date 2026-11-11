// Nudge Dispatch plan billing + SMS texting add-on (DRAFT, Nov 10, 2026). Stripe TEST MODE ONLY.
// Pure helpers plus a tiny Stripe REST client. The client refuses any key that is not a test key,
// so this build can never touch live mode. Texting itself (sending SMS) is NOT built.

export const BILLING_PLANS = ["solo", "small", "fleet"];
export const PLAN_LABELS = { solo: "Solo", small: "Small fleet", fleet: "Fleet" };
export const SMS_PLANS = ["small", "fleet"]; // website: texting add-on is for Small fleet and Fleet only

// Stripe lookup keys (same keys can be recreated in live mode later; IDs differ per mode).
export const LOOKUP = {
  solo: { base: "nudge_solo_monthly", extra: null, setup: "nudge_setup_solo" },
  small: { base: "nudge_small_base_monthly", extra: "nudge_small_extra_driver_monthly", setup: "nudge_setup_small" },
  fleet: { base: "nudge_fleet_base_monthly", extra: "nudge_fleet_extra_driver_monthly", setup: "nudge_setup_fleet" },
  sms: { monthly: "nudge_sms_monthly", overage: "nudge_sms_overage_metered", setup: "nudge_sms_setup" }
};
export const BETA_PROMO_CODE = "BETA50";
export const SMS_METER_EVENT = "nudge_sms_text";
export const SMS_INCLUDED_TEXTS = 500;
export const SMS_OVERAGE_CENTS = 3;
export const SMS_MONTHLY_CENTS = 1900;
export const SMS_SETUP_CENTS = 7500;
export const SMS_PRICE_TEXT = "$75 one-time + $19/mo with 500 texts, then $0.03 per extra text, added to the plan's bill";
export const SMS_COMING_SOON = "Texting is still being set up and is not sending yet. When it is ready, you can send an \"On my way\" text to a client from the ride screen.";

export function normPlan(plan) {
  const p = String(plan || "").toLowerCase().trim();
  if (p === "individual") return "solo";
  if (p === "small fleet" || p === "small_fleet" || p === "smallfleet") return "small";
  return BILLING_PLANS.includes(p) ? p : "";
}

// companies.kind is only individual|fleet; billing_plan refines it.
export function planOf(company) {
  const p = normPlan(company && company.billing_plan);
  if (p) return p;
  return company && company.kind === "fleet" ? "small" : "solo";
}

export function kindForPlan(plan) {
  return plan === "solo" ? "individual" : "fleet";
}

export function smsAllowed(plan) {
  return SMS_PLANS.includes(plan);
}

export function smsOn(company) {
  return Number(company && company.sms_addon_enabled) === 1;
}

// Per-driver fee applies to drivers after the first. driverCount = driver accounts on the company.
export function extraDrivers(plan, driverCount) {
  if (plan === "solo") return 0;
  const n = Math.max(0, Math.trunc(Number(driverCount) || 0));
  const cap = plan === "small" ? 4 : 14; // Small fleet 2-5 drivers, Fleet 6-15
  return Math.min(cap, Math.max(0, n - 1));
}

// Monthly estimate in cents (no tax, no overage).
export function monthlyCents(plan, driverCount, sms) {
  const base = { solo: 3900, small: 5900, fleet: 9900 }[plan] || 0;
  const per = { solo: 0, small: 1000, fleet: 800 }[plan] || 0;
  return base + per * extraDrivers(plan, driverCount) + (sms && smsAllowed(plan) ? SMS_MONTHLY_CENTS : 0);
}

export function dollars(cents) {
  return "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);
}

// Texting can only be turned on once the company is a paying Stripe customer (Jesse, Nov 10, 2026):
// billing status active, or a non-canceled subscription still inside its paid-through date.
export const SMS_NOT_PAYING_NOTE = "Texting can be added once the customer is paying.";
export function payingNow(company, now = Date.now()) {
  if (!company || !company.stripe_subscription_id) return false;
  const st = company.billing_status || "";
  if (st === "active") return true;
  if (st === "canceled" || st === "incomplete") return false;
  return !!(company.billing_paid_through && now < Number(company.billing_paid_through));
}
export function smsEnableProblem(company, now = Date.now()) {
  if (!smsAllowed(planOf(company))) return "Texting is for Small fleet and Fleet plans.";
  if (!payingNow(company, now)) return SMS_NOT_PAYING_NOTE;
  return "";
}
export function billingJson(company, driverCount) {
  const plan = planOf(company);
  const smsProblem = smsEnableProblem(company);
  return {
    smsCanEnable: !smsProblem,
    smsEnableNote: smsProblem,
    plan,
    planLabel: PLAN_LABELS[plan],
    smsAddon: smsOn(company),
    smsAllowed: smsAllowed(plan),
    smsPriceText: SMS_PRICE_TEXT,
    smsNote: SMS_COMING_SOON,
    subscribed: !!(company && company.stripe_subscription_id),
    subscriptionId: (company && company.stripe_subscription_id) || "",
    customerId: (company && company.stripe_customer_id) || "",
    monthlyEstimate: dollars(monthlyCents(plan, driverCount, smsOn(company))),
    billingStatus: (company && company.billing_status) || "",
    paidThrough: (company && company.billing_paid_through) || null,
    lastPaidAt: (company && company.billing_last_paid_at) || null,
    extraDrivers: extraDrivers(plan, driverCount)
  };
}

// ---- Stripe REST client (test mode only) ----
export function stripeKeyProblem(env) {
  const key = (env && env.STRIPE_SECRET_KEY) || "";
  if (!key) return "Stripe is not connected yet: the preview has no Stripe test key (STRIPE_SECRET_KEY). Texting was saved on the account only.";
  if (!/^(sk|rk)_test_/.test(key)) return "Refusing to use a Stripe key that is not a test-mode key.";
  return "";
}

function apiBase(env) {
  // Local tests may point at a mock on 127.0.0.1 only. Anything else is api.stripe.com.
  const b = (env && env.STRIPE_API_BASE) || "";
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(b) ? b : "https://api.stripe.com";
}

// Flatten nested params into Stripe's form encoding: a[b][0][c]=v
export function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (item !== null && typeof item === "object") formEncode(item, `${key}[${i}]`, out);
      else out.push(encodeURIComponent(`${key}[${i}]`) + "=" + encodeURIComponent(String(item)));
    });
    else if (typeof v === "object") formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}

export class StripeError extends Error {
  constructor(status, message) { super(message); this.name = "StripeError"; this.status = status; }
}

export async function stripe(env, method, path, params, idempotencyKey) {
  const problem = stripeKeyProblem(env);
  if (problem) throw new StripeError(503, problem);
  const headers = {
    authorization: "Bearer " + env.STRIPE_SECRET_KEY,
    "stripe-version": "2026-10-28.endive" // account default on Nov 10, 2026; pinned so upgrades don't change behavior
  };
  let url = apiBase(env) + path;
  let body;
  if (params && (method === "GET" || method === "DELETE")) {
    const qs = formEncode(params);
    if (qs) url += "?" + qs;
  } else if (params) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = formEncode(params);
  }
  if (idempotencyKey && method === "POST") headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(res.status, (data.error && data.error.message) || "Stripe request failed.");
  if (data && data.livemode === true) throw new StripeError(500, "Stripe returned a live-mode object; stopping.");
  return data;
}

export async function pricesByLookup(env, keys) {
  const wanted = keys.filter(Boolean);
  const res = await stripe(env, "GET", "/v1/prices", { "lookup_keys": wanted, active: true, limit: 100 });
  const map = {};
  for (const p of res.data || []) map[p.lookup_key] = p.id;
  return map;
}

// Subscription items for a new subscription. Returns { items, addInvoiceItems, missing }.
export function subscriptionPlanItems(plan, driverCount, sms, prices, beta, promoId) {
  const L = LOOKUP[plan];
  const items = [{ price: prices[L.base], quantity: 1 }];
  const extras = extraDrivers(plan, driverCount);
  if (L.extra && extras > 0) items.push({ price: prices[L.extra], quantity: extras });
  const setup = { price: prices[L.setup], quantity: 1 };
  if (beta && promoId) setup.discounts = [{ promotion_code: promoId }];
  const addInvoiceItems = [setup];
  const withSms = sms && smsAllowed(plan);
  if (withSms) {
    items.push({ price: prices[LOOKUP.sms.monthly], quantity: 1 });
    items.push({ price: prices[LOOKUP.sms.overage] }); // metered: no quantity
    addInvoiceItems.push({ price: prices[LOOKUP.sms.setup], quantity: 1 });
  }
  const need = [L.base, L.setup, extras > 0 ? L.extra : null, withSms ? LOOKUP.sms.monthly : null, withSms ? LOOKUP.sms.overage : null, withSms ? LOOKUP.sms.setup : null].filter(Boolean);
  const missing = need.filter((k) => !prices[k]);
  return { items, addInvoiceItems, missing };
}

// Report one sent text to the Stripe test meter (counted against the 500 included, then $0.03 each).
export async function reportSmsUsage(env, customerId, identifier, value = 1) {
  return stripe(env, "POST", "/v1/billing/meter_events", {
    event_name: SMS_METER_EVENT,
    identifier,
    timestamp: Math.floor(Date.now() / 1000),
    payload: { stripe_customer_id: customerId, value: String(value) }
  }, "meter-" + identifier);
}

export function smsLookupKeys() {
  return [LOOKUP.sms.monthly, LOOKUP.sms.overage, LOOKUP.sms.setup];
}
