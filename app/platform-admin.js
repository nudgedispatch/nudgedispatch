// Platform admin allowlist. Fail closed: an unset, blank, or invalid list means nobody is a platform admin.

export function platformAdminEmails(env) {
  const raw = env && typeof env.PLATFORM_ADMIN_EMAILS === "string" ? env.PLATFORM_ADMIN_EMAILS : "";
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function isListedPlatformAdmin(env, email) {
  const list = platformAdminEmails(env);
  if (!list.length) return false;
  const norm = String(email || "").trim().toLowerCase();
  return list.includes(norm);
}
