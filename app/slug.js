// Booking slug / company code: format, reserved words, suggestions.
// Used by public booking URLs (/book/<slug>/), driver sign-in, and self-serve signup.

export const BOOKING_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BOOKING_SLUG_MAX = 40;

// Path segments, product words, and signup/billing terms that must never be a company code.
export const BOOKING_RESERVED = new Set([
  "book", "api", "admin", "login", "settings", "rides", "clients", "icons", "brand", "www", "app",
  "demo", "static", "assets", "public", "health", "start", "where", "index", "manifest", "sw", "new",
  "invoice", "invoices", "signup", "sign-up", "register", "terms", "privacy", "pricing", "billing",
  "checkout", "account", "complete", "card", "pay", "payment", "payments", "support", "help", "legal",
  "contact", "about", "blog", "docs", "status", "webhook", "webhooks", "platform", "company", "companies",
  "user", "users", "owner", "driver", "drivers", "solo", "fleet", "small", "beta", "trial", "welcome",
  "stripe", "hook", "hooks", "null", "undefined", "true", "false", "css", "js", "html", "png", "svg",
  "qr", "install",
]);

export function slugBase(name) {
  const s = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BOOKING_SLUG_MAX)
    .replace(/-+$/g, "");
  if (s.length >= 2 && !BOOKING_RESERVED.has(s) && BOOKING_SLUG_RE.test(s)) return s;
  if (s.length >= 2 && BOOKING_RESERVED.has(s)) {
    const alt = (s + "-rides").slice(0, BOOKING_SLUG_MAX).replace(/-+$/g, "");
    if (BOOKING_SLUG_RE.test(alt) && !BOOKING_RESERVED.has(alt)) return alt;
  }
  return "rides";
}

export function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

// "" when the slug is usable (availability is checked separately). Otherwise a short reason.
export function slugProblem(value) {
  const slug = normalizeSlug(value);
  if (!slug) return "Enter a company code.";
  if (slug.length < 2) return "Use at least 2 characters.";
  if (slug.length > BOOKING_SLUG_MAX) return "Use " + BOOKING_SLUG_MAX + " characters or fewer.";
  if (!BOOKING_SLUG_RE.test(slug)) {
    return "Use lowercase letters, numbers, and single hyphens. Don't start or end with a hyphen.";
  }
  if (BOOKING_RESERVED.has(slug)) return "That company code is reserved. Try another.";
  return "";
}
