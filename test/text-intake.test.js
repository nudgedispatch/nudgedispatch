import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseRideText, mergeParsed, draftWarnings, readBlandInbound, suggestDriver, verifyBlandSignature, e164, prettyPhone } from "../app/text-intake.js";

// Tue Nov 17, 2026 3:30 PM Eastern.
const NOW = Date.parse("2026-11-17T15:30:00-05:00");
const ATL = [{ code: "ATL", name: "ATL Airport", spots: [{ id: "dom", label: "Domestic Terminal" }, { id: "intl", label: "International Terminal" }] }];
const parse = (t, airports = ATL) => parseRideText(t, { now: NOW, airports });

test("sample: landing ATL 8:15 DL1742", () => {
  const p = parse("landing ATL 8:15 DL1742");
  assert.equal(p.flight, "DL1742");
  assert.equal(p.direction, "arrival");
  assert.equal(p.airport.code, "ATL");
  assert.equal(p.date, "2026-11-17");
  assert.equal(p.time, "20:15", "8:15 with no am/pm after 3:30 PM is tonight");
  assert.equal(p.timeAssumed, true);
  assert.equal(p.pickup, "ATL Airport");
  assert.equal(p.dropoff, "");
  assert.ok(p.warnings.some((w) => /AM\/PM/.test(w)));
  assert.ok(p.warnings.some((w) => /Drop-off/.test(w)));
  assert.ok(p.warnings.some((w) => /Terminal/.test(w)));
});

test("sample: name, international terminal, airline name, drop-off address", () => {
  const p = parse("Hey its Marcus, landing ATL international tomorrow 6:40am on Delta 52, going to 1200 Peachtree St NE");
  assert.equal(p.name, "Marcus");
  assert.equal(p.flight, "DL52");
  assert.equal(p.date, "2026-11-18");
  assert.equal(p.time, "06:40");
  assert.equal(p.pickup, "ATL · International Terminal");
  assert.equal(p.dropoff, "1200 Peachtree St NE");
  assert.deepEqual(p.warnings, []);
});

test("sample: departure with pickup address, weekday, passengers, bags", () => {
  const p = parse("Flying out of ATL friday at 7am, pick me up from 45 Main St Alpharetta. 2 people 3 bags");
  assert.equal(p.direction, "departure");
  assert.equal(p.date, "2026-11-20");
  assert.equal(p.time, "07:00");
  assert.equal(p.pickup, "45 Main St Alpharetta");
  assert.equal(p.dropoff, "ATL Airport");
  assert.equal(p.passengers, 2);
  assert.equal(p.luggage, 3);
  assert.ok(p.warnings.some((w) => /flight time/.test(w)));
});

test("sample: to the airport with signature name", () => {
  const p = parse("need a ride to the airport tomorrow 5:30am from 100 Oak Ln, Roswell - Tina");
  assert.equal(p.direction, "departure");
  assert.equal(p.pickup, "100 Oak Ln, Roswell");
  assert.equal(p.name, "Tina");
  assert.equal(p.time, "05:30");
});

test("sample: compact time 815pm, spaced flight, terminal word, airport assumed", () => {
  const p = parse("landing at 815pm AA 2210 domestic");
  assert.equal(p.time, "20:15");
  assert.equal(p.timeAssumed, false);
  assert.equal(p.flight, "AA2210");
  assert.equal(p.pickup, "ATL · Domestic Terminal");
  assert.ok(p.warnings.some((w) => /assumed ATL/.test(w)));
});

test("sample: numeric date, pm, signed full name", () => {
  const p = parse("Can you pick me up at ATL 11/20 at 3:15 pm? UA 1189. Thanks! -Jen Park");
  assert.equal(p.date, "2026-11-20");
  assert.equal(p.time, "15:15");
  assert.equal(p.flight, "UA1189");
  assert.equal(p.name, "Jen Park");
  assert.equal(p.direction, "arrival");
});

test("sample: passed time with no date rolls to tomorrow", () => {
  const p = parse("landing ATL 9:05am DL 300");
  assert.equal(p.date, "2026-11-18");
  assert.equal(p.time, "09:05");
});

test("not a ride: no flight, airport, or time", () => {
  const p = parse("what's up man");
  assert.equal(p.looksLikeRide, false);
  assert.equal(p.flight, "");
});

test("words that look like flight codes are not flights", () => {
  assert.equal(parse("IN 20 minutes at the hotel").flight, "");
  assert.equal(parse("AT 8 tonight").flight, "");
});

test("follow-up text fills blanks only and clears warnings", () => {
  const first = parse("landing ATL 8:15 DL1742");
  const second = parse("Domestic. going to 3500 Lenox Rd NE");
  const merged = mergeParsed(first, second);
  assert.equal(merged.flight, "DL1742");
  assert.equal(merged.airport.spot, "Domestic Terminal");
  assert.equal(merged.pickup, "ATL · Domestic Terminal");
  assert.equal(merged.dropoff, "3500 Lenox Rd NE");
  const w = draftWarnings(merged);
  assert.ok(!w.some((x) => /Drop-off/.test(x)));
  assert.ok(!w.some((x) => /Terminal/.test(x)));
});

test("Bland payloads: inbound user message, agent echo, status, unknown number", () => {
  const ours = (n) => n === "+14406442454";
  const ok = readBlandInbound({ conversation_id: "c1", to: "+14406442454", from: "+14045550123", channel: "sms", sender: "USER", message: "landing ATL 8:15" }, ours);
  assert.equal(ok.ours, "+14406442454");
  assert.equal(ok.client, "+14045550123");
  assert.equal(ok.body, "landing ATL 8:15");
  // to/from reversed is still read correctly.
  assert.equal(readBlandInbound({ to: "4045550123", from: "+1 (440) 644-2454", sender: "USER", message: "hi" }, ours).client, "+14045550123");
  assert.match(readBlandInbound({ to: "+14045550123", from: "+14406442454", sender: "AGENT", message: "hello" }, ours).ignore, /sender/);
  assert.match(readBlandInbound({ type: "status", status: "ended", phone_number: "+14045550123", agent_number: "+14406442454" }, ours).ignore, /status/);
  assert.match(readBlandInbound({ to: "+14045559999", from: "+14045550123", sender: "USER", message: "x" }, ours).ignore, /unknown number/);
  assert.match(readBlandInbound({ to: "+14406442454", from: "+14045550123", sender: "USER", message: "  " }, ours).ignore, /empty/);
});

test("suggestDriver: free at that time, fewest rides, owner only as fallback, nearby hook", () => {
  const people = [{ id: "o", name: "Owner", role: "owner" }, { id: "a", name: "Ana", role: "driver" }, { id: "b", name: "Ben", role: "driver" }];
  const draft = { date: "2026-11-17", time: "20:15" };
  const rides = [{ driverUserId: "a", date: "2026-11-17", time: "19:30" }, { driverUserId: "b", date: "2026-11-17", time: "09:00" }];
  const s = suggestDriver(people, rides, draft);
  assert.equal(s.id, "b", "Ana is busy within 2 h; Ben is free");
  assert.match(s.reason, /Free at that time/);
  assert.equal(suggestDriver(people, [], draft).id, "a", "tie broken by name");
  assert.equal(suggestDriver([{ id: "o", name: "Owner", role: "owner" }], [], draft).id, "o");
  assert.equal(suggestDriver(people, [...rides, { driverUserId: "b", date: "2026-11-17", time: "21:00" }], draft), null, "everyone busy");
  const near = suggestDriver(people, [], draft, { distanceKm: (id) => ({ a: 30, b: 4 })[id] });
  assert.equal(near.id, "b");
  assert.equal(near.strategy, "nearby");
});

test("Bland signature: HMAC-SHA256 hex of the raw body", async () => {
  const body = JSON.stringify({ message: "hi" });
  const sig = createHmac("sha256", "whsec_test").update(body).digest("hex");
  assert.equal(await verifyBlandSignature("whsec_test", body, sig), true);
  assert.equal(await verifyBlandSignature("whsec_test", body + " ", sig), false);
  assert.equal(await verifyBlandSignature("other", body, sig), false);
  assert.equal(await verifyBlandSignature("whsec_test", body, ""), false);
});

test("phone helpers", () => {
  assert.equal(e164("(440) 644-2454"), "+14406442454");
  assert.equal(e164("12345"), "");
  assert.equal(prettyPhone("+14045550123"), "(404) 555-0123");
});
