// Sanitize invoice_settings.website for the public booking page.
// Only http(s) URLs are returned; anything else is treated as blank.

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function hostAllowed(hostname) {
  const host = String(hostname || "").replace(/\.$/, "").toLowerCase();
  if (!host) return false;
  if (host.includes(":")) return true; // URL-parsed IPv6, without brackets
  if (IPV4_RE.test(host)) {
    return host.split(".").every((part) => {
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return DOMAIN_RE.test(host);
}

export function publicWebsiteUrl(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (raw.length > 200) return "";
  if (/[\s\u0000-\u001F\u007F]/.test(raw)) return "";

  let candidate = raw;
  if (!SCHEME_RE.test(candidate)) {
    candidate = candidate.startsWith("//") ? "https:" + candidate : "https://" + candidate;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return "";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  if (!hostAllowed(url.hostname)) return "";

  try {
    const clean = new URL(url.protocol + "//placeholder.invalid");
    clean.hostname = url.hostname.replace(/\.$/, "");
    clean.port = url.port;
    clean.pathname = url.pathname;
    clean.search = url.search;
    clean.hash = url.hash;
    if (clean.protocol !== "http:" && clean.protocol !== "https:") return "";
    if (clean.username || clean.password) return "";
    if (!hostAllowed(clean.hostname)) return "";
    if (clean.pathname === "/" && !clean.search && !clean.hash) return clean.origin;
    return clean.href;
  } catch {
    return "";
  }
}

export function publicWebsiteLabel(value) {
  const href = publicWebsiteUrl(value);
  if (!href) return "";
  try {
    const host = new URL(href).hostname.replace(/\.$/, "");
    return host || "Visit website";
  } catch {
    return "";
  }
}
