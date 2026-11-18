// PayPal Invoicing (REST v2) from each fleet's OWN PayPal business account.
//
// Credentials model (Nov 2026): every fleet pastes its own PayPal REST app Client ID and Secret in More.
// Everything that knows WHERE credentials come from lives in this file (loadPayPalCredentials and friends),
// so a later PayPal Partner / "Connect with PayPal" model can swap in without touching the invoice code.
//
// Server switch PAYPAL_MODE: off (default, feature hidden) | mock (preview: no network, fake PayPal) |
// sandbox (sandbox apps only) | live (sandbox or live apps). PAYPAL_CREDENTIALS_KEY is a base64 32-byte
// AES-GCM key held as a Worker secret. PAYPAL_API_BASE overrides the PayPal host (tests only).

import { mockPayPal } from "./paypal-mock.js";

export const PAYPAL_APP_MODES = ["sandbox", "live"];
export const PAYPAL_BASES = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };
export const PAYPAL_WEBHOOK_EVENTS = ["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED", "INVOICING.INVOICE.REFUNDED"];
// PayPal access tokens last about 9 hours; reuse until 5 minutes before that.
export const TOKEN_MAX_SECONDS = 9 * 60 * 60;
const TOKEN_SKEW_MS = 5 * 60 * 1000;

export class PayPalError extends Error {
  constructor(message, status, name) {
    super(message);
    this.name = "PayPalError";
    this.status = status || 0;
    this.paypalName = name || "";
  }
}

export function paypalServerMode(env) {
  const raw = String((env && env.PAYPAL_MODE) || "").trim().toLowerCase();
  return raw === "mock" || raw === "sandbox" || raw === "live" ? raw : "off";
}

// Which app modes a fleet may save on this server.
export function allowedAppModes(env) {
  const server = paypalServerMode(env);
  if (server === "live") return ["sandbox", "live"];
  if (server === "sandbox" || server === "mock") return ["sandbox"];
  return [];
}

// Why the feature can't be used on this server, or "".
export function paypalServerProblem(env) {
  if (paypalServerMode(env) === "off") return "PayPal invoicing is not turned on yet.";
  if (!env.PAYPAL_CREDENTIALS_KEY) return "PayPal invoicing is not set up on this server yet.";
  return "";
}

// ---- AES-GCM sealing (secret and cached token). Format: v1.<iv b64>.<ciphertext b64>
function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function aesKey(keyB64) {
  let raw;
  try { raw = unb64(String(keyB64 || "").trim()); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) throw new PayPalError("PayPal invoicing is not set up on this server yet.", 503, "KEY");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealText(keyB64, plaintext, aad) {
  const key = await aesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(plaintext));
  return "v1." + b64(iv) + "." + b64(new Uint8Array(ct));
}
export async function openText(keyB64, sealed, aad) {
  const parts = String(sealed || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new PayPalError("Saved PayPal credentials can't be read. Save them again.", 409, "SEALED");
  const key = await aesKey(keyB64);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parts[1]), additionalData: new TextEncoder().encode(aad) }, key, unb64(parts[2]));
    return new TextDecoder().decode(pt);
  } catch {
    throw new PayPalError("Saved PayPal credentials can't be read. Save them again.", 409, "SEALED");
  }
}

// ---- Settings input
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{20,128}$/;
const WEBHOOK_ID_RE = /^[A-Za-z0-9-]{5,64}$/;

// body: { mode, clientId, secret, webhookId }. A blank secret keeps the saved one (hasSaved).
export function validateCredentialsInput(env, body, hasSaved) {
  if (!body || typeof body !== "object") return { error: "Expected an object." };
  const mode = String(body.mode || "").trim().toLowerCase();
  const allowed = allowedAppModes(env);
  if (!PAYPAL_APP_MODES.includes(mode)) return { error: "Choose Sandbox or Live." };
  if (!allowed.includes(mode)) return { error: mode === "live" ? "Live PayPal apps are not allowed on this server yet. Use a Sandbox app." : "That PayPal mode is not allowed here." };
  const clientId = String(body.clientId || "").trim();
  if (!CLIENT_ID_RE.test(clientId)) return { error: "Paste the Client ID from your PayPal REST app." };
  const secret = String(body.secret || "").trim();
  if (!secret && !hasSaved) return { error: "Paste the Secret from your PayPal REST app." };
  if (secret && !SECRET_RE.test(secret)) return { error: "That doesn't look like a PayPal app Secret." };
  const webhookId = String(body.webhookId || "").trim();
  if (webhookId && !WEBHOOK_ID_RE.test(webhookId)) return { error: "Paste the Webhook ID from your PayPal app's Webhooks list, or leave it blank." };
  return { mode, clientId, secret, webhookId, error: "" };
}

// ---- Credential store (swap point for a future Partner model)
function aadFor(companyId, what) {
  return "nudge-paypal:" + what + ":" + companyId;
}

export async function credentialsSummary(env, companyId) {
  const row = await env.DB.prepare("SELECT mode, client_id, secret_last4, webhook_id, updated_at FROM paypal_credentials WHERE company_id = ?").bind(companyId).first();
  if (!row) return { configured: false, mode: "", clientId: "", secretLast4: "", webhookId: "", updatedAt: null };
  return { configured: true, mode: row.mode, clientId: row.client_id, secretLast4: row.secret_last4, webhookId: row.webhook_id || "", updatedAt: row.updated_at };
}

export async function saveCredentials(env, companyId, input, now) {
  const existing = await env.DB.prepare("SELECT secret_enc, mode, client_id FROM paypal_credentials WHERE company_id = ?").bind(companyId).first();
  // A new app (mode or client id changed) needs its own secret.
  const sameApp = existing && existing.mode === input.mode && existing.client_id === input.clientId;
  if (!input.secret && !sameApp) throw new PayPalError("Paste the Secret for this PayPal app.", 400, "INPUT");
  const secretEnc = input.secret ? await sealText(env.PAYPAL_CREDENTIALS_KEY, input.secret, aadFor(companyId, "secret")) : existing.secret_enc;
  const last4 = input.secret ? input.secret.slice(-4) : null;
  if (existing) {
    await env.DB.prepare(
      `UPDATE paypal_credentials SET mode = ?, client_id = ?, secret_enc = ?, secret_last4 = COALESCE(?, secret_last4), webhook_id = ?,
         token_enc = NULL, token_expires_at = NULL, updated_at = ? WHERE company_id = ?`
    ).bind(input.mode, input.clientId, secretEnc, last4, input.webhookId, now, companyId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO paypal_credentials (company_id, mode, client_id, secret_enc, secret_last4, webhook_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(companyId, input.mode, input.clientId, secretEnc, last4, input.webhookId, now, now).run();
  }
}

export async function removeCredentials(env, companyId) {
  await env.DB.prepare("DELETE FROM paypal_credentials WHERE company_id = ?").bind(companyId).run();
}

// Full credentials for server-side calls only. Never send this object to a browser.
export async function loadPayPalCredentials(env, companyId) {
  const row = await env.DB.prepare("SELECT company_id, mode, client_id, secret_enc, webhook_id, token_enc, token_expires_at FROM paypal_credentials WHERE company_id = ?").bind(companyId).first();
  if (!row) return null;
  if (!allowedAppModes(env).includes(row.mode)) throw new PayPalError("Your saved PayPal app mode is not allowed on this server.", 409, "MODE");
  const secret = await openText(env.PAYPAL_CREDENTIALS_KEY, row.secret_enc, aadFor(companyId, "secret"));
  return { companyId, mode: row.mode, clientId: row.client_id, secret, webhookId: row.webhook_id || "", tokenEnc: row.token_enc || "", tokenExpiresAt: Number(row.token_expires_at || 0) };
}

// ---- HTTP
function apiBase(env, mode) {
  return String(env.PAYPAL_API_BASE || "").replace(/\/+$/, "") || PAYPAL_BASES[mode];
}

async function rawCall(env, mode, method, path, { headers, body, fetchImpl }) {
  if (paypalServerMode(env) === "mock") return mockPayPal(method, path, headers, body);
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(apiBase(env, mode) + path, { method, headers, body });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  return { status: res.status, data };
}

function paypalProblem(status, data) {
  const name = (data && (data.name || data.error)) || "";
  const detail = data && Array.isArray(data.details) && data.details[0] ? data.details[0].issue || data.details[0].description || "" : "";
  if (status === 401 || name === "invalid_client") return new PayPalError("PayPal didn't accept your Client ID and Secret. Check them in More.", 401, name);
  if (name === "DUPLICATE_INVOICE_NUMBER" || detail === "DUPLICATE_INVOICE_NUMBER") return new PayPalError("PayPal already has an invoice with this number. Change the next invoice number in More.", 409, name);
  return new PayPalError("PayPal returned an error" + (detail ? " (" + String(detail).slice(0, 60) + ")" : name ? " (" + String(name).slice(0, 60) + ")" : "") + ". Try again in a minute.", status >= 400 && status < 500 ? 409 : 502, name);
}

// OAuth client-credentials token, cached encrypted in D1 for about 9 hours.
export async function paypalAccessToken(env, creds, { fetchImpl, now = Date.now() } = {}) {
  if (creds.tokenEnc && creds.tokenExpiresAt - TOKEN_SKEW_MS > now) {
    try { return await openText(env.PAYPAL_CREDENTIALS_KEY, creds.tokenEnc, aadFor(creds.companyId, "token")); } catch { /* fetch a new one */ }
  }
  const basic = btoa(creds.clientId + ":" + creds.secret);
  const r = await rawCall(env, creds.mode, "POST", "/v1/oauth2/token", {
    headers: { authorization: "Basic " + basic, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: "grant_type=client_credentials",
    fetchImpl,
  });
  if (r.status !== 200 || !r.data || typeof r.data.access_token !== "string") throw paypalProblem(r.status || 401, r.data);
  const seconds = Math.min(TOKEN_MAX_SECONDS, Math.max(60, Number(r.data.expires_in) || TOKEN_MAX_SECONDS));
  const expiresAt = now + seconds * 1000;
  const tokenEnc = await sealText(env.PAYPAL_CREDENTIALS_KEY, r.data.access_token, aadFor(creds.companyId, "token"));
  await env.DB.prepare("UPDATE paypal_credentials SET token_enc = ?, token_expires_at = ? WHERE company_id = ?").bind(tokenEnc, expiresAt, creds.companyId).run();
  creds.tokenEnc = tokenEnc;
  creds.tokenExpiresAt = expiresAt;
  return r.data.access_token;
}

// JSON call with a bearer token. One retry with a fresh token if PayPal says the cached one expired.
export async function paypalRequest(env, creds, method, path, body, { requestId, fetchImpl, now } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await paypalAccessToken(env, creds, { fetchImpl, now });
    const headers = { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json", prefer: "return=representation" };
    if (requestId) headers["paypal-request-id"] = requestId;
    const r = await rawCall(env, creds.mode, method, path, { headers, body: body === undefined ? undefined : JSON.stringify(body), fetchImpl });
    if (r.status === 401 && attempt === 0) {
      creds.tokenEnc = "";
      creds.tokenExpiresAt = 0;
      continue;
    }
    if (r.status >= 200 && r.status < 300) return r.data;
    throw paypalProblem(r.status, r.data);
  }
  throw new PayPalError("PayPal didn't accept your Client ID and Secret. Check them in More.", 401, "AUTH");
}

// Settings "Test connection": just gets a token.
export async function testConnection(env, creds, opts) {
  creds.tokenEnc = "";
  await paypalAccessToken(env, creds, opts);
  return true;
}

// ---- Invoices
const PAYER_URL_RE = /^https:\/\/www\.(sandbox\.)?paypal\.com\/[^\s"'<>]{1,400}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validRiderEmail(email) {
  const value = String(email || "").trim();
  return EMAIL_RE.test(value) && value.length <= 254 ? value : "";
}

function cut(value, max) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

// PayPal v2 draft: Nudge invoice number, one "Car service" line, tips on, no tax, due on receipt.
export function buildPayPalInvoice({ number, amountCents, issuedOn, billName, billEmail, trip, businessName, terms }) {
  const cents = Math.round(Number(amountCents));
  if (!Number.isFinite(cents) || cents <= 0) throw new PayPalError("This invoice has no amount, so it can't go to PayPal.", 400, "INPUT");
  const email = validRiderEmail(billEmail);
  if (!email) throw new PayPalError("Add the rider's email to send a PayPal invoice.", 400, "INPUT");
  const t = trip || {};
  const route = [t.pickup, t.dropoff].filter(Boolean).join(" to ");
  const when = [t.date, t.time].filter(Boolean).join(" ");
  const draft = {
    detail: {
      invoice_number: cut(number, 127),
      currency_code: "USD",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: {},
    primary_recipients: [{ billing_info: { email_address: email, ...(billName ? { name: { full_name: cut(billName, 140) } } : {}) } }],
    items: [{
      name: "Car service",
      ...(route || when ? { description: cut([when, route].filter(Boolean).join(", "), 1000) } : {}),
      quantity: "1",
      unit_amount: { currency_code: "USD", value: (cents / 100).toFixed(2) },
      unit_of_measure: "AMOUNT",
    }],
    configuration: { allow_tip: true, tax_inclusive: false },
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(issuedOn || ""))) draft.detail.invoice_date = issuedOn;
  if (terms) draft.detail.terms_and_conditions = cut(terms, 4000);
  if (businessName) draft.invoicer.business_name = cut(businessName, 300);
  return draft;
}

export function safePayerUrl(value) {
  const url = String(value || "").trim();
  return PAYER_URL_RE.test(url) ? url : "";
}

function payerUrlOf(invoice) {
  const meta = invoice && invoice.detail && invoice.detail.metadata;
  return safePayerUrl(meta && meta.recipient_view_url);
}

// Draft then send. The Nudge invoice id is the PayPal-Request-Id, so a retry never makes a second invoice.
// existingId: a draft already created on an earlier try. onDraft(id, status) is called before sending.
export async function createAndSendInvoice(env, creds, nudgeInvoiceId, draft, { existingId, onDraft, fetchImpl, now } = {}) {
  let id = existingId || "";
  let payerUrl = "";
  if (!id) {
    const created = await paypalRequest(env, creds, "POST", "/v2/invoicing/invoices", draft, { requestId: nudgeInvoiceId, fetchImpl, now });
    id = String((created && created.id) || "");
    if (!/^[A-Z0-9-]{5,64}$/.test(id)) throw new PayPalError("PayPal didn't return an invoice id. Try again.", 502, "NO_ID");
    payerUrl = payerUrlOf(created);
    if (onDraft) await onDraft(id, String(created.status || "DRAFT"));
  }
  const sent = await paypalRequest(env, creds, "POST", "/v2/invoicing/invoices/" + encodeURIComponent(id) + "/send", { send_to_invoicer: false, send_to_recipient: true }, { requestId: nudgeInvoiceId + "-send", fetchImpl, now });
  payerUrl = safePayerUrl(sent && sent.href) || payerUrl;
  return { id, status: "SENT", payerUrl };
}

export const PAYPAL_STATUS_LABELS = {
  DRAFT: "Draft (not sent)",
  SENT: "Sent, not paid yet",
  SCHEDULED: "Scheduled",
  UNPAID: "Not paid yet",
  PAYMENT_PENDING: "Payment pending",
  PARTIALLY_PAID: "Partly paid",
  PAID: "Paid on PayPal",
  MARKED_AS_PAID: "Marked paid on PayPal",
  CANCELLED: "Cancelled on PayPal",
  REFUNDED: "Refunded on PayPal",
  PARTIALLY_REFUNDED: "Partly refunded on PayPal",
  MARKED_AS_REFUNDED: "Marked refunded on PayPal",
};

// ---- Paid status (webhook + cron backup)
const PAID_STATUSES = new Set(["PAID", "MARKED_AS_PAID"]);
const REFUNDED_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED"]);
// Statuses the 5-minute cron re-checks (still waiting on the rider).
export const PAYPAL_OPEN_STATUSES = ["SENT", "SCHEDULED", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID"];

// PayPal invoice -> what Nudge should do. Paid only when fully paid (no amount still due).
// CANCELLED changes nothing on the ride (it stays invoiced). Refunds only set the refunded flag.
export function payPalOutcome(invoice) {
  const status = String((invoice && invoice.status) || "").toUpperCase();
  const due = invoice && invoice.due_amount && invoice.due_amount.value !== undefined ? Number(invoice.due_amount.value) : 0;
  return {
    status,
    paid: PAID_STATUSES.has(status) && !(due > 0),
    refunded: REFUNDED_STATUSES.has(status),
  };
}

// Webhook resource -> PayPal invoice object. Invoicing events carry the invoice as resource or resource.invoice.
export function invoiceFromEvent(event) {
  const r = event && event.resource;
  if (!r || typeof r !== "object") return null;
  const inv = r.invoice && typeof r.invoice === "object" ? r.invoice : r;
  return typeof inv.id === "string" && /^[A-Z0-9-]{5,64}$/.test(inv.id) ? inv : null;
}

// Event type implies a status when the resource doesn't carry one.
export function eventInvoice(event) {
  const inv = invoiceFromEvent(event);
  if (!inv) return null;
  const implied = { "INVOICING.INVOICE.PAID": "PAID", "INVOICING.INVOICE.CANCELLED": "CANCELLED", "INVOICING.INVOICE.REFUNDED": "REFUNDED" }[event.event_type];
  return inv.status ? inv : { ...inv, status: implied || "" };
}

// PayPal's own check of a webhook delivery (verify-webhook-signature) against the fleet's webhook id.
export async function verifyWebhook(env, creds, headers, event, opts) {
  if (!creds.webhookId) return false;
  const h = (name) => String(headers.get(name) || "");
  const body = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: creds.webhookId,
    webhook_event: event,
  };
  if (!body.transmission_id || !body.transmission_sig) return false;
  const r = await paypalRequest(env, creds, "POST", "/v1/notifications/verify-webhook-signature", body, opts);
  return !!r && r.verification_status === "SUCCESS";
}

export async function fetchPayPalInvoice(env, creds, id, opts) {
  return paypalRequest(env, creds, "GET", "/v2/invoicing/invoices/" + encodeURIComponent(id), undefined, opts);
}
