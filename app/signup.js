// Self-serve signup helpers (pure + Turnstile + Checkout params).
// Public plan is Solo only, as a 15-ride free trial (Jesse, Nov 17, 2026): Stripe Checkout in SETUP mode saves
// a card without charging it; the Worker then starts a Solo subscription in a trial that ends at the 15th
// completed ride. No setup fee on self-serve (no setup line, no typable promo codes).
// Texting stays gated to Small fleet and up — Solo signup has no texting checkbox.

import { LOOKUP, SMS_PRICE_TEXT, SMS_PLANS, PLAN_LABELS, cardOnlyPaymentConfig, dollars, smsAllowed } from "./billing.js";
import { normalizeSlug, slugBase, slugProblem } from "./slug.js";
import { THEME_PRESETS, themeProblem } from "./theme.js";
import { TRIAL_RIDE_LIMIT, stripeTrialEnd } from "./trial.js";

export const PUBLIC_BILLING_PLAN = "solo";
export const SIGNUP_TERMS_URL = "https://nudgedispatch.com/terms.html";
export const SIGNUP_PRIVACY_URL = "https://nudgedispatch.com/privacy.html";
export const SIGNUP_TERMS_VERSION = "nudgedispatch.com/terms.html#2026-11-17";
export const TERMS_CONSENT_ERROR = "Please agree to the Terms of Service and Privacy Policy.";
export const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
export const SOLO_MONTHLY_CENTS = 3900;
export const SOLO_SETUP_CENTS = 29900; // advertised price; waived for self-serve
export const SIGNUP_RATE_WINDOW_MS = 15 * 60 * 1000;
export const SIGNUP_POST_MAX = 8;
export const SIGNUP_SLUG_MAX = 60;
export const SIGNUP_BOOKING_HOST = "app.nudgedispatch.com";

// Trial wording (Nov 17, 2026). The small print sits next to the card step on our page and on Stripe's card page.
export const TRIAL_HEADLINE = TRIAL_RIDE_LIMIT + " rides free";
export const TRIAL_PLAN_LINE = "15 rides free. Card required, not charged until after your 15th ride. Then $39/month. No setup fee. Cancel before then and you're never charged.";
export const TRIAL_SMALL_PRINT = "Free for your first 15 rides. Then $39/month, charged automatically to this card. Cancel anytime in Account settings.";

// Solo setup choice (Jesse, Nov 17, 2026): self setup on this page is the default and waives the setup fee.
// Assisted setup (we set it up for you) carries the one-time setup fee and is arranged by email, so the
// self-serve Checkout never adds a setup line.
export const CONCIERGE_EMAIL = "nudgedispatch@gmail.com";
export const ASSISTED_SETUP_SUBJECT = "Nudge Dispatch Solo assisted setup";
export function assistedSetupMailto() {
  return "mailto:" + CONCIERGE_EMAIL + "?subject=" + encodeURIComponent(ASSISTED_SETUP_SUBJECT);
}

export function bookingPreviewUrl(slug) {
  const code = normalizeSlug(slug);
  return code ? "https://" + SIGNUP_BOOKING_HOST + "/book/" + code + "/" : "";
}

export const SLUG_PERMANENT_NOTE = "Once you choose this company code, it is reserved for you and can't be changed later. It becomes your booking link, your booking QR code, and the company code drivers use to sign in.";

// Shown on the Solo signup plan card and anywhere texting is described as an upgrade.
export const TEXTING_UPGRADE_NOTE = "Need automatic texting? Available on Small fleet and up. Automatic ride and driver texts are sent from your company's Nudge number: $75 setup + $19/mo, with 500 texts included, then $0.03 each. On any plan, including Solo, you can still email or text invoices from your own phone.";
export const TEXTING_OFFER_DETAIL = "Automatic ride and driver texts sent from your company's Nudge number. $75 setup + $19/mo, 500 texts included, then $0.03 each. Invoices can still be emailed or texted from your own phone on any plan.";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normSignupEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 120 || !EMAIL_RE.test(email)) return "";
  return email;
}

export function ownerNameProblem(value) {
  const name = String(value || "").trim();
  if (!name) return "Enter your name.";
  if (name.length > 80) return "Use 80 characters or fewer for your name.";
  return "";
}

export function companyNameProblem(value) {
  const name = String(value || "").trim();
  if (!name) return "Enter the company name.";
  if (name.length > 80) return "Use 80 characters or fewer for the company name.";
  return "";
}

// US/Canada NANP to E.164. Accepts 10 digits, a leading 1, and common punctuation.
export function normalizeSignupPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : "";
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return "";
  return "+1" + national;
}

export function phoneProblem(value, label, required = false) {
  const raw = String(value || "").trim();
  if (!raw) return required ? "Enter your " + label + "." : "";
  if (raw.length > 40) return "Use 40 characters or fewer for the " + label + ".";
  if (!normalizeSignupPhone(raw)) {
    return required
      ? "Enter a valid US phone number for the " + label + "."
      : "Enter a valid US " + label + ", or leave it blank.";
  }
  return "";
}

export function websiteProblem(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 120) return "Use 120 characters or fewer for the website.";
  return "";
}

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function logoProblem(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 180000 || !LOGO_RE.test(value)) {
    return "The logo must be a PNG, JPG, or WebP image under about 120 KB.";
  }
  return "";
}

export function suggestedSlug(companyName, typed) {
  if (typed !== undefined && String(typed).trim()) return normalizeSlug(typed);
  return slugBase(companyName);
}

export function signupWantsSms(body) {
  return !!(body && (body.smsAddon === true || body.sms === true));
}

// body: the JSON from POST /api/signup (no password rule here — the Worker uses passwordProblem).
export function signupFieldProblems(body) {
  if (!body || typeof body !== "object") return "Expected an object.";
  const company = companyNameProblem(body.companyName);
  if (company) return company;
  const name = ownerNameProblem(body.ownerName);
  if (name) return name;
  if (!normSignupEmail(body.email)) return "Enter a valid email.";
  const ownerPhone = phoneProblem(body.ownerPhone, "phone number", true);
  if (ownerPhone) return ownerPhone;
  const slug = slugProblem(suggestedSlug(body.companyName, body.bookingSlug));
  if (slug) return slug;
  if (body.plan && String(body.plan).toLowerCase().trim() && String(body.plan).toLowerCase().trim() !== PUBLIC_BILLING_PLAN) {
    return "The public plan is Solo.";
  }
  // Public signup is Solo only; texting stays on Small fleet and up.
  if (signupWantsSms(body) || !smsAllowed(PUBLIC_BILLING_PLAN)) {
    if (signupWantsSms(body)) return "Texting is available on Small fleet and up.";
  }
  if (body.slugPermanentConfirmed !== true) return "Please confirm you understand the company code can't be changed.";
  if (body.termsAccepted !== true) return TERMS_CONSENT_ERROR;
  const address = String(body.address || "").trim();
  if (address.length > 200) return "Use 200 characters or fewer for the address.";
  const businessPhone = phoneProblem(body.businessPhone, "business phone");
  if (businessPhone) return businessPhone;
  const website = websiteProblem(body.website);
  if (website) return website;
  const logo = logoProblem(body.logoDataUrl);
  if (logo) return logo;
  const theme = themeProblem(body.themeColor);
  if (theme) return theme;
  return "";
}

// Checkout line items for a self-serve Solo subscription.
// Plan setup (nudge_setup_solo) is omitted — the setup fee is waived, with no promo code on the page.
// SMS is never added on the public Solo path.
export function signupLineItems(prices, sms) {
  const includeSms = !!sms && smsAllowed(PUBLIC_BILLING_PLAN);
  const keys = [LOOKUP.solo.base];
  const items = [];
  if (prices[LOOKUP.solo.base]) items.push({ price: prices[LOOKUP.solo.base], quantity: 1 });
  if (includeSms) {
    keys.push(LOOKUP.sms.monthly, LOOKUP.sms.setup);
    if (prices[LOOKUP.sms.monthly]) items.push({ price: prices[LOOKUP.sms.monthly], quantity: 1 });
    if (prices[LOOKUP.sms.setup]) items.push({ price: prices[LOOKUP.sms.setup], quantity: 1 });
  }
  return { items, missing: keys.filter((k) => !prices[k]), addOverage: includeSms, overageKey: LOOKUP.sms.overage };
}

export function firstInvoiceCents(sms) {
  const includeSms = !!sms && smsAllowed(PUBLIC_BILLING_PLAN);
  return SOLO_MONTHLY_CENTS + (includeSms ? 7500 + 1900 : 0);
}

export function signupPublicConfig(env) {
  const siteKey = env && typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY.trim() : "";
  return {
    plan: PUBLIC_BILLING_PLAN,
    planLabel: PLAN_LABELS[PUBLIC_BILLING_PLAN],
    monthly: dollars(SOLO_MONTHLY_CENTS),
    setupWaived: true,
    setupWas: dollars(SOLO_SETUP_CENTS),
    trial: true,
    trialRides: TRIAL_RIDE_LIMIT,
    trialHeadline: TRIAL_HEADLINE,
    trialPlanLine: TRIAL_PLAN_LINE,
    trialSmallPrint: TRIAL_SMALL_PRINT,
    selfSetupLabel: "Self setup (you're doing it now): no setup fee",
    assistedSetupText: "Prefer we set it up for you? " + dollars(SOLO_SETUP_CENTS) + " one-time assisted setup.",
    assistedSetupMailto: assistedSetupMailto(),
    smsAllowed: smsAllowed(PUBLIC_BILLING_PLAN),
    smsPlans: SMS_PLANS.slice(),
    smsPriceText: SMS_PRICE_TEXT,
    textingUpgradeNote: TEXTING_UPGRADE_NOTE,
    textingOfferDetail: TEXTING_OFFER_DETAIL,
    termsUrl: SIGNUP_TERMS_URL,
    privacyUrl: SIGNUP_PRIVACY_URL,
    termsVersion: SIGNUP_TERMS_VERSION,
    bookingHost: SIGNUP_BOOKING_HOST,
    slugPermanentNote: SLUG_PERMANENT_NOTE,
    themePresets: THEME_PRESETS,
    turnstileSiteKey: siteKey,
  };
}

// Stripe Checkout in setup mode: the card is saved to the customer and NOT charged.
// customerId comes from a customer the Worker created first (setup mode does not create one).
export function checkoutParams({ origin, customerId, signupId, slug, pmc, excludedTypes }) {
  const meta = { app: "nudge-dispatch", purpose: "signup", signup_id: signupId, plan: PUBLIC_BILLING_PLAN, slug, sms: "off", trial: "rides-" + TRIAL_RIDE_LIMIT };
  const params = {
    mode: "setup",
    currency: "usd",
    customer: customerId,
    success_url: origin + "/signup/complete?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/signup?canceled=1",
    client_reference_id: signupId,
    metadata: meta,
    setup_intent_data: { metadata: meta },
    custom_text: { submit: { message: TRIAL_SMALL_PRINT } },
  };
  if (pmc && cardOnlyPaymentConfig({ STRIPE_CARD_PAYMENT_CONFIGURATION: pmc })) {
    params.payment_method_configuration = pmc;
  } else if (excludedTypes && excludedTypes.length) {
    params.excluded_payment_method_types = excludedTypes;
  }
  return { params };
}

// The trialing Solo subscription started after the card is saved. trial_end = Stripe's max horizon; the
// Worker ends the trial (trial_end=now) at the 15th completed ride. No setup line, no SMS.
export function trialSubscriptionParams({ customerId, priceId, paymentMethodId, signupId, slug, nowMs = Date.now() }) {
  const meta = { app: "nudge-dispatch", purpose: "signup", signup_id: signupId, plan: PUBLIC_BILLING_PLAN, slug, sms: "off", trial: "rides-" + TRIAL_RIDE_LIMIT };
  return {
    customer: customerId,
    items: [{ price: priceId, quantity: 1 }],
    default_payment_method: paymentMethodId,
    trial_end: stripeTrialEnd(nowMs),
    proration_behavior: "none",
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    metadata: meta,
  };
}

export function isSignupCheckout(session) {
  if (!session || typeof session !== "object") return false;
  if (session.mode && session.mode !== "setup" && session.mode !== "subscription") return false;
  const meta = session.metadata || {};
  return meta.purpose === "signup" && !!meta.signup_id;
}

export function signupSessionProblem(session, signup) {
  if (!session || session.object !== "checkout.session") return "Stripe did not return the checkout session.";
  if (session.mode !== "setup") return "That Stripe page was not a signup card page.";
  if (!isSignupCheckout(session)) return "That Stripe page was not a signup card page.";
  if (signup && session.metadata && session.metadata.signup_id && session.metadata.signup_id !== signup.id) {
    return "That card belongs to a different signup.";
  }
  if (session.status !== "complete") return "The card was not saved. Try again.";
  const si = session.setup_intent;
  if (si && typeof si === "object" && si.status && si.status !== "succeeded") return "The card was not saved. Try again.";
  return "";
}

// Turnstile: if no secret is configured (local tests), verification is skipped.
// A configured secret must accept the token.
export async function verifyTurnstile(env, token, ip) {
  const secret = env && typeof env.TURNSTILE_SECRET_KEY === "string" ? env.TURNSTILE_SECRET_KEY.trim() : "";
  if (!secret) return { ok: true, skipped: true };
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: "Please confirm you are not a robot." };
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token.trim());
  if (ip) body.set("remoteip", ip);
  const endpoint = (env && env.TURNSTILE_VERIFY_URL) || "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  let data;
  try {
    const res = await fetch(endpoint, { method: "POST", body });
    data = await res.json();
  } catch {
    return { ok: false, error: "Could not verify the security check. Try again." };
  }
  if (data && data.success === true) return { ok: true, skipped: false };
  return { ok: false, error: "Please confirm you are not a robot." };
}

export { normalizeThemeHex, THEME_PRESETS } from "./theme.js";
