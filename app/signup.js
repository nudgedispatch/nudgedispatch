// Self-serve signup helpers (pure + Turnstile + Checkout line items).
// Public plan is Solo only. Plan setup fee is waived by omitting the setup line (no typable promo codes).
// Texting stays gated to Small fleet and up — Solo signup has no texting checkbox.

import { LOOKUP, SMS_PRICE_TEXT, SMS_PLANS, PLAN_LABELS, cardOnlyPaymentConfig, dollars, smsAllowed } from "./billing.js";
import { normalizeSlug, slugBase, slugProblem } from "./slug.js";
import { THEME_PRESETS, themeProblem } from "./theme.js";

export const PUBLIC_BILLING_PLAN = "solo";
export const SIGNUP_TERMS_URL = "https://nudgedispatch.com/terms.html";
export const SIGNUP_PRIVACY_URL = "https://nudgedispatch.com/privacy.html";
export const SIGNUP_TERMS_VERSION = "nudgedispatch.com/terms.html#2026-11-09";
export const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
export const SOLO_MONTHLY_CENTS = 3900;
export const SOLO_SETUP_CENTS = 29900; // advertised price; waived for self-serve
export const SIGNUP_RATE_WINDOW_MS = 15 * 60 * 1000;
export const SIGNUP_POST_MAX = 8;
export const SIGNUP_SLUG_MAX = 60;
export const SIGNUP_BOOKING_HOST = "app.nudgedispatch.com";

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
  if (body.termsAccepted !== true) return "Please agree to the Terms of Service and Privacy Policy.";
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

export function checkoutParams({ origin, customerEmail, signupId, slug, sms, prices, pmc, excludedTypes }) {
  const built = signupLineItems(prices, sms);
  const params = {
    mode: "subscription",
    success_url: origin + "/signup/complete?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/signup?canceled=1",
    customer_email: customerEmail,
    client_reference_id: signupId,
    metadata: { app: "nudge-dispatch", purpose: "signup", signup_id: signupId, plan: PUBLIC_BILLING_PLAN, slug, sms: "off" },
    subscription_data: { metadata: { app: "nudge-dispatch", purpose: "signup", signup_id: signupId, plan: PUBLIC_BILLING_PLAN, slug, sms: "off" } },
    line_items: built.items,
  };
  if (pmc && cardOnlyPaymentConfig({ STRIPE_CARD_PAYMENT_CONFIGURATION: pmc })) {
    params.payment_method_configuration = pmc;
  } else if (excludedTypes && excludedTypes.length) {
    params.excluded_payment_method_types = excludedTypes;
  }
  return { params, built };
}

export function isSignupCheckout(session) {
  if (!session || typeof session !== "object") return false;
  if (session.mode && session.mode !== "subscription") return false;
  const meta = session.metadata || {};
  return meta.purpose === "signup" && !!meta.signup_id;
}

export function signupSessionProblem(session, signup) {
  if (!session || session.object !== "checkout.session") return "Stripe did not return the checkout session.";
  if (session.mode !== "subscription") return "That Stripe page was not a signup payment.";
  if (!isSignupCheckout(session)) return "That Stripe page was not a signup payment.";
  if (signup && session.metadata && session.metadata.signup_id && session.metadata.signup_id !== signup.id) {
    return "That payment belongs to a different signup.";
  }
  if (session.status !== "complete") return "The payment was not finished. Try again.";
  const paid = session.payment_status;
  if (paid && paid !== "paid" && paid !== "no_payment_required") return "The payment was not completed. Try again.";
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
