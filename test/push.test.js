import assert from "node:assert/strict";
import test from "node:test";
import {
  b64urlDecode, b64urlEncode, decryptPayload, deriveKeys, encryptPayload, endpointProblem, pickupArea, pickupWhen,
  rideAlertPayload, subscriptionKeysProblem, vapidAuthorization,
} from "../app/push.js";

// RFC 8291 section 5 and Appendix A.
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdh: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("RFC 8291 intermediate values (Appendix A)", async () => {
  const keys = await deriveKeys({
    ecdhSecret: b64urlDecode(V.ecdh), authSecret: b64urlDecode(V.auth), uaPublic: b64urlDecode(V.uaPublic),
    asPublic: b64urlDecode(V.asPublic), salt: b64urlDecode(V.salt),
  });
  assert.equal(b64urlEncode(keys.ikm), V.ikm);
  assert.equal(b64urlEncode(keys.prk), V.prk);
  assert.equal(b64urlEncode(keys.cek), V.cek);
  assert.equal(b64urlEncode(keys.nonce), V.nonce);
});

test("RFC 8291 section 5 message encrypts byte for byte and decrypts", async () => {
  const out = await encryptPayload(V.plaintext, V.uaPublic, V.auth, {
    salt: b64urlDecode(V.salt), asPublic: b64urlDecode(V.asPublic), asPrivate: b64urlDecode(V.asPrivate),
  });
  assert.equal(out.length, 144); // 86-byte header + 42 plaintext+delimiter + 16 tag (the RFC example header says 145; the body is 144)
  assert.equal(b64urlEncode(out), V.body);
  assert.equal(await decryptPayload(out, V.uaPublic, V.uaPrivate, V.auth), V.plaintext);
});

test("random salt and sender key every message; receiver can still decrypt", async () => {
  const a = await encryptPayload("{\"x\":1}", V.uaPublic, V.auth);
  const b = await encryptPayload("{\"x\":1}", V.uaPublic, V.auth);
  assert.notEqual(b64urlEncode(a), b64urlEncode(b));
  assert.equal(await decryptPayload(a, V.uaPublic, V.uaPrivate, V.auth), "{\"x\":1}");
  await assert.rejects(encryptPayload("x".repeat(4000), V.uaPublic, V.auth));
});

test("VAPID header is a valid ES256 JWT for the push service origin", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const env = { VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:ops@example.test" };
  const header = await vapidAuthorization(env, "https://fcm.googleapis.com/fcm/send/abc", 1_800_000_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], env.VAPID_PUBLIC_KEY);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: "mailto:ops@example.test" });
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64urlDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(ok, true);
});

test("only known push services are accepted (test origin only when configured)", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://web.push.apple.com/QGx", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
    assert.equal(endpointProblem({}, ok), "", ok);
  }
  for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x", "nope", 42]) {
    assert.notEqual(endpointProblem({}, bad), "", String(bad));
  }
  assert.notEqual(endpointProblem({}, "http://127.0.0.1:9999/p/1"), "");
  assert.equal(endpointProblem({ PUSH_TEST_ENDPOINT_ORIGIN: "http://127.0.0.1:9999" }, "http://127.0.0.1:9999/p/1"), "");
  assert.equal(subscriptionKeysProblem(V.uaPublic, V.auth), "");
  assert.notEqual(subscriptionKeysProblem(V.uaPublic.slice(0, 20), V.auth), "");
  assert.notEqual(subscriptionKeysProblem(V.uaPublic, "abc"), "");
});

test("lock-screen text: pickup time and area, never rider name or phone", () => {
  assert.equal(pickupWhen("2026-11-20", "09:30"), "Fri Nov 20, 9:30 AM");
  assert.equal(pickupWhen("2026-11-21", "00:05"), "Sat Nov 21, 12:05 AM");
  assert.equal(pickupWhen("2026-11-21", "13:00"), "Sat Nov 21, 1:00 PM");
  assert.equal(pickupArea("123 Main St, Atlanta, GA 30303"), "Atlanta, GA");
  assert.equal(pickupArea("55 Peachtree St"), "Peachtree St");
  assert.equal(pickupArea("ATL Airport"), "ATL Airport");
  assert.equal(pickupArea("400 W Peachtree St NW, Atlanta"), "Atlanta");
  assert.equal(pickupArea("Ritz-Carlton Buckhead, Atlanta"), "Ritz-Carlton Buckhead");
  const ride = { id: "11111111-2222-4333-8444-555555555555", pickup_date: "2026-11-20", pickup_time: "09:30", pickup: "123 Main St, Atlanta, GA 30303", client_name: "Avery Cole", client_phone: "404-555-0199" };
  const p = rideAlertPayload("assigned", ride, "Fleet A");
  assert.equal(p.title, "New ride assigned");
  assert.equal(p.body, "Pickup Fri Nov 20, 9:30 AM · Atlanta, GA");
  assert.equal(p.tag, "ride-" + ride.id);
  assert.equal(p.url, "/#/rides/" + ride.id);
  assert.equal(p.requireInteraction, true);
  assert.equal(JSON.stringify(p).includes("555-0199"), false);
  assert.equal(JSON.stringify(p).includes("Avery"), false);
  assert.equal(JSON.stringify(p).includes("123 Main"), false);
  assert.equal(rideAlertPayload("cancelled", ride).title, "Ride cancelled");
  assert.equal(rideAlertPayload("unassigned", ride).url, "/#/rides");
  assert.equal(rideAlertPayload("test", {}).kind, "test");
});
