import assert from "node:assert/strict";
import test from "node:test";
import { driverFields, isRosterEmail, passcodeProblem, rosterEmailFor } from "../app/drivers.js";

test("a driver needs a name and keeps vehicle and plate optional", () => {
  assert.equal(driverFields({}).error, "Enter the driver name.");
  assert.equal(driverFields({ name: "   " }).error, "Enter the driver name.");
  const named = driverFields({ name: "  Sam   Lee  " });
  assert.equal(named.error, "");
  assert.equal(named.name, "Sam Lee");
  assert.equal(named.vehicle, "");
  assert.equal(named.plate, "");
});

test("driver name, vehicle, and plate stay within a sane length", () => {
  assert.match(driverFields({ name: "A".repeat(81) }).error, /80/);
  assert.match(driverFields({ name: "Sam", vehicle: "V".repeat(41) }).error, /40/);
  assert.match(driverFields({ name: "Sam", plate: "A".repeat(13) }).error, /12/);
  const ok = driverFields({ name: "Sam Lee", vehicle: "Black SUV", plate: "atl 1042" });
  assert.equal(ok.error, "");
  assert.equal(ok.vehicle, "Black SUV");
  assert.equal(ok.plate, "ATL 1042");
  assert.match(driverFields({ name: "Sam", plate: "!!" }).error, /letters and numbers/);
});

test("a passcode is 4 to 32 letters or numbers and is not the driver name", () => {
  assert.match(passcodeProblem("ab1", "Sam"), /4 to 32/);
  assert.match(passcodeProblem("samlee", "Sam Lee"), /not the driver's name/);
  assert.equal(passcodeProblem("  lake48  ", "Sam Lee"), "");
  assert.match(passcodeProblem("has space", "Sam"), /4 to 32/);
});

test("roster sign-in addresses are not real mailboxes", () => {
  const email = rosterEmailFor("99999999-9999-4999-8999-999999999999");
  assert.equal(isRosterEmail(email), true);
  assert.equal(isRosterEmail("driver@example.test"), false);
});
