import assert from "node:assert/strict";
import test from "node:test";
import { readBlandCall, parseCall, structuredFields, callTurns, readBack, normalizeWhen, emptyCall, voiceIntake } from "../app/voice-intake.js";
import { inboundCall, agentCall, FLEET_NUMBER } from "./fixtures/bland-voice.js";

// Thursday Nov 19, 2026, 2:15 PM Eastern.
const NOW = Date.parse("2026-11-19T19:15:00Z");
const ours = (n) => n === FLEET_NUMBER;

test("readBlandCall: inbound call to our number", () => {
  const c = readBlandCall(inboundCall(), ours);
  assert.equal(c.ignore, undefined);
  assert.equal(c.ours, FLEET_NUMBER);
  assert.equal(c.caller, "+14045550123");
  assert.equal(c.callLengthMin, 2.4);
  assert.match(c.recordingUrl, /^https:\/\//);
  assert.equal(c.turns.length, 10, "agent-action lines are dropped");
});

test("readBlandCall: ignores outbound, unknown number, missing id, other events", () => {
  assert.equal(readBlandCall(inboundCall({ inbound: false }), ours).ignore, "not an inbound call");
  assert.equal(readBlandCall(inboundCall({ to: "+14045550999" }), ours).ignore, "unknown number");
  assert.equal(readBlandCall(inboundCall({ call_id: "", c_id: "" }), ours).ignore, "no call id");
  assert.match(readBlandCall({ ...inboundCall(), event_type: "call_started" }, ours).ignore, /^event/);
  assert.equal(readBlandCall("x", ours).ignore, "not an object");
  assert.equal(readBlandCall(inboundCall({ recording_url: "http://insecure.example/r.mp3" }), ours).recordingUrl, "");
});

test("readBlandCall: disposition follow-up event", () => {
  const c = readBlandCall({ event_type: "dispositions", call_id: "agent000-1111", agent_dispositions: [{ payload: { pickup_time: "7:00 PM" } }] }, ours);
  assert.equal(c.followUp, true);
  assert.equal(c.fields.time, "7:00 PM");
});

test("structuredFields: dispositions first, ignores Bland system variables", () => {
  const f = structuredFields(agentCall());
  assert.equal(f.pickup, "Four Seasons Atlanta, 75 14th St NE");
  assert.equal(f.passengers, 2);
  assert.equal(f.luggage, 3);
  assert.equal(f.confirmed, true);
  assert.equal(f.needsCallback, false);
  // System variables (now, from, to, phone_number, call_id) never become fields.
  assert.deepEqual(structuredFields(inboundCall()), {});
  assert.deepEqual(structuredFields({ variables: { name: "x", date: "today", pickup_address: "unknown" } }), {});
  assert.equal(structuredFields({ variables: { pickup_address: "1 Main St", rider_name: "Al" } }).name, "Al");
  assert.equal(structuredFields({ analysis: { pickup: "Hotel", time: "noon" } }).time, "noon");
});

test("callTurns: concatenated transcript fallback", () => {
  const t = callTurns({ concatenated_transcript: "assistant: Hi \n user: I need a ride \n agent-action: Ended call \n" });
  assert.deepEqual(t.map((x) => x.who), ["agent", "caller"]);
});

test("readBack: labeled confirmation line", () => {
  const rb = readBack(callTurns(inboundCall()));
  assert.equal(rb.pickup, "ATL Domestic Terminal");
  assert.equal(rb.dropoff, "3500 Lenox Rd NE, Atlanta");
  assert.equal(rb.date, "tomorrow");
  assert.equal(rb.time, "8:15 PM");
  assert.equal(rb.name, "Dana Lee");
  assert.equal(rb.callback, "(404) 555-0123");
  assert.equal(rb.passengers, 1);
  assert.deepEqual(readBack([{ who: "caller", text: "To confirm: Pickup: x." }]), {});
});

test("normalizeWhen: ISO, words, 24h, missing AM/PM", () => {
  assert.deepEqual(normalizeWhen("2026-11-21", "06:40", NOW), { date: "2026-11-21", time: "06:40", timeAssumed: false, dateExplicit: true, warnings: [] });
  const fri = normalizeWhen("Friday", "6:40 AM", NOW);
  assert.equal(fri.date, "2026-11-20");
  assert.equal(fri.time, "06:40");
  const t = normalizeWhen("tomorrow", "8:15", NOW);
  assert.equal(t.time, "08:15");
  assert.equal(t.timeAssumed, true);
  const passed = normalizeWhen("", "9:00 AM", NOW);
  assert.equal(passed.date, "2026-11-20", "time already passed today rolls to tomorrow");
  assert.match(normalizeWhen("2026-11-01", "10:00", NOW).warnings[0], /past/);
});

test("parseCall: read-back call fills every field", () => {
  const call = readBlandCall(inboundCall(), ours);
  const p = parseCall(call, { now: NOW });
  assert.equal(p.date, "2026-11-20");
  assert.equal(p.time, "20:15");
  assert.equal(p.pickup, "ATL Domestic Terminal");
  assert.equal(p.dropoff, "3500 Lenox Rd NE, Atlanta");
  assert.equal(p.name, "Dana Lee");
  assert.equal(p.flight, "DL1742");
  assert.equal(p.callbackNumber, "+14045550123");
  assert.equal(p.callbackDiffers, false);
  assert.equal(p.confirmed, true);
  assert.equal(p.fieldSource.pickup, "readback");
  assert.ok(!p.warnings.some((w) => /missing|No time/.test(w)), p.warnings.join("|"));
});

test("parseCall: Bland Agents dispositions win, callback differs", () => {
  const call = readBlandCall(agentCall(), ours);
  const p = parseCall(call, { now: NOW });
  assert.equal(p.pickup, "Four Seasons Atlanta, 75 14th St NE");
  assert.equal(p.dropoff, "PDK (Peachtree-DeKalb)");
  assert.equal(p.date, "2026-11-20");
  assert.equal(p.time, "06:40");
  assert.equal(p.passengers, 2);
  assert.equal(p.name, "Marcus Green");
  assert.equal(p.notes, "Child seat please");
  assert.equal(p.callbackNumber, "+14045550146");
  assert.equal(p.callbackDiffers, true);
  assert.equal(p.fieldSource.pickup, "bland");
  assert.ok(p.warnings.includes("Callback number is different from caller ID."));
});

test("parseCall: transcript-only fallback uses the text parser and flags it", () => {
  const call = readBlandCall(inboundCall({
    transcripts: [
      { user: "assistant", text: "Where should we pick you up?" },
      { user: "user", text: "Pick me up at 1200 Peachtree St NE" },
      { user: "assistant", text: "Where to, and when?" },
      { user: "user", text: "Going to 400 Colony Square, today at 5:30 pm" },
    ], summary: "",
  }), ours);
  const p = parseCall(call, { now: NOW });
  assert.equal(p.pickup, "1200 Peachtree St NE");
  assert.equal(p.dropoff, "400 Colony Square");
  assert.equal(p.time, "17:30");
  assert.equal(p.date, "2026-11-19");
  assert.equal(p.fieldSource.pickup, "transcript");
  assert.ok(p.warnings.some((w) => /did not confirm/.test(w)));
});

test("parseCall: callback request and hidden caller ID", () => {
  const call = readBlandCall(inboundCall({
    from: "anonymous", summary: "Caller wants the owner to call about a lost bag.",
    transcripts: [{ user: "user", text: "I left a bag in the car yesterday, I want the owner to call me about it" }],
    analysis: { needs_callback: true, callback_number: "404 555 0177", rider_name: "Pat" },
  }), ours);
  const p = parseCall(call, { now: NOW });
  assert.equal(p.needsCallback, true);
  assert.equal(p.callbackNumber, "+14045550177");
  assert.equal(p.warnings[0], "The caller may not have asked for a ride. Listen to the call.");
  assert.ok(p.warnings.includes("Caller asked for a call back from the owner."));
  assert.ok(p.warnings.some((w) => /Caller ID was hidden/.test(w)));
  assert.equal(p.dropoff, "", "\"call me\" is not a drop-off");
  assert.equal(p.name, "Pat");
  assert.equal(emptyCall(call, p), false);
});

test("emptyCall: hang-up with no words makes no draft", () => {
  const call = readBlandCall(inboundCall({ transcripts: [{ user: "assistant", text: "Thanks for calling. Where should we pick you up?" }], summary: "" }), ours);
  assert.equal(emptyCall(call, parseCall(call, { now: NOW })), true);
});

test("voiceIntake: transcript trimmed, no secrets or payment fields", () => {
  const long = Array.from({ length: 200 }, (_, i) => ({ user: i % 2 ? "user" : "assistant", text: "x".repeat(100) }));
  const call = readBlandCall(inboundCall({ transcripts: long }), ours);
  const it = voiceIntake(call, parseCall(call, { now: NOW }));
  assert.equal(it.channel, "voice");
  assert.ok(it.transcript.length <= 60);
  assert.ok(it.transcript.reduce((n, t) => n + t.text.length, 0) <= 6000);
  assert.equal(it.callId, call.callId);
});
