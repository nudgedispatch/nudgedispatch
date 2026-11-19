// Web Push for driver ride alerts (draft Nov 19, 2026).
// RFC 8291 message encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID, using only WebCrypto,
// so it runs the same on Workers and in Node tests. No third-party library.
//
// Keys: VAPID_PUBLIC_KEY is the uncompressed P-256 point (65 bytes, base64url);
// VAPID_PRIVATE_KEY is the 32-byte private scalar d (base64url). Both are Worker secrets.
// Sound: a web push notification plays the phone's default notification sound. Web push has no
// custom-sound option on iPhone or Android; the in-app chime only plays while the app is open.

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  const clean = String(text || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

function pointJwk(publicRaw, d) {
  if (!(publicRaw instanceof Uint8Array) || publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("bad P-256 public key");
  const jwk = { kty: "EC", crv: "P-256", x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true };
  if (d) jwk.d = b64urlEncode(d);
  return jwk;
}

/** Valid browser subscription keys: p256dh is a 65-byte uncompressed point, auth is 16 bytes. */
export function subscriptionKeysProblem(p256dh, auth) {
  try {
    const pub = b64urlDecode(p256dh);
    const secret = b64urlDecode(auth);
    if (pub.length !== 65 || pub[0] !== 4) return "bad p256dh";
    if (secret.length !== 16) return "bad auth";
    return "";
  } catch {
    return "bad keys";
  }
}

/** Derive CEK and nonce (RFC 8291 section 3.4). Exported for the RFC test vectors. */
export async function deriveKeys({ ecdhSecret, authSecret, uaPublic, asPublic, salt }) {
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  return { ikm, prk, cek, nonce };
}

/**
 * Encrypt one push message for a subscription (single aes128gcm record, rs 4096).
 * `testOnly` lets the RFC 8291 test fix the salt and sender key pair; production leaves it empty.
 */
export async function encryptPayload(plaintext, p256dh, auth, testOnly = {}) {
  const uaPublic = typeof p256dh === "string" ? b64urlDecode(p256dh) : p256dh;
  const authSecret = typeof auth === "string" ? b64urlDecode(auth) : auth;
  const data = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  if (data.length > 3800) throw new Error("push payload too large");
  const salt = testOnly.salt || crypto.getRandomValues(new Uint8Array(16));
  let asPublic, asPrivate;
  if (testOnly.asPublic && testOnly.asPrivate) {
    asPublic = testOnly.asPublic;
    asPrivate = await crypto.subtle.importKey("jwk", pointJwk(asPublic, testOnly.asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const { cek, nonce } = await deriveKeys({ ecdhSecret, authSecret, uaPublic, asPublic, salt });
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(data, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** Receiver side (tests and the e2e mock push service only). */
export async function decryptPayload(body, uaPublicB64, uaPrivateB64, authB64) {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  const uaPublic = b64urlDecode(uaPublicB64);
  const uaPriv = await crypto.subtle.importKey("jwk", pointJwk(uaPublic, b64urlDecode(uaPrivateB64)), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPriv, 256));
  const { cek, nonce } = await deriveKeys({ ecdhSecret, authSecret: b64urlDecode(authB64), uaPublic, asPublic, salt });
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error("bad padding delimiter");
  return new TextDecoder().decode(plain.slice(0, end));
}

export function vapidConfigured(env) {
  return !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** RFC 8292 VAPID Authorization header value for one push service origin. */
export async function vapidAuthorization(env, endpoint, nowMs = Date.now()) {
  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey("jwk", pointJwk(pub, b64urlDecode(env.VAPID_PRIVATE_KEY)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || "https://nudgedispatch.com",
  })));
  const signingInput = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${b64urlEncode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Push services we deliver to. Anything else is refused at subscribe time (no open relay / SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/];

/** PUSH_TEST_ENDPOINT_ORIGIN is for local tests only (an http://127.0.0.1 mock push service); never set it in prod. */
export function endpointProblem(env, endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return "bad endpoint";
  let url;
  try { url = new URL(endpoint); } catch { return "bad endpoint"; }
  const testOrigin = env && env.PUSH_TEST_ENDPOINT_ORIGIN;
  if (testOrigin && url.origin === testOrigin) return "";
  if (url.protocol !== "https:" || url.username || url.password || url.port) return "unsupported push service";
  return PUSH_HOSTS.some((re) => re.test(url.hostname)) ? "" : "unsupported push service";
}

/**
 * Send one message. Returns { ok, status, gone } — gone means the subscription is dead (404/410)
 * and should be deleted. Never throws on HTTP errors.
 */
export async function sendPush(env, sub, payload, { ttl = 3600, urgency = "high", topic = "" } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const headers = {
    authorization: await vapidAuthorization(env, sub.endpoint),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(ttl),
    urgency,
  };
  if (topic && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.topic = topic;
  let response;
  try {
    response = await fetch(sub.endpoint, { method: "POST", headers, body });
  } catch {
    return { ok: false, status: 0, gone: false };
  }
  // Drain the body so the connection is released on Workers.
  try { await response.arrayBuffer(); } catch { /* ignore */ }
  return { ok: response.status >= 200 && response.status < 300, status: response.status, gone: response.status === 404 || response.status === 410 };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function pickupWhen(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  let day = "";
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    day = `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  let clock = "";
  if (t) {
    const h = Number(t[1]);
    clock = `${h % 12 || 12}:${t[2]} ${h < 12 ? "AM" : "PM"}`;
  }
  return [day, clock].filter(Boolean).join(", ");
}

/**
 * A short pickup area for the lock screen: city/area or place name, not the full street address.
 * "123 Main St, Atlanta, GA 30303" -> "Atlanta, GA"; "ATL Airport" stays; "55 Peachtree St" -> "Peachtree St".
 */
export function pickupArea(address) {
  const clean = String(address || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
  let area;
  if (parts.length >= 3) area = parts.slice(1, 3).join(", ").replace(/\s+\d{5}(-\d{4})?$/, "");
  else if (parts.length === 2) area = /^\d/.test(parts[0]) ? parts[1].replace(/\s+\d{5}(-\d{4})?$/, "") : parts[0];
  else area = clean.replace(/^\d+[A-Za-z]?\s+/, "");
  area = area || clean;
  return area.length > 48 ? area.slice(0, 47).trimEnd() + "…" : area;
}

/** Notification content for a ride event. No rider name or phone on the lock screen. */
export function rideAlertPayload(kind, ride, companyName = "") {
  const when = pickupWhen(ride.pickup_date, ride.pickup_time);
  const area = pickupArea(ride.pickup);
  const detail = [when ? `Pickup ${when}` : "", area].filter(Boolean).join(" · ");
  const id = String(ride.id || "");
  const base = { v: 1, kind, rideId: id, tag: "ride-" + id, company: companyName || "" };
  if (kind === "assigned") {
    return { ...base, title: "New ride assigned", body: detail || "Open Nudge to see the ride.", url: "/#/rides/" + id, requireInteraction: true };
  }
  if (kind === "unassigned") {
    return { ...base, title: "Ride moved off your list", body: detail || "This ride is no longer assigned to you.", url: "/#/rides", requireInteraction: false };
  }
  if (kind === "cancelled") {
    return { ...base, title: "Ride cancelled", body: detail || "A ride you were assigned was cancelled.", url: "/#/rides", requireInteraction: false };
  }
  return { ...base, kind: "test", rideId: "", tag: "nudge-test", title: "Test alert from Nudge", body: "Ride alerts are working on this phone.", url: "/#/rides", requireInteraction: false };
}
