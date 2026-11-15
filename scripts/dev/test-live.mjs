// Tests for scripts/lib/live.mjs (runner side) and src/lib/phase.js (browser side).  npm test
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as L from "../lib/live.mjs";
import { describe, feedState, fmtDur, minuteLabel, phaseOf, preMatchLock, scoreText } from "../../src/lib/phase.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const NOW = Date.parse("2026-11-14T10:00:00Z"), S = (iso) => Math.floor(Date.parse(iso) / 1000), iso = (ms) => new Date(ms).toISOString();

/* ---------- runner side ---------- */
t("liveRow: documented fields are read as sent; unknown fields are kept, never invented", () => {
  const r = L.liveRow({ id: 7, home_team: "Colombia", away_team: "Chile", home_team_id: 1, away_team_id: 2, league_id: 31, league_name: "Friendlies", event_date: "2026-11-14T00:00:00+00:00",
    home_score: 1, away_score: 0, current_minute: 67, extra_time_score: null, penalty_shootout: null, live_websocket: true, websocket_plus: false, period: 2, half_time_score: { home: 0, away: 0 }, tags: ["a"] });
  assert.deepEqual([r.id, r.h, r.a, r.hn, r.an, r.lg, r.ln, r.hg, r.ag, r.min, r.et, r.pen, r.ws, r.wsp], [7, 1, 2, "Colombia", "Chile", 31, "Friendlies", 1, 0, 67, null, null, true, false]);
  assert.equal(r.ko, S("2026-11-14T00:00:00+00:00"));
  assert.deepEqual(r.x, { period: 2, half_time_score: { home: 0, away: 0 } }, "extras kept (arrays dropped)");
});
t("liveRow: team objects, event_id fallback, minute as text, score 0 is a score (not missing)", () => {
  const r = L.liveRow({ event_id: "9", home_team: { id: 5, name: "A" }, away_team: { id: 6, name: "B" }, home_score: 0, away_score: 0, current_minute: "45+2", league: { id: 3, name: "L" } });
  assert.deepEqual([r.id, r.h, r.a, r.hn, r.an, r.hg, r.ag, r.min, r.lg, r.ln], [9, 5, 6, "A", "B", 0, 0, "45+2", 3, "L"]);
  const q = L.liveRow({ id: 1 }); assert.deepEqual([q.hg, q.ag, q.min, q.h, q.hn, q.lg], [null, null, null, null, null, null], "absent -> null, never 0");
  assert.equal(L.liveRow({ home_team: "x" }), null); assert.equal(L.liveRow(null), null); assert.equal(L.liveRow([1]), null);
});
t("liveRow: extra time and shoot-out stay separate from the 90-minute score", () => {
  const r = L.liveRow({ id: 1, home_score: 1, away_score: 1, extra_time_score: { home: 1, away: 0 }, penalty_shootout: { home: 3, away: 4 }, current_minute: 120 });
  assert.deepEqual([r.hg, r.ag, r.et, r.pen], [1, 1, { home: 1, away: 0 }, { home: 3, away: 4 }]);
  assert.equal(L.scoreOf(2), 2); assert.equal(L.scoreOf(""), null);
});
t("reconcile: matches missing from the new poll are reported as dropped", () => {
  const prev = { 1: { id: 1 }, 2: { id: 2 } }, r = L.reconcile(prev, [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(Object.keys(r.events), ["2", "3"]); assert.deepEqual(r.dropped, [1]);
  assert.deepEqual(L.reconcile(undefined, []).dropped, []);
});
t("leftEntry: status is what the API says; a failed lookup claims nothing", () => {
  const prev = { id: 1, h: 10, a: 11, hn: "A", an: "B", lg: 3, ln: "L", ko: 5, hg: 2, ag: 1, et: null, pen: null };
  const fin = L.leftEntry({ status: "finished", home_score: 2, away_score: 2 }, prev, "T");
  assert.deepEqual([fin.s, fin.raw, fin.hg, fin.ag, fin.pending, fin.fromLive, fin.hn, fin.lg], ["finished", "finished", 2, 2, false, false, "A", 3]);
  const live = L.leftEntry({ status: "inprogress" }, prev, "T"); assert.equal(live.s, "inprogress"); assert.deepEqual([live.hg, live.ag, live.fromLive], [2, 1, true], "no score in detail -> last live score, flagged");
  const odd = L.leftEntry({ status: "awarded", home_score: 3, away_score: 0 }, prev, "T"); assert.deepEqual([odd.s, odd.raw], [null, "awarded"], "unrecognised status kept verbatim");
  const bad = L.leftEntry(null, prev, "T", 2); assert.deepEqual([bad.s, bad.raw, bad.pending, bad.fromLive, bad.hg, bad.tries], [null, null, true, true, 2, 2]);
  const at = iso(NOW - 3 * 60e3), e = { ...fin, at, s: "inprogress", tries: 1, pending: false };
  assert.equal(L.needsRecheck(e, NOW), true); assert.equal(L.needsRecheck({ ...e, at: iso(NOW - 30e3) }, NOW), false, "not before the interval"); assert.equal(L.needsRecheck({ ...e, tries: 8 }, NOW), false, "gives up");
  assert.equal(L.needsRecheck({ ...e, s: "finished" }, NOW), false); assert.equal(L.needsRecheck({ ...e, s: "finished", pending: true }, NOW), true);
  const kept = L.pruneLeft({ 1: { at: iso(NOW - 3 * 36e5) }, 2: { at: iso(NOW - 7 * 36e5) } }, NOW); assert.deepEqual(Object.keys(kept), ["1"]);
});
t("change feed: newest change of each kind wins; cursor never skips changes", () => {
  const resp = { since: "a", until: "2026-11-14T09:59:00Z", truncated: false, changes: [
    { change: "kickoff", changed_at: "2026-11-14T08:00:00Z", event_id: 5, new_value: "2026-11-14T20:45:00+00:00", old_value: "2026-11-14T18:45:00+00:00" },
    { change: "status", changed_at: "2026-11-14T08:30:00Z", event_id: 6, new_value: "postponed", old_value: "notstarted" },
    { change: "kickoff", changed_at: "2026-11-14T09:00:00Z", event_id: 5, new_value: "2026-11-14T21:00:00+00:00" },
    { change: "venue", changed_at: "2026-11-14T09:10:00Z", event_id: 8, new_value: "x" }, { change: "kickoff", changed_at: "bad", event_id: 9, new_value: "2026-11-14T21:00:00Z" }] };
  const p = L.parseChanges(resp); assert.equal(p.items.length, 3); assert.equal(p.maxAt, "2026-11-14T09:10:00Z");
  const m = L.applyChanges({}, [...p.items].reverse());
  assert.equal(m[5].kickoff.t, S("2026-11-14T21:00:00+00:00")); assert.deepEqual([m[6].status.s, m[6].status.raw], ["postponed", "postponed"]);
  assert.equal(L.applyChanges(m, [{ id: 5, kind: "kickoff", at: "2026-11-14T07:00:00Z", t: 1 }])[5].kickoff.t, m[5].kickoff.t, "older change ignored");
  assert.equal(L.nextCursor(p, "x"), "2026-11-14T09:59:00Z"); assert.equal(L.nextCursor({ ...p, truncated: true }, "x"), "2026-11-14T09:10:00Z", "truncated: restart from last changed_at");
  assert.equal(L.nextCursor({ truncated: false, until: null }, "keep"), "keep");
  const pr = L.pruneChanges({ 1: { kickoff: { t: 1, at: iso(NOW - 9 * 864e5) } }, 2: { kickoff: { t: 1, at: iso(NOW - 864e5) } } }, NOW); assert.deepEqual(Object.keys(pr), ["2"]);
});
t("gate: spends calls only when something is live or due; unexpected answers fail open", () => {
  const cov = (f) => ({ sports: [{ sport: "hockey", live_now: 9 }, { sport: "football", ...f }] }), lead = 10 * 60e3, g = (o) => L.gate({ nowMs: NOW, leadMs: lead, hadLive: false, ...o }).poll;
  assert.equal(g({ cov: cov({ live_now: 3, next_event_at: null }) }), true);
  assert.equal(g({ cov: cov({ live_now: 0, next_event_at: iso(NOW + 5 * 60e3) }) }), true, "kick-off within lead");
  assert.equal(g({ cov: cov({ live_now: 0, next_event_at: iso(NOW + 3 * 36e5) }) }), false);
  assert.equal(g({ cov: cov({ live_now: 0, next_event_at: null }) }), false);
  assert.equal(g({ cov: cov({ live_now: 0, next_event_at: iso(NOW - 3600e3) }) }), true, "overdue next event -> poll");
  assert.equal(g({ cov: cov({ live_now: 0, next_event_at: iso(NOW + 3 * 36e5) }), hadLive: true }), true, "was live: reconcile first");
  for (const bad of [null, {}, { sports: [] }, cov({}), cov({ live_now: "?" })]) assert.equal(g({ cov: bad }), true);
  assert.equal(g({ cov: { sports: [{ sport: "hockey", live_now: 0 }] } }), true, "no football entry -> fail open");
});

/* ---------- browser side ---------- */
const doc = (o = {}) => ({ updated: iso(NOW - 20e3), mode: "live", pollS: 30, events: {}, left: {}, changes: {}, ...o });
const KO = S("2026-11-14T09:30:00Z");   // kicked off 30 minutes before NOW

t("feedState: fresh, stale, idle, halted, none", () => {
  assert.equal(feedState(doc(), NOW).state, "live"); assert.equal(feedState(doc({ updated: iso(NOW - 119e3) }), NOW).state, "live"); assert.equal(feedState(doc({ updated: iso(NOW - 125e3) }), NOW).state, "stale");
  assert.equal(feedState(doc({ mode: "idle", updated: iso(NOW - 500e3) }), NOW).state, "idle"); assert.equal(feedState(doc({ mode: "idle", updated: iso(NOW - 700e3) }), NOW).state, "stale");
  assert.equal(feedState(doc({ halt: "quota" }), NOW).state, "halted"); assert.equal(feedState(null, NOW).state, "none"); assert.equal(feedState({ updated: "nope" }, NOW).state, "none");
  assert.equal(feedState(doc({ pollS: 60, updated: iso(NOW - 200e3) }), NOW).state, "live", "limit scales with the poll interval");
  assert.equal(feedState(doc({ mode: "idle", revisitS: 1500, updated: iso(NOW - 1700e3) }), NOW).state, "idle", "idle runner that said it would be back in 25 min is not stale yet");
  assert.equal(feedState(doc({ mode: "idle", revisitS: 1500, updated: iso(NOW - 1900e3) }), NOW).state, "stale");
});
t("phaseOf: the 'has it started?' decision uses evidence in a fixed order", () => {
  const fx = { id: 1, t: KO, s: "notstarted" };
  assert.equal(phaseOf(fx, null, NOW).kind, "overdue", "no live data at all: time passed -> overdue (never 'live')");
  assert.equal(phaseOf({ ...fx, t: KO + 3600 }, null, NOW).kind, "upcoming");
  assert.equal(phaseOf({ ...fx, t: S("2026-11-14T10:00:00Z") }, null, NOW).kind, "overdue", "exactly at kick-off counts as passed");
  assert.equal(phaseOf({ ...fx, t: S("2026-11-14T10:00:01Z") }, null, NOW).kind, "upcoming");
  const live = phaseOf(fx, doc({ events: { 1: { id: 1, hg: 1, ag: 0, min: 30 } } }), NOW); assert.deepEqual([live.kind, live.row.min, live.stale], ["live", 30, false]);
  assert.equal(phaseOf(fx, doc({ events: { 1: { id: 1 } }, updated: iso(NOW - 300e3) }), NOW).stale, true);
  assert.equal(phaseOf(fx, doc(), NOW).kind, "overdue", "healthy feed that does not list it: still not claimed live");
  assert.equal(phaseOf(fx, doc({ left: { 1: { s: "finished", hg: 2, ag: 1, at: "x" } } }), NOW).kind, "finished");
  assert.equal(phaseOf(fx, doc({ left: { 1: { s: "finished", hg: 2, ag: 1, at: "x" } } }), NOW).src, "live");
  assert.equal(phaseOf(fx, doc({ left: { 1: { s: "inprogress", raw: "inprogress", at: "x" } } }), NOW).kind, "left");
  assert.equal(phaseOf(fx, doc({ left: { 1: { s: "postponed", at: "x" } } }), NOW).kind, "postponed");
  assert.equal(phaseOf({ ...fx, s: "finished", hg: 3, ag: 3 }, doc(), NOW).kind, "finished");
  assert.equal(phaseOf({ ...fx, s: "postponed" }, doc(), NOW).kind, "postponed"); assert.equal(phaseOf({ ...fx, s: "canceled" }, doc(), NOW).kind, "cancelled");
  assert.equal(phaseOf({ ...fx, s: "inprogress" }, doc(), NOW).syncedLive, true);
  assert.equal(phaseOf({ id: 1, s: "notstarted" }, doc(), NOW).kind, "upcoming", "no kick-off time: nothing is claimed");
});
t("phaseOf: a moved kick-off or a postponement from the change feed beats the stale synced fixture", () => {
  const fx = { id: 1, t: KO, s: "notstarted" };
  const moved = phaseOf(fx, doc({ changes: { 1: { kickoff: { t: KO + 4 * 3600, at: "x" } } } }), NOW); assert.deepEqual([moved.kind, moved.moved, moved.t], ["upcoming", true, KO + 4 * 3600]);
  assert.equal(phaseOf(fx, doc({ changes: { 1: { status: { s: "postponed", raw: "postponed", at: "x" } } } }), NOW).kind, "postponed");
  const odd = phaseOf(fx, doc({ changes: { 1: { status: { s: null, raw: "awarded", at: "x" } } } }), NOW); assert.deepEqual([odd.kind, odd.raw], ["disrupted", "awarded"]);
  assert.equal(phaseOf(fx, doc({ changes: { 1: { status: { s: "notstarted", raw: "notstarted", at: "x" } } } }), NOW).kind, "overdue", "recovered status is not a disruption");
  assert.equal(phaseOf(fx, doc({ events: { 1: { id: 1 } }, changes: { 1: { status: { s: "postponed", at: "x" } } } }), NOW).kind, "live", "live feed wins");
});
t("phaseOf: identical answers in every time zone (the zone only changes how times are displayed)", () => {
  const prog = `import { phaseOf } from ${JSON.stringify(new URL("../../src/lib/phase.js", import.meta.url).href)};
    const d = { updated: ${JSON.stringify(iso(NOW - 20e3))}, mode: "live", pollS: 30, events: { 2: { id: 2, hg: 0, ag: 0, min: 12 } }, left: {}, changes: {} };
    console.log(JSON.stringify([1, 2, 3].map((id) => { const p = phaseOf({ id, t: ${KO} + (id === 3 ? 7200 : 0), s: "notstarted" }, d, ${NOW}); return [p.kind, p.t, p.sinceS ?? p.inS ?? null]; })));`;
  const out = ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Pacific/Kiritimati"].map((tz) => { const r = spawnSync(process.execPath, ["--input-type=module", "-e", prog], { env: { ...process.env, TZ: tz }, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); });
  assert.equal(new Set(out).size, 1, out.join(" | ")); assert.deepEqual(JSON.parse(out[0]).map((x) => x[0]), ["overdue", "live", "upcoming"]);
});
t("text helpers: durations, minutes, scores, sentences", () => {
  assert.deepEqual([fmtDur(5), fmtDur(60), fmtDur(3599), fmtDur(3900), fmtDur(7200), fmtDur(200000)], ["5 s", "1 min", "59 min", "1 h 05 min", "2 h", "2 d"]);
  assert.deepEqual([minuteLabel(67), minuteLabel("45+2"), minuteLabel("HT"), minuteLabel(null), minuteLabel(0)], ["67'", "45+2'", "HT", null, "0'"]);
  assert.deepEqual([scoreText({ home: 1, away: 0 }), scoreText(2), scoreText(null), scoreText({ a: 1 })], ["1–0", "2", null, "a 1"]);
  const f = (x) => "<" + x + ">", p = phaseOf({ id: 1, t: KO, s: "notstarted" }, null, NOW);
  assert.match(describe(p, f), /Kick-off was 30 min ago \(<\d+>\)\. It has not been reported live yet, so the score is unknown\. The live feed is not connected\./);
  assert.equal(preMatchLock(p) !== null, true); assert.equal(preMatchLock(phaseOf({ id: 1, t: KO + 9999, s: "notstarted" }, null, NOW)), null); assert.equal(preMatchLock(null), null);
});
console.log(`\nALL ${n} LIVE TESTS PASSED`);
