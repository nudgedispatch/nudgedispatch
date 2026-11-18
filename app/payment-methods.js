// Structured "Pay with" options for invoices: Cash, Cash App, Zelle, Venmo, PayPal.
// Money goes straight to the owner's own accounts. The app never moves or confirms money,
// so the owner marks the ride paid himself.
//
// Link formats (checked Nov 2026):
//   Cash App  https://cash.app/$cashtag/125.00          (amount prefilled, no note field)
//   Venmo     https://venmo.com/user?txn=pay&amount=125.00&note=Invoice%20TGS-1001
//   PayPal    https://paypal.me/user/125.00USD          (paypal.me names: letters/numbers, max 20)
//             https://www.paypal.com/biz/profile/user   (business profiles: no amount prefill)
//   Zelle     no public pay link, so the handle is shown with a copy button.

export const PAY_KINDS = ["cash", "cashapp", "zelle", "venmo", "paypal"];
export const PAY_LABELS = { cash: "Cash", cashapp: "Cash App", zelle: "Zelle", venmo: "Venmo", paypal: "PayPal" };
export const CASH_LINE = "Pay your driver in cash";

const CASHTAG_RE = /^(?=.*[A-Za-z])[A-Za-z0-9_]{1,20}$/;
const VENMO_RE = /^[A-Za-z0-9_-]{1,30}$/;
const PAYPAL_RE = /^[A-Za-z0-9]{1,20}$/;
const PAYPAL_BIZ_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PAYPAL_ERROR = "Enter your PayPal.Me name or your paypal.com/biz/profile link.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyPaymentMethods() {
  const out = {};
  for (const kind of PAY_KINDS) out[kind] = { on: false, handle: "" };
  return out;
}

function clean(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function usPhone(value) {
  const digits = value.replace(/[^\d]/g, "");
  const ten = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (ten.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return "";
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

// Returns { handle, error } with the handle in its stored form (no leading $ or @).
export function normalizeHandle(kind, raw) {
  const value = clean(raw);
  if (kind === "cash") return { handle: "", error: "" };
  if (!value) return { handle: "", error: "" };
  if (value.length > 120) return { handle: "", error: `That ${PAY_LABELS[kind]} handle is too long.` };
  if (kind === "cashapp") {
    const tag = value.replace(/^https?:\/\/(www\.)?cash\.(app|me)\//i, "").replace(/\/.*$/, "").replace(/^\$/, "");
    if (!CASHTAG_RE.test(tag)) return { handle: "", error: "Enter your Cash App $cashtag (letters, numbers, or _; up to 20)." };
    return { handle: tag, error: "" };
  }
  if (kind === "venmo") {
    const user = value.replace(/^https?:\/\/(www\.|account\.)?venmo\.com\/(u\/)?/i, "").replace(/[/?#].*$/, "").replace(/^@/, "");
    if (!VENMO_RE.test(user)) return { handle: "", error: "Enter your Venmo @username (letters, numbers, - or _; up to 30)." };
    return { handle: user, error: "" };
  }
  if (kind === "paypal") {
    const bizStored = /^biz:(.*)$/i.exec(value);
    const bizUrl = /^(?:https?:\/\/)?(?:www\.)?paypal\.com\/biz\/profile\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(value);
    if (bizStored || bizUrl) {
      const user = bizStored ? bizStored[1] : bizUrl[1];
      if (!PAYPAL_BIZ_RE.test(user)) return { handle: "", error: PAYPAL_ERROR };
      return { handle: "biz:" + user, error: "" };
    }
    const user = value
      .replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, "")
      .replace(/^(https?:\/\/)?(www\.)?paypal\.com\/paypalme\//i, "")
      .replace(/[/?#].*$/, "")
      .replace(/^@/, "");
    if (!PAYPAL_RE.test(user)) return { handle: "", error: PAYPAL_ERROR };
    return { handle: user, error: "" };
  }
  if (kind === "zelle") {
    if (value.includes("@")) {
      const email = value.toLowerCase();
      if (!EMAIL_RE.test(email)) return { handle: "", error: "Enter the phone number or email your Zelle uses." };
      return { handle: email, error: "" };
    }
    const phone = usPhone(value);
    if (!phone) return { handle: "", error: "Enter the phone number or email your Zelle uses." };
    return { handle: phone, error: "" };
  }
  return { handle: "", error: "" };
}

// Validates the settings PUT body. Unknown kinds are ignored; a turned-on method needs a handle.
export function validatePaymentMethods(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { methods: null, error: "Payment methods must be an object." };
  }
  const methods = emptyPaymentMethods();
  for (const kind of PAY_KINDS) {
    const entry = input[kind];
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== "object" || Array.isArray(entry)) return { methods: null, error: `Check the ${PAY_LABELS[kind]} setting.` };
    const on = entry.on === true;
    const { handle, error } = normalizeHandle(kind, entry.handle);
    if (error) return { methods: null, error };
    if (on && kind !== "cash" && !handle) {
      const what = { cashapp: "$cashtag", zelle: "Zelle phone or email", venmo: "Venmo @username", paypal: "PayPal.Me name or paypal.com/biz/profile link" }[kind];
      return { methods: null, error: `Enter your ${what}, or turn ${PAY_LABELS[kind]} off.` };
    }
    methods[kind] = { on, handle };
  }
  return { methods, error: "" };
}

// Reads the stored JSON (or null/garbage from before the migration) without throwing.
export function parseStoredPaymentMethods(text) {
  const out = emptyPaymentMethods();
  if (typeof text !== "string" || !text) return out;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const kind of PAY_KINDS) {
    const entry = value[kind];
    if (!entry || typeof entry !== "object") continue;
    const { handle, error } = normalizeHandle(kind, entry.handle);
    if (error) continue;
    const on = entry.on === true && (kind === "cash" || !!handle);
    out[kind] = { on, handle };
  }
  return out;
}

export function amountString(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (Math.round(n) / 100).toFixed(2);
}

function displayHandle(kind, handle) {
  if (kind === "cashapp") return "$" + handle;
  if (kind === "venmo") return "@" + handle;
  if (kind === "paypal") {
    if (handle.startsWith("biz:")) return "paypal.com/biz/profile/" + handle.slice(4);
    return "paypal.me/" + handle;
  }
  if (kind === "cash") return CASH_LINE;
  return handle;
}

export function payUrl(kind, handle, amountCents, invoiceNumber) {
  const amt = amountString(amountCents);
  if (kind === "cashapp") return `https://cash.app/$${encodeURIComponent(handle)}${amt ? "/" + amt : ""}`;
  if (kind === "venmo") {
    const params = ["txn=pay"];
    if (amt) params.push("amount=" + amt);
    if (invoiceNumber) params.push("note=" + encodeURIComponent("Invoice " + invoiceNumber));
    return `https://venmo.com/${encodeURIComponent(handle)}?${params.join("&")}`;
  }
  if (kind === "paypal") {
    if (handle.startsWith("biz:")) return `https://www.paypal.com/biz/profile/${encodeURIComponent(handle.slice(4))}`;
    return `https://paypal.me/${encodeURIComponent(handle)}${amt ? "/" + amt + "USD" : ""}`;
  }
  return "";
}

// The turned-on options for one invoice, in the order clients usually expect.
export function payOptions(methods, amountCents, invoiceNumber) {
  const list = [];
  const order = ["cashapp", "venmo", "paypal", "zelle", "cash"];
  for (const kind of order) {
    const m = methods && methods[kind];
    if (!m || !m.on) continue;
    if (kind !== "cash" && !m.handle) continue;
    list.push({
      kind,
      label: PAY_LABELS[kind],
      handle: m.handle,
      display: displayHandle(kind, m.handle),
      url: payUrl(kind, m.handle, amountCents, invoiceNumber),
      copy: kind === "zelle" ? m.handle : "",
    });
  }
  return list;
}

// One plain-text line per option, for the invoice text, email body, and text message.
export function payLines(options) {
  return options.map((o) => {
    if (o.kind === "cash") return `Cash: ${CASH_LINE}`;
    if (o.kind === "zelle") return `Zelle: ${o.display}`;
    return `${o.label}: ${o.display} ${o.url}`;
  });
}
