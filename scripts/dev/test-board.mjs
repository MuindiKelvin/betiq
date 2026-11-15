// Tests for the Live board (src/lib/board.js), durable finals, picks settling from live evidence, the sweep and the schedule builder.  npm test
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as L from "../lib/live.mjs";
import * as S from "../lib/schedule.mjs";
import { boardItems, boardView, dayKey, dayName, shiftDay, utcDaysFor } from "../../src/lib/board.js";
import { phaseOf } from "../../src/lib/phase.js";
import { pickWithLive } from "../../src/lib/pickstate.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const NOW = Date.parse("2026-11-14T10:00:00Z"), U = (iso) => Math.floor(Date.parse(iso) / 1000), iso = (ms) => new Date(ms).toISOString();
const byCode = { L1: { id: 1, code: "L1", name: "Premier League", country: "England" }, L9: { id: 9, code: "L9", name: "Alpha League", country: "Argentina" }, L64: { id: 64, code: "L64", name: "Nations League", country: "" }, L500: { id: 500, code: "L500", name: "Zed Cup", country: "Albania" } };
const doc = (o = {}) => ({ updated: iso(NOW - 20e3), mode: "live", pollS: 30, events: {}, left: {}, changes: {}, ...o });

t("dayKey / shiftDay / utcDaysFor: calendar days in any zone", () => {
  assert.equal(dayKey(U("2026-11-14T22:30:00Z"), "UTC"), "2026-11-14"); assert.equal(dayKey(U("2026-11-14T22:30:00Z"), "Africa/Nairobi"), "2026-11-15", "Nairobi is UTC+3: 01:30 next day");
  assert.equal(dayKey(U("2026-11-14T02:00:00Z"), "America/Los_Angeles"), "2026-11-13");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01"); assert.equal(shiftDay("2026-03-01", -1), "2026-02-28"); assert.deepEqual(utcDaysFor("2026-11-14"), ["2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.equal(dayName("2026-11-14", "2026-11-14"), "Today"); assert.equal(dayName("2026-11-13", "2026-11-14"), "Yesterday"); assert.equal(dayName("2026-11-15", "2026-11-14"), "Tomorrow");
});
t("a local day is always covered by the three UTC schedule days (every zone, every hour)", () => {
  for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "Africa/Nairobi", "America/Los_Angeles"]) for (let h = 0; h < 24 * 3; h++) {
    const ts = U("2026-11-13T00:00:00Z") + h * 3600, local = dayKey(ts, tz), utc = new Date(ts * 1000).toISOString().slice(0, 10);
    assert.ok(utcDaysFor(local).includes(utc), `${tz} ${iso(ts * 1000)}`);
  }
});

const rows = [
  { id: 1, c: "L1", h: 10, a: 11, t: U("2026-11-14T15:00:00Z"), s: "notstarted" }, { id: 2, c: "L1", h: 12, a: 13, t: U("2026-11-14T12:30:00Z"), s: "notstarted" },
  { id: 3, c: "L9", h: 20, a: 21, t: U("2026-11-14T08:00:00Z"), s: "finished", hg: 2, ag: 0 }, { id: 4, c: "L500", h: 30, a: 31, t: U("2026-11-14T09:00:00Z"), s: "notstarted" },
  { id: 5, c: "L64", h: 40, a: 41, t: U("2026-11-14T20:00:00Z"), s: "notstarted" }, { id: 6, c: "L9", h: 22, a: 23, t: U("2026-11-15T12:00:00Z"), s: "notstarted" },
  { id: 7, c: "L1", h: 14, a: 15, t: U("2026-11-14T09:00:00Z"), s: "postponed" },
];
t("board: day filter, competitions in FotMob order (top, international, then by country), matches by kick-off", () => {
  const items = boardItems({ rows, doc: doc(), finals: {}, nowMs: NOW, tz: "UTC" }), v = boardView({ items, day: "2026-11-14", filter: "all", byCode });
  assert.deepEqual(v.groups.map((g) => g.name), ["Premier League", "Nations League", "Zed Cup", "Alpha League"], "TOP competitions in list order (1, then 64), then the rest by country: Albania before Argentina");
  assert.deepEqual(v.groups[0].rows.map((x) => x.r.id), [7, 2, 1], "by kick-off time"); assert.equal(v.counts.all, 6, "the match on the 15th is not on the 14th");
  assert.equal(boardView({ items, day: "2026-11-15", filter: "all", byCode }).total, 1);
});
t("board: FT for played matches, live minute, upcoming, postponed; chips count correctly", () => {
  const d = doc({ events: { 2: { id: 2, hg: 1, ag: 0, min: 55, lg: 1 } } }), items = boardItems({ rows, doc: d, finals: {}, nowMs: NOW, tz: "UTC" }), by = (id) => items.find((x) => x.r.id === id).p.kind;
  assert.deepEqual([by(2), by(3), by(7), by(5)], ["live", "finished", "postponed", "upcoming"]);
  const v = boardView({ items, day: "2026-11-14", filter: "all", byCode }); assert.deepEqual([v.counts.live, v.counts.finished, v.counts.upcoming], [1, 1, 3], "upcoming = ids 1, 4 (kick-off passed, unconfirmed) and 5");
  assert.equal(boardView({ items, day: "2026-11-14", filter: "finished", byCode }).total, 1); assert.equal(boardView({ items, day: "2026-11-14", filter: "live", byCode }).groups[0].rows[0].r.id, 2);
});
t("board: live filter ignores the date; live and finished matches unknown to the schedule still appear", () => {
  const d = doc({ events: { 99: { id: 99, h: 1, a: 2, hn: "A", an: "B", lg: 77, ln: "Mystery Cup", ko: U("2026-11-13T23:30:00Z"), hg: 0, ag: 0, min: 82 } } });
  const fin = { 98: { id: 98, lg: 77, ln: "Mystery Cup", h: 3, a: 4, hn: "C", an: "D", ko: U("2026-11-14T07:00:00Z"), hg: 3, ag: 1, at: iso(NOW) } };
  const items = boardItems({ rows, doc: d, finals: fin, nowMs: NOW, tz: "UTC" });
  const live = boardView({ items, day: "2026-11-14", filter: "live", byCode }); assert.equal(live.total, 1); assert.deepEqual([live.groups[0].name, live.groups[0].rows[0].day], ["Mystery Cup", "2026-11-13"]);
  const all = boardView({ items, day: "2026-11-14", filter: "all", byCode }), mc = all.groups.find((g) => g.name === "Mystery Cup"); assert.deepEqual(mc.rows.map((x) => [x.r.id, x.p.kind, x.p.hg, x.p.ag]), [[98, "finished", 3, 1]]);
});
t("board: a moved kick-off changes the day (change feed beats the stored schedule)", () => {
  const d = doc({ changes: { 1: { kickoff: { t: U("2026-11-15T18:00:00Z"), at: iso(NOW) } } } }), items = boardItems({ rows, doc: d, finals: {}, nowMs: NOW, tz: "UTC" });
  assert.equal(items.find((x) => x.r.id === 1).day, "2026-11-15"); assert.equal(boardView({ items, day: "2026-11-14", filter: "all", byCode }).groups[0].rows.some((x) => x.r.id === 1), false);
});
t("board: identical in every time zone except which day a match falls on", () => {
  const prog = `import { boardItems, boardView } from ${JSON.stringify(new URL("../../src/lib/board.js", import.meta.url).href)};
    const rows = ${JSON.stringify(rows)}, items = boardItems({ rows, doc: null, finals: {}, nowMs: ${NOW} }); console.log(JSON.stringify(boardView({ items, day: "2026-11-14", filter: "all", byCode: {} }).counts));`;
  const out = ["UTC", "Africa/Nairobi", "America/Los_Angeles"].map((tz) => { const r = spawnSync(process.execPath, ["--input-type=module", "-e", prog], { env: { ...process.env, TZ: tz }, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); });
  assert.equal(out[0].all, 6); assert.ok(out[2].all < out[0].all + 1, "LA: late match moves to the previous evening");
});

t("phaseOf with finals: a final result beats the old schedule, a postponement note and 'overdue'; live row still wins", () => {
  const fx = { id: 1, t: U("2026-11-14T07:00:00Z"), s: "notstarted" }, fin = { 1: { hg: 2, ag: 2, et: null, pen: { home: 4, away: 3 } } };
  const p = phaseOf(fx, doc({ changes: { 1: { status: { s: "postponed", at: "x" } } } }), NOW, fin); assert.deepEqual([p.kind, p.hg, p.ag, p.src, p.pen.home], ["finished", 2, 2, "final", 4]);
  assert.equal(phaseOf(fx, doc(), NOW, undefined).kind, "overdue"); assert.equal(phaseOf(fx, doc({ events: { 1: { id: 1 } } }), NOW, fin).kind, "live");
  assert.equal(phaseOf(fx, doc(), NOW, { 1: { hg: null, ag: null } }).kind, "overdue", "a final without a score is not a result");
});
t("pickWithLive: settles from the live feed at once; a synced result is never overridden; live and waiting states", () => {
  const pick = { v: 3, matchId: 1, market: "1X2", selection: "H", odds: 2, stake: 10 }, fx = { id: 1, t: U("2026-11-14T07:00:00Z") }, ph = (d, fin) => phaseOf(fx, d, NOW, fin);
  const w = pickWithLive(pick, ph(doc({ left: { 1: { s: "finished", hg: 2, ag: 1, at: "x" } } }))); assert.deepEqual([w.won, w.score, w.profit, w.from], [true, "2–1", 10, "live"]);
  const l = pickWithLive(pick, ph(doc(), { 1: { hg: 0, ag: 1 } })); assert.deepEqual([l.won, l.profit, l.score, l.from], [false, -10, "0–1", "final"]);
  assert.equal(pickWithLive({ ...pick, won: false, score: "0–3" }, ph(doc(), { 1: { hg: 5, ag: 0 } })).score, "0–3", "synced result wins");
  assert.equal(pickWithLive(pick, ph(doc({ events: { 1: { id: 1, hg: 1, ag: 0, min: 33 } } }))).live.min, 33); assert.equal(pickWithLive(pick, ph(doc())).wait, "overdue");
  assert.equal(pickWithLive({ ...pick, selection: "O", market: "OU25" }, ph(doc(), { 1: { hg: 2, ag: 1 } })).won, true, "over 2.5 with 3 goals");
  assert.equal(pickWithLive({ ...pick, v: 2 }, ph(doc(), { 1: { hg: 2, ag: 1 } })).won, undefined, "legacy picks are not tracked"); assert.equal(pickWithLive(pick, null), pick);
});

t("finalEntry / pruneFinals: only a finished match with a score the API sent is final", () => {
  const l = { s: "finished", hg: 2, ag: 1, h: 1, a: 2, hn: "A", an: "B", lg: 3, ln: "Cup", ko: 5, et: null, pen: null, pending: false, fromLive: false };
  assert.deepEqual([L.finalEntry(7, l, "T").id, L.finalEntry(7, l, "T").hg, L.finalEntry(7, l, "T").lg, L.finalEntry(7, l, "T").ln], [7, 2, 3, "Cup"]);
  for (const bad of [{ ...l, fromLive: true }, { ...l, pending: true }, { ...l, s: "inprogress" }, { ...l, hg: null }, null]) assert.equal(L.finalEntry(7, bad, "T"), null);
  assert.deepEqual(Object.keys(L.pruneFinals({ 1: { at: iso(NOW - 3 * 864e5) }, 2: { at: iso(NOW - 5 * 864e5) }, 3: { at: "bad" } }, NOW)), ["1"]);
});
t("sweepCandidates: only matches that should be over, not live, not final, not recently tried; oldest first, capped", () => {
  const e = (id, minAgo, s = "notstarted") => ({ id, t: Math.floor(NOW / 1000) - minAgo * 60, s });
  const entries = [e(1, 60), e(2, 130), e(3, 400), e(4, 800), e(5, 200), e(6, 200, "finished"), e(7, 200), e(8, 200), e(9, 200), e(10, 300), e(11, 140), { id: "x" }];
  const args = { entries, nowMs: NOW, doc: doc({ events: { 5: {} }, changes: { 8: { status: { s: "postponed" } } }, left: { 9: { s: "finished" } } }), finals: { 7: {} }, tried: { 10: NOW - 60e3, 11: NOW - 700e3 } };
  assert.deepEqual(L.sweepCandidates(args), [3, 11, 2], "oldest kick-off first. Excluded: 1 too early, 4 too old, 5 live, 6 finished, 7 final, 8 postponed, 9 left-finished, 10 tried 1 min ago");
  assert.deepEqual(L.sweepCandidates({ ...args, max: 1 }), [3]);
});

t("schedule builder: results beat stale fixtures, every window day exists, sorted, outside the window dropped", () => {
  const r = S.rowsOf("L1", [{ id: 1, h: 1, a: 2, t: 100, s: "notstarted" }, { id: 2, h: 3, a: 4, t: 200, s: "canceled" }, { id: 9, t: 5 }], [{ id: 1, h: 1, a: 2, t: 100, hg: 3, ag: 3 }, { id: 8, h: 5, a: 6, t: 300, hg: null, ag: 1 }]);
  assert.deepEqual(r.map((x) => [x.id, x.s, x.hg]), [[1, "finished", 3], [2, "cancelled", undefined]], "id 1 is a result; 8 has no score and is dropped; 9 has no teams");
  const days = S.byDay([{ id: 2, t: U("2026-11-14T12:00:00Z") }, { id: 1, t: U("2026-11-14T08:00:00Z") }, { id: 3, t: U("2027-01-01T00:00:00Z") }], NOW, 1, 1);
  assert.deepEqual([...days.keys()], ["2026-11-13", "2026-11-14", "2026-11-15"]); assert.deepEqual(days.get("2026-11-14").map((x) => x.id), [1, 2]); assert.equal(days.get("2026-11-13").length, 0);
});
console.log(`\nALL ${n} BOARD TESTS PASSED`);
