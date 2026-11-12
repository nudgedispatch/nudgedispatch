// Stripe webhook signature check + event -> company status mapping (DRAFT, Nov 10, 2026).
// Pure functions + Web Crypto; no Stripe SDK. Tolerance 5 minutes.

export const WEBHOOK_TOLERANCE_SEC = 300;
export const HANDLED_EVENTS = ["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"];

export function parseSigHeader(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) out.t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) out.v1.push(v.toLowerCase());
  }
  return out;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Returns "" when valid, or a short reason.
export async function verifyStripeSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = WEBHOOK_TOLERANCE_SEC) {
  if (!secret) return "no webhook secret configured";
  const { t, v1 } = parseSigHeader(header);
  if (!t || !v1.length) return "missing or malformed Stripe-Signature";
  if (Math.abs(nowSec - t) > tolerance) return "timestamp outside tolerance";
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1.some((s) => safeEqual(s, expected)) ? "" : "signature mismatch";
}

// For tests: build a header the way Stripe does.
export async function signForTest(rawBody, secret, t) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${rawBody}`)}`;
}

export function subStatusToBilling(status) {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  if (status === "incomplete") return "incomplete";
  return "";
}

function idOf(v) {
  return typeof v === "string" ? v : v && typeof v === "object" && typeof v.id === "string" ? v.id : "";
}

// Pull customer/subscription ids out of an invoice or subscription object (handles old and new invoice shapes).
export function refsOf(type, obj) {
  if (!obj || typeof obj !== "object") return { customer: "", subscription: "" };
  if (type.startsWith("customer.subscription.")) return { customer: idOf(obj.customer), subscription: idOf(obj.id) };
  const sub = idOf(obj.subscription) || idOf(obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
  return { customer: idOf(obj.customer), subscription: sub };
}

// Test keys ignore livemode events (same as the test-only build). Live keys ignore everything else.
export function webhookLivemodeDecision(event, mode) {
  const liveEvent = !!(event && event.livemode === true);
  if (mode === "live") {
    if (!liveEvent) return { process: false, ignored: "test mode event", livemode: 0 };
    return { process: true, livemode: 1 };
  }
  if (liveEvent) return { process: false, ignored: "livemode event", livemode: 1 };
  return { process: true, livemode: 0 };
}

// Paid-through = latest period end on the invoice's subscription lines (falls back to invoice.period_end).
export function paidThroughMs(invoice) {
  let end = 0;
  const lines = (invoice && invoice.lines && invoice.lines.data) || [];
  for (const l of lines) if (l && l.period && Number(l.period.end) > end) end = Number(l.period.end);
  if (!end && invoice && Number(invoice.period_end)) end = Number(invoice.period_end);
  return end ? end * 1000 : null;
}
