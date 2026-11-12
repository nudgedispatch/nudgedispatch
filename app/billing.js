// Nudge Dispatch plan billing + SMS texting add-on.
// Pure helpers plus a tiny Stripe REST client. The mode comes from STRIPE_SECRET_KEY
// (sk_/rk_ test versus live). A live key is used only when STRIPE_MODE is live, so swapping
// the secret alone cannot start live charges. Test keys keep working with STRIPE_MODE unset.

export const BILLING_PLANS = ["solo", "small", "fleet"];
export const PLAN_LABELS = { solo: "Solo", small: "Small fleet", fleet: "Fleet" };
export const SMS_PLANS = ["small", "fleet"]; // website: texting add-on is for Small fleet and Fleet only

// Stripe lookup keys. The same keys exist in test and live; price IDs differ per mode.
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
    livemode: Number(company && company.stripe_livemode) === 1,
    monthlyEstimate: dollars(monthlyCents(plan, driverCount, smsOn(company))),
    billingStatus: (company && company.billing_status) || "",
    paidThrough: (company && company.billing_paid_through) || null,
    lastPaidAt: (company && company.billing_last_paid_at) || null,
    extraDrivers: extraDrivers(plan, driverCount)
  };
}

// ---- Stripe REST client (test or live, from the key) ----
const STRIPE_KEY_PREFIXES = ["sk_test_", "rk_test_", "sk_live_", "rk_live_"];
const NOT_CONNECTED = "Stripe is not connected yet: the preview has no Stripe test key (STRIPE_SECRET_KEY). Texting was saved on the account only.";

// Prefix only: sk_test_, rk_test_, sk_live_, rk_live_, empty, or other. Never the key itself.
export function stripeKeyClass(key) {
  const value = typeof key === "string" ? key : "";
  if (!value) return "empty";
  return STRIPE_KEY_PREFIXES.find((prefix) => value.startsWith(prefix)) || "other";
}

// "test", "live", or "" when the key is missing or not an sk_/rk_ key.
export function stripeKeyMode(env) {
  const cls = stripeKeyClass(env && env.STRIPE_SECRET_KEY);
  if (cls === "sk_test_" || cls === "rk_test_") return "test";
  if (cls === "sk_live_" || cls === "rk_live_") return "live";
  return "";
}

// "" when unset (test keys allowed, live keys refused), "test", "live", or "invalid".
export function stripeModeOptIn(env) {
  const raw = env && typeof env.STRIPE_MODE === "string" ? env.STRIPE_MODE.trim() : "";
  if (!raw) return "";
  if (raw === "test" || raw === "live") return raw;
  return "invalid";
}

export function stripeKeyProblem(env) {
  const key = (env && env.STRIPE_SECRET_KEY) || "";
  if (!key) return NOT_CONNECTED;
  const mode = stripeKeyMode(env);
  if (!mode) return "Refusing to use a Stripe key that is not an sk_ or rk_ test or live key.";
  const opt = stripeModeOptIn(env);
  if (opt === "invalid") return "STRIPE_MODE must be test or live.";
  // Live is opt-in. A live key with STRIPE_MODE unset or set to test never calls Stripe.
  if (mode === "live" && opt !== "live") return "Refusing to use a live Stripe key until STRIPE_MODE is live.";
  if (opt && opt !== mode) return "STRIPE_MODE is " + opt + " but the Stripe key is " + mode + ".";
  return "";
}

// What /api/platform/billing reports. testMode stays true unless a live key is actually enabled.
export function billingConnection(env) {
  const problem = stripeKeyProblem(env);
  const active = problem ? "" : stripeKeyMode(env);
  return {
    stripeConnected: !problem,
    testMode: active !== "live",
    mode: active === "live" ? "live" : active === "test" ? "test" : "off",
    problem
  };
}

// Webhooks: no key and no live opt-in keeps today's test-mode handling.
// A live opt-in, a live key, or a bad key fails closed until the key and STRIPE_MODE agree.
export function stripeWebhookMode(env) {
  const opt = stripeModeOptIn(env);
  const key = typeof (env && env.STRIPE_SECRET_KEY) === "string" ? env.STRIPE_SECRET_KEY : "";
  if (!key && (opt === "" || opt === "test")) return { mode: "test", problem: "" };
  const problem = stripeKeyProblem(env);
  if (problem) return { mode: "", problem };
  return { mode: stripeKeyMode(env) || "test", problem: "" };
}

// "" when every livemode flag matches the key, otherwise the error to throw.
// Objects that omit livemode (list wrappers, deleted ids) are allowed.
export function livemodeConflict(mode, data) {
  const expectLive = mode === "live";
  let conflict = false;
  const visit = (value) => {
    if (typeof value === "boolean" && value !== expectLive) conflict = true;
  };
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    visit(obj.livemode);
  };
  walk(data);
  if (data && Array.isArray(data.data)) for (const item of data.data) walk(item);
  if (data && data.latest_invoice && typeof data.latest_invoice === "object") walk(data.latest_invoice);
  const items = data && data.items && data.items.data;
  if (Array.isArray(items)) for (const item of items) walk(item);
  if (!conflict) return "";
  return expectLive
    ? "Stripe returned a test-mode object; stopping."
    : "Stripe returned a live-mode object; stopping.";
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
  const conflict = livemodeConflict(stripeKeyMode(env), data);
  if (conflict) throw new StripeError(500, conflict);
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

// Report one sent text to the Stripe meter (counted against the 500 included, then $0.03 each).
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
