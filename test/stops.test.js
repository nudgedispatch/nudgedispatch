import assert from "node:assert/strict";
import test from "node:test";
import { readStops, stopsToStored, parseStoredStops, stopLines, stopsCell, MAX_STOPS, STOP_MAX_LENGTH } from "../app/stops.js";

test("readStops: missing, null, empty mean no stops", () => {
  assert.deepEqual(readStops(undefined), { stops: [] });
  assert.deepEqual(readStops(null), { stops: [] });
  assert.deepEqual(readStops([]), { stops: [] });
  assert.deepEqual(readStops(""), { stops: [] });
});

test("readStops: trims, drops blanks, keeps order, accepts {address}", () => {
  assert.deepEqual(readStops(["  12 Oak Ln ", "", "   ", { address: "Lenox Square" }, null]), { stops: ["12 Oak Ln", "Lenox Square"] });
  assert.deepEqual(readStops(["a\u0000b\nc"]), { stops: ["a b c"] });
});

test("readStops: at most 5 stops and 200 characters each", () => {
  assert.equal(MAX_STOPS, 5);
  assert.equal(STOP_MAX_LENGTH, 200);
  assert.deepEqual(readStops(["1", "2", "3", "4", "5"]).stops.length, 5);
  assert.match(readStops(["1", "2", "3", "4", "5", "6"]).error, /up to 5 stops/);
  assert.match(readStops(new Array(11).fill("x")).error, /up to 5 stops/);
  assert.deepEqual(readStops(["x".repeat(200)]).stops, ["x".repeat(200)]);
  assert.match(readStops(["x".repeat(201)]).error, /200 characters/);
});

test("readStops: rejects non-lists and non-address values", () => {
  assert.match(readStops("12 Oak Ln").error, /list/);
  assert.match(readStops({ 0: "a" }).error, /list/);
  assert.match(readStops([["nested"]]).error, /address/);
  assert.match(readStops([true]).error, /address/);
});

test("stored stops round-trip and tolerate bad JSON", () => {
  assert.equal(stopsToStored([]), null);
  assert.equal(stopsToStored(null), null);
  assert.equal(stopsToStored(["A", "B"]), '["A","B"]');
  assert.deepEqual(parseStoredStops('["A","B"]'), ["A", "B"]);
  assert.deepEqual(parseStoredStops(null), []);
  assert.deepEqual(parseStoredStops("not json"), []);
  assert.deepEqual(parseStoredStops('{"a":1}'), []);
  assert.deepEqual(parseStoredStops('["A", 3, "", "B", "C", "D", "E", "F"]'), ["A", "B", "C", "D", "E"]);
});

test("stop text helpers", () => {
  assert.deepEqual(stopLines(["A", "B"]), ["Stop 1: A", "Stop 2: B"]);
  assert.deepEqual(stopLines([]), []);
  assert.equal(stopsCell(["A", "B"]), "1) A | 2) B");
  assert.equal(stopsCell([]), "");
});
