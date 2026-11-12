// Nudge Dispatch texting through Bland (DRAFT, Nov 10, 2026). Ported from nudge-release/src/sms.ts.
// Safety: sending needs ALL of: company texting add-on on, BLAND_API_KEY (secret), BLAND_FROM_NUMBER,
// and SMS_MODE. SMS_MODE "off" (default) never sends; "test" sends only to numbers listed in
// SMS_TEST_ALLOWLIST (comma-separated +1 numbers); "live" sends to any valid US/Canada number.

const LIMIT_MESSAGE = "Text limit reached, try later";
const LIMIT_CODES = new Set(["SMS_RL_PLAN_HOURLY", "SMS_RL_PLAN_DAILY"]);

export function usCanadaE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : "";
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;
  return "+1" + national;
}

function time12(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  if (!m) return t || "";
  let h = +m[1];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

export function onMyWayMessage(companyName, clientName, pickupTime) {
  const first = String(clientName || "").trim().split(/\s+/)[0] || "there";
  const from = String(companyName || "").trim().slice(0, 60) || "Your car service";
  return `${from}: Hi ${first}, your driver is on the way for your ${time12(pickupTime)} pickup. Reply STOP to opt out.`;
}

// Arrived text. Same style as on-my-way (company prefix, STOP opt-out). Vehicle, plate,
// and a pickup meeting point are added only when known so the message stays short.
export function arrivedMessage({ companyName, driverName, vehicle, plate, meetingPoint } = {}) {
  const from = String(companyName || "").trim().slice(0, 60) || "Your car service";
  const first = String(driverName || "").trim().split(/\s+/)[0] || "";
  const who = first ? `Your driver ${first}` : "Your driver";
  let body = `${who} has arrived`;
  const veh = String(vehicle || "").trim();
  const plat = String(plate || "").trim();
  if (veh || plat) body += " in " + [veh, plat].filter(Boolean).join(" ");
  const meet = String(meetingPoint || "").trim();
  if (meet) body += " at " + meet;
  return `${from}: ${body}. Reply STOP to opt out.`;
}

export function blandFailureReason(status, body) {
  if (status === 429 || hasLimitCode(body)) return LIMIT_MESSAGE;
  return "The text could not be sent.";
}

function hasLimitCode(value) {
  if (typeof value === "string") return LIMIT_CODES.has(value);
  if (Array.isArray(value)) return value.some(hasLimitCode);
  if (value && typeof value === "object") return Object.values(value).some(hasLimitCode);
  return false;
}

export function smsMode(env) {
  const m = String((env && env.SMS_MODE) || "off").toLowerCase();
  return m === "live" || m === "test" ? m : "off";
}

export function allowlist(env) {
  return String((env && env.SMS_TEST_ALLOWLIST) || "").split(",").map((x) => usCanadaE164(x)).filter(Boolean);
}

// Why texting can't go out right now ("" = ready). Never mentions secret values.
export function textingProblem(env) {
  if (smsMode(env) === "off") return "Texting is switched off on this server (SMS_MODE).";
  if (!env.BLAND_API_KEY) return "Texting is not connected: no Bland API key on this server.";
  if (!usCanadaE164(env.BLAND_FROM_NUMBER || "")) return "Texting is not connected: no Bland sending number yet (BLAND_FROM_NUMBER).";
  if (smsMode(env) === "test" && !allowlist(env).length) return "Texting is in test mode with no approved test numbers.";
  return "";
}

export function recipientProblem(env, e164) {
  if (!e164) return "This number cannot be texted (US or Canada numbers only).";
  if (smsMode(env) === "test" && !allowlist(env).includes(e164)) return "Test mode: this number is not on the approved test list, so nothing was sent.";
  return "";
}

function blandBase(env) {
  const b = (env && env.BLAND_API_BASE) || "";
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(b) ? b : "https://api.bland.ai";
}

export async function sendBlandSms(env, to, message, idempotencyKey) {
  const key = env.BLAND_API_KEY || "";
  const from = usCanadaE164(env.BLAND_FROM_NUMBER || "");
  if (!key || !from) return { ok: false, reason: "Texts are unavailable." };
  let response;
  try {
    response = await fetch(blandBase(env) + "/v1/sms/send", {
      method: "POST",
      headers: { authorization: key, "content-type": "application/json", "idempotency-key": idempotencyKey || crypto.randomUUID() },
      body: JSON.stringify({ user_number: to, agent_number: from, agent_message: message }),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return { ok: false, reason: "The text could not be sent." };
  }
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  if (!response.ok || (parsed && Array.isArray(parsed.errors) && parsed.errors.length)) return { ok: false, reason: blandFailureReason(response.status, parsed) };
  const data = (parsed && parsed.data) || {};
  return { ok: true, messageId: data.message_id || data.conversation_id || "" };
}
