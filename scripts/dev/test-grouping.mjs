// Tests for folding finished match days into weeks / months / years (src/lib/grouping.js).  npm test
import assert from "node:assert/strict";
import { groupFinished, groupKeys, holds, weekOf } from "../../src/lib/grouping.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const rc = (key, won = 1, settled = 2, profit = null) => ({ key, picks: [{}, {}], settled, won, profit });
const days = (...keys) => keys.map((k) => rc(k)), shape = (nodes) => nodes.map((x) => (x.type === "day" ? x.r.key : { [x.level]: x.children.map((c) => (c.type === "day" ? c.r.key : c.level)) }));

t("weekOf: Monday-based, cut at the month's edges", () => {
  assert.equal(weekOf("2026-11-04").key, "w2026-11-02");   // Wed -> Mon 2 Nov
  assert.equal(weekOf("2026-11-01").key, "w2026-11-01");   // Sun 1 Nov: its Monday is in October, so the week starts at the 1st
  assert.equal(weekOf("2026-11-30").key, "w2026-11-30");   // Mon 30 Nov: the week is cut at month end
  assert.equal(weekOf("2026-10-27").key, "w2026-10-26");
});

t("the last 7 days stay single days; older days of this month become weeks", () => {
  const out = groupFinished(days("2026-11-23", "2026-11-17", "2026-11-16", "2026-11-12", "2026-11-09", "2026-11-03"), "2026-11-24");
  assert.deepEqual(shape(out), ["2026-11-23", "2026-11-17", { week: ["2026-11-16"] }, { week: ["2026-11-12", "2026-11-09"] }, { week: ["2026-11-03"] }]);
});

t("week labels: Monday to Sunday, 16 Nov starts a new week", () => {
  const out = groupFinished(days("2026-11-16", "2026-11-12", "2026-11-10"), "2026-11-24");
  const L = (k) => new Date(k + "T00:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });   // labels follow the viewer's locale ("Nov 16" or "16 Nov")
  assert.deepEqual(out.map((x) => [x.label, x.children.length]), [[`${L("2026-11-16")} – ${L("2026-11-22")}`, 1], [`${L("2026-11-09")} – ${L("2026-11-15")}`, 2]]);
  assert.equal(groupFinished(days("2026-11-30"), "2026-12-24")[0].children[0].label, L("2026-11-30"), "Mon 30 Nov is a one-day week (cut at month end): a single date");
});

t("earlier months of this year: month > week > day; earlier years: year > month > week > day", () => {
  const out = groupFinished(days("2026-11-23", "2026-10-30", "2026-10-02", "2025-12-31", "2025-06-15", "2024-01-01"), "2026-11-24");
  assert.equal(out[0].type, "day");
  assert.deepEqual([out[1].level, out[1].children.map((c) => c.level), out[1].stats.days], ["month", ["week", "week"], 2]);
  assert.deepEqual(out.slice(2).map((x) => [x.level, x.label]), [["year", "2025"], ["year", "2024"]]);
  assert.deepEqual(out[2].children.map((m) => m.level), ["month", "month"]);
  assert.equal(out[2].stats.days, 2);
});

t("group stats add up the days inside", () => {
  const out = groupFinished([rc("2026-10-05", 3, 4, 2.5), rc("2026-10-20", 1, 2, -1), rc("2026-10-21", 0, 1, null)], "2026-11-24"), m = out[0].stats;
  assert.deepEqual([m.days, m.picks, m.settled, m.won, m.profit], [3, 6, 7, 4, 1.5]);
  assert.equal(groupFinished([rc("2026-10-21", 0, 1, null)], "2026-11-24")[0].stats.profit, null);
});

t("a group never appears twice; keys are unique; holds() finds a day", () => {
  const out = groupFinished(days("2026-10-30", "2026-10-29", "2026-10-02", "2025-10-02", "2025-10-01"), "2026-11-24"), ks = groupKeys(out);
  assert.equal(new Set(ks).size, ks.length); assert.equal(out.length, 2);
  assert.ok(holds(out[0], "2026-10-02") && !holds(out[0], "2025-10-02") && holds(out[1], "2025-10-01"));
});

t("boundaries: exactly 7 days back is a single day, 8 days back is grouped; a new year does not break", () => {
  const out = groupFinished(days("2026-11-17", "2026-11-16"), "2026-11-24"); assert.deepEqual([out[0].type, out[1].type], ["day", "group"]);
  const j = groupFinished(days("2026-01-02", "2025-12-31", "2025-12-20"), "2026-01-05"); assert.deepEqual([j[0].type, j[1].type, j[2].level], ["day", "day", "year"]);
  assert.deepEqual(groupFinished([], "2026-11-24"), []);
});

console.log(`\n${n} grouping tests passed`);
