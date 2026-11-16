import assert from "node:assert/strict";
import test from "node:test";
import {
  daysInMonth, isLeapYear, addDays, weekdayOf, todayInZone, ordinal, readMonthDays, readWeekDays, readSchedule, matchDate,
  occurrencesBetween, pendingOccurrences, describeSchedule, monthEndNote, parseDayList, LAST_DAY, DEFAULT_LOOKAHEAD_DAYS,
} from "../app/schedules.js";

const sched = (over = {}) => ({ monthDays: [], weekDays: [], startDate: "2026-01-01", endDate: null, lookaheadDays: 14, active: true, ...over });
const dates = (list) => list.map((o) => o.date);

test("calendar basics: leap years, month lengths, addDays across month/year ends", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2100), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekdayOf("2026-11-16"), 1);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
});

test("the 31st falls back to the last day in shorter months, and says so", () => {
  const s = sched({ monthDays: [31] });
  const hits = occurrencesBetween(s, "2026-01-01", "2026-12-31");
  assert.deepEqual(dates(hits), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"]);
  assert.equal(hits[0].lastDayFallback, false);
  assert.equal(hits[0].note, "");
  assert.equal(hits[1].lastDayFallback, true);
  assert.match(hits[1].note, /Last day of Feb \(no 31st this month\)/);
  assert.match(hits[3].note, /Last day of Apr/);
});

test("the 29th and 30th in February, leap and non-leap", () => {
  const s = sched({ monthDays: [29, 30], startDate: "2026-01-01" });
  assert.deepEqual(dates(occurrencesBetween(s, "2026-02-01", "2026-03-31")), ["2026-02-28", "2026-03-29", "2026-03-30"]);
  const feb26 = matchDate(s, "2026-02-28");
  assert.match(feb26.note, /no 29th or 30th/);
  const leap = occurrencesBetween(s, "2028-02-01", "2028-02-29");
  assert.deepEqual(dates(leap), ["2028-02-29"], "29th exists in a leap year; the 30th lands on the same day, once");
  assert.equal(leap[0].lastDayFallback, false);
  assert.equal(leap[0].note, "", "the 29th is a real date that month, so no fallback note");
  // Exact 30th in April: no fallback note even though the 31st is also picked.
  const both = matchDate(sched({ monthDays: [30, 31] }), "2026-04-30");
  assert.equal(both.note, "");
});

test("'last' means the last day of every month", () => {
  const s = sched({ monthDays: [1, 15, LAST_DAY] });
  assert.deepEqual(dates(occurrencesBetween(s, "2028-02-01", "2028-03-01")), ["2028-02-01", "2028-02-15", "2028-02-29", "2028-03-01"]);
  assert.equal(matchDate(s, "2026-02-28").note, "Last day of the month");
  assert.equal(matchDate(s, "2026-02-27"), null);
});

test("weekly days combine with month days; a date that matches both appears once", () => {
  const s = sched({ monthDays: [16], weekDays: [1, 4] });
  assert.deepEqual(dates(occurrencesBetween(s, "2026-11-15", "2026-11-22")), ["2026-11-16", "2026-11-19"], "Nov 16 2026 is a Monday and the 16th");
});

test("start and end dates bound the occurrences", () => {
  const s = sched({ weekDays: [1], startDate: "2026-11-10", endDate: "2026-11-30" });
  assert.deepEqual(dates(occurrencesBetween(s, "2026-11-01", "2026-12-31")), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.equal(matchDate(s, "2026-11-09"), null);
  assert.equal(matchDate(s, "2026-12-07"), null);
});

test("DST: dates are wall-calendar dates, so the change weekends neither skip nor repeat a day", () => {
  const daily = sched({ weekDays: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(dates(occurrencesBetween(daily, "2026-03-07", "2026-03-09")), ["2026-03-07", "2026-03-08", "2026-03-09"]);
  assert.deepEqual(dates(occurrencesBetween(daily, "2026-10-31", "2026-11-02")), ["2026-10-31", "2026-11-01", "2026-11-02"]);
  // "Today" in New York at instants around both changes.
  assert.equal(todayInZone(Date.parse("2026-03-08T06:59:00Z")), "2026-03-08"); // 1:59 AM EST
  assert.equal(todayInZone(Date.parse("2026-03-08T04:59:00Z")), "2026-03-07"); // 11:59 PM EST the night before
  assert.equal(todayInZone(Date.parse("2026-11-01T04:30:00Z")), "2026-11-01"); // 12:30 AM EDT
  assert.equal(todayInZone(Date.parse("2026-11-01T03:59:00Z")), "2026-10-31"); // 11:59 PM EDT
  assert.equal(todayInZone(Date.parse("2026-11-02T04:59:00Z")), "2026-11-01"); // 11:59 PM EST
  assert.equal(todayInZone(Date.parse("2026-11-02T05:00:00Z")), "2026-11-02"); // midnight EST
});

test("pending occurrences: lookahead window, handled dates removed, paused shows nothing", () => {
  const s = sched({ monthDays: [1, 15], weekDays: [], lookaheadDays: 20 });
  assert.deepEqual(dates(pendingOccurrences(s, "2026-11-16")), ["2026-12-01"]);
  assert.deepEqual(dates(pendingOccurrences({ ...s, lookaheadDays: 30 }, "2026-11-16")), ["2026-12-01", "2026-12-15"]);
  assert.deepEqual(dates(pendingOccurrences({ ...s, lookaheadDays: 30 }, "2026-11-16", new Set(["2026-12-01"]))), ["2026-12-15"], "a confirmed or skipped date never comes back");
  assert.deepEqual(pendingOccurrences({ ...s, active: false }, "2026-11-16"), []);
  assert.deepEqual(dates(pendingOccurrences(sched({ weekDays: [1] }), "2026-11-16")), ["2026-11-16", "2026-11-23", "2026-11-30"], "today counts; default 14 days ahead");
});

test("readMonthDays / readWeekDays validation", () => {
  assert.deepEqual(readMonthDays([15, "1", "last", 15, -1]), { days: [1, 15, LAST_DAY] });
  assert.match(readMonthDays([0]).error, /1 to 31/);
  assert.match(readMonthDays([32]).error, /1 to 31/);
  assert.match(readMonthDays("1,15").error, /list/);
  assert.deepEqual(readWeekDays([4, "1", 4]), { days: [1, 4] });
  assert.match(readWeekDays([7]).error, /0 \(Sun\)/);
  assert.deepEqual(parseDayList("not json", "month"), []);
  assert.deepEqual(parseDayList("[31,-1,99]", "month"), [], "a bad stored list reads as empty");
});

test("readSchedule: required fields, defaults, cleaning, and limits", () => {
  const base = { clientId: "11111111-1111-4111-8111-111111111111", monthDays: [1, 15], time: "05:30", pickup: " 100 Main\nSt ", dropoff: "ATL", startDate: "2026-11-16" };
  const ok = readSchedule(base);
  assert.ok(ok.fields, ok.error);
  assert.equal(ok.fields.pickup, "100 Main St");
  assert.equal(ok.fields.month_days, "[1,15]");
  assert.equal(ok.fields.week_days, "[]");
  assert.equal(ok.fields.fare_cents, null);
  assert.equal(ok.fields.lookahead_days, DEFAULT_LOOKAHEAD_DAYS);
  assert.equal(ok.fields.active, 1);
  assert.equal(ok.fields.stops_json, null);
  assert.equal(readSchedule({ ...base, fare: "$1,250.50" }).fields.fare_cents, 125050);
  assert.match(readSchedule({ ...base, monthDays: [], weekDays: [] }).error, /at least one/);
  assert.match(readSchedule({ ...base, time: "25:00" }).error, /time/);
  assert.match(readSchedule({ ...base, clientId: "x" }).error, /client/);
  assert.match(readSchedule({ ...base, endDate: "2026-11-01" }).error, /on or after/);
  assert.match(readSchedule({ ...base, startDate: "2026-02-30" }).error, /start date/);
  assert.match(readSchedule({ ...base, fare: "abc" }).error, /fare/);
  assert.match(readSchedule({ ...base, passengers: 15 }).error, /1 to 14/);
  assert.match(readSchedule({ ...base, lookaheadDays: 61 }).error, /1 and 60/);
  assert.match(readSchedule({ ...base, stops: ["1", "2", "3", "4", "5", "6"] }).error, /up to 5/);
  assert.match(readSchedule({ ...base, driverUserId: "<script>" }).error, /driver/);
  assert.equal(readSchedule({ ...base, active: false }).fields.active, 0);
  assert.equal(readSchedule({ ...base, flight: "dl123" }).fields.flight, "DL123");
  // PATCH: missing keys come from the existing schedule.
  const existing = { clientId: base.clientId, monthDays: [31], weekDays: [], time: "06:00", pickup: "A", dropoff: "B", stops: ["S"], passengers: 2, flight: "", notes: "n", label: "", fareCents: 9000, driverUserId: null, startDate: "2026-11-01", endDate: null, lookaheadDays: 21, active: true };
  const patched = readSchedule({ active: false }, existing);
  assert.equal(patched.fields.active, 0);
  assert.equal(patched.fields.fare_cents, 9000);
  assert.equal(patched.fields.month_days, "[31]");
  assert.equal(patched.fields.stops_json, JSON.stringify(["S"]));
  assert.equal(patched.fields.lookahead_days, 21);
  assert.equal(readSchedule({ fare: "" }, existing).fields.fare_cents, null, "blank fare clears the default");
});

test("describeSchedule and monthEndNote", () => {
  assert.equal(describeSchedule(sched({ monthDays: [1, 15, LAST_DAY] })), "Monthly on the 1st, 15th and last day");
  assert.equal(describeSchedule(sched({ weekDays: [1, 4] })), "Weekly on Mon, Thu");
  assert.equal(describeSchedule(sched({ monthDays: [31], weekDays: [5] })), "Monthly on the 31st \u00b7 Weekly on Fri");
  assert.equal(monthEndNote(sched({ monthDays: [1, 15] })), "");
  assert.equal(monthEndNote(sched({ monthDays: [30, 31] })), "Months without the 30th, 31st use the last day of the month instead.");
});
