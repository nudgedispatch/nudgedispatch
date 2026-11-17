import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = fs.readFileSync(join(root, "app/client-app.txt"), "utf8");
const start = client.indexOf("/* air-save-logic-start */");
const end = client.indexOf("/* air-save-logic-end */");
assert.ok(start >= 0 && end > start, "air-save logic markers should be present");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(client.slice(start, end) + "\nthis.airSaveBody = airSaveBody; this.AIR_SAVED = AIR_SAVED;", sandbox);
const { airSaveBody, AIR_SAVED } = sandbox;
const plain = (v) => JSON.parse(JSON.stringify(v));
const settings = { capacities: { sedan: 3, suv: 6 }, flightRules: { earlyMinutes: 15, delayMinutes: 30, minChangeMinutes: 5 } };

test("Save sends the sedan limit and early-alert minutes, keeping other settings", () => {
  assert.deepEqual(plain(airSaveBody("save", settings, "4", "25")), {
    body: { capacities: { sedan: 4, suv: 6 }, flightRules: { earlyMinutes: 25, delayMinutes: 30, minChangeMinutes: 5 } },
  });
});

test("ATL preset and turn-off send their own bodies", () => {
  assert.deepEqual(plain(airSaveBody("preset", settings)), { body: { preset: ["ATL"] } });
  assert.deepEqual(plain(airSaveBody("off", settings)), { body: { airports: { airports: [] } } });
});

test("a blank or bad sedan limit is caught before saving with a visible message", () => {
  for (const bad of ["", " ", "0", "2.5", "abc", "57"]) {
    const r = airSaveBody("save", settings, bad, "15");
    assert.ok(r.error && !r.body, `expected an error for ${JSON.stringify(bad)}`);
  }
});

test("every save path has a success message, and the card renders it", () => {
  for (const kind of ["preset", "off", "save"]) assert.ok(AIR_SAVED[kind] && /Saved/.test(AIR_SAVED[kind]));
  const fn = client.slice(client.indexOf("async function renderAirportSettings(gen, notice)"), client.indexOf("// Regular client schedules."));
  assert.match(fn, /id="air-msg" role="status"/);
  assert.match(fn, /renderAirportSettings\(gen, AIR_SAVED\[kind\]\)/);
  assert.match(fn, /b\.disabled = true/);
  assert.match(fn, /Save airport settings/);
});
