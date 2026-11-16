// Unit tests for scripts/lib/bsd.mjs (documented response shapes + the awkward cases).  npm test
import assert from "node:assert/strict";
import * as B from "../lib/bsd.mjs";
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("kindOf: cups and continental tournaments are 'comp', domestic leagues are 'league'", () => {
  for (const x of ["FA Cup", "Copa del Rey", "Coppa Italia", "DFB Pokal", "Taça de Portugal", "Puchar Polski", "Ziraat Turkiye Kupasi", "Champions League", "UEFA Nations League", "World Cup 2026", "Copa Libertadores", "International Friendly Games", "Carabao Cup", "Emperor Cup"]) assert.equal(B.kindOf({ name: x }), "comp", x);
  for (const x of ["Premier League", "La Liga", "Serie C, Girone A", "Liga MX Apertura", "Eerste Divisie", "Brasileirão Serie A", "Liga Profesional de Fútbol", "MLS"]) assert.equal(B.kindOf({ name: x }), "league", x);
});
t("pickSeasons: current + N newest past, newest first", () => {
  const s = [{ id: 1, start_date: "2020-01-01" }, { id: 3, start_date: "2026-01-01", is_current: true }, { id: 2, start_date: "2024-01-01" }, { id: 4, start_date: "2022-01-01" }];
  const r = B.pickSeasons(s, 2); assert.equal(r.current, 3); assert.deepEqual(r.seasons.map((x) => x.id), [3, 2, 4]);
  assert.equal(B.pickSeasons(s, 0).seasons.length, 1); assert.equal(B.pickSeasons([], 3).current, null);
  assert.equal(B.pickSeasons([{ id: 9, start_date: "2019-01-01" }], 1).current, 9, "no is_current flag: newest wins");
});
t("toRow: finished -> result with regulation score; upcoming/live -> fixture; unresolved/unscored skipped", () => {
  const e = { id: 5, home_team: "A", away_team: "B", home_team_id: 10, away_team_id: 11, event_date: "2026-08-02T17:30:00+00:00", status: "finished", home_score: 2, away_score: 1, round_number: 3 };
  assert.deepEqual(B.toRow(e).result, { id: 5, h: 10, a: 11, hg: 2, ag: 1, t: 1785691800, r: 3 });
  assert.equal(B.toRow({ ...e, status: "finished", home_score: 0, away_score: 0 }).result.hg, 0, "0-0 is a real result");
  assert.equal(B.toRow({ ...e, home_score: null }).skip, "score", "finished without a score is not a 0-0");
  assert.equal(B.toRow({ ...e, status: "unresolved" }).skip, "status");
  const f = B.toRow({ ...e, status: "live", home_score: 1, away_score: 0 }).fixture; assert.equal(f.s, "inprogress");
  assert.equal(B.toRow({ ...e, status: "upcoming" }).fixture.s, "notstarted");
  assert.equal(B.toRow({ ...e, status: "postponed" }).fixture.s, "postponed");
});
t("team ids: explicit id, nested object, or name lookup; else skipped", () => {
  assert.equal(B.teamIdOf({ home_team: { id: 7, name: "X" } }, "home"), 7);
  const by = new Map([[B.norm("Atlético Madrid"), 42]]);
  assert.equal(B.teamIdOf({ home_team: "Atletico  Madrid" }, "home", by), 42, "accents/spacing normalised");
  assert.equal(B.toRow({ id: 1, home_team: "Nobody", away_team: "Nope", event_date: "2026-01-01T00:00:00Z", status: "upcoming" }, by).skip, "teams");
  assert.equal(B.toRow({ id: 1, home_team_id: 3, away_team_id: 3, event_date: "2026-01-01T00:00:00Z", status: "upcoming" }).skip, "teams", "same team twice");
});
t("standings: flat table, grouped table, zones, empty", () => {
  const row = { position: 1, team_id: 9, team_name: "T", played: 5, won: 3, drawn: 1, lost: 1, gf: 8, ga: 4, pts: 10, form: "WWDLW", live: false, zone: { key: "cl", label: "Champions League", type: "qualification" } };
  const flat = B.buildStandings({ standings: [row, { ...row, position: 2, zone: null }], zones: [{ key: "cl" }] });
  assert.equal(flat.rows.length, 2); assert.equal(flat.rows[0].z.t, "qualification"); assert.equal(flat.rows[1].z, null); assert.equal(flat.groups.length, 0);
  const g = B.buildStandings({ groups: [{ name: "A", standings: [row] }, { name: "B", standings: [row] }] }); assert.equal(g.groups.length, 2); assert.equal(g.rows.length, 0);
  assert.equal(B.buildStandings({ standings: [] }), null); assert.equal(B.buildStandings(null), null);
});
t("leaders and team form", () => {
  assert.equal(B.buildLeaders({ results: [{ rank: 1, player_id: 5, player_name: "P", team_id: 2, team_name: "T", value: 12, matches: 9 }, { rank: 2 }] }).length, 1);
  const st = B.buildTeamSt({ overall: { matches: 10, won: 5, drawn: 3, lost: 2, goals_for: 28, goals_against: 15, points_per_match: 1.8, form: "DLWWW", stats: { ball_possession: { average: 54.236, matches: 10 }, dribbles: { average: 9, matches: 4 }, junk: null } } });
  assert.equal(st.avg.ball_possession, 54.24); assert.equal(st.avg.dribbles, 9); assert.equal("junk" in st.avg, false); assert.equal(B.buildTeamSt({ overall: { matches: 0 } }), null);
});
t("statsRow: 16 numbers in fixed order, nulls kept (null is 'unknown', never 0)", () => {
  const r = B.statsRow({ stats: { home: { total_shots: 13, shots_on_target: 5, corner_kicks: 6, fouls: null, yellow_cards: 2, red_cards: 0, ball_possession: 54, xg: { actual: 1.62 } }, away: { total_shots: 9, corner_kicks: 4, yellow_cards: 1, ball_possession: 46, expected_goals: 0.9 } } });
  assert.equal(r.length, 16); assert.deepEqual([r[0], r[1], r[2], r[3], r[6], r[10], r[12], r[14], r[15]], [13, 9, 5, null, null, 0, 54, 1.62, 0.9]);
  assert.equal(B.statsRow({ stats: { home: {}, away: {} } }), null); assert.equal(B.statsRow({}), null);
});
t("stats extras: shootout shots dropped; positions and momentum compacted", () => {
  const x = B.buildStatsExtras({ shotmap: [{ home: true, min: 5, type: "goal", pos: { x: 90, y: 40 }, xg: 0.3 }, { home: false, min: 125, type: "miss", sit: "shootout", pos: { x: 90, y: 40 } }, { home: true, min: 9, type: "save" }],
    average_positions: { home: [{ player_id: 1, name: "G", pos: "G", x: 8, y: 50 }], away: [] }, momentum: [{ m: 1, v: 5 }, { m: null, v: 1 }] });
  assert.equal(x.shots.length, 1); assert.equal(x.avgpos.h.length, 1); assert.equal(x.avgpos.a.length, 0); assert.deepEqual(x.momentum, [[1, 5]]);
  assert.equal(B.buildStatsExtras({}).avgpos, null);
});
t("lineups: separate bench, flagged players, one unflagged list of 16, predicted, unavailable", () => {
  const p = (i, x = {}) => ({ player_id: i, name: "P" + i, position: i === 1 ? "G" : "M", shirt_number: i, ...x });
  const a = B.buildLineups({ lineup_status: "confirmed", lineups: { home: { formation: "4-4-2", starting_xi: Array.from({ length: 11 }, (_, i) => p(i + 1)), substitutes: [p(12), p(13)] }, away: null }, unavailable_players: { home: [{ name: "Hurt", reason: "Knee" }] } });
  assert.equal(a.h.players.filter((x) => !x.sub).length, 11); assert.equal(a.h.players.filter((x) => x.sub).length, 2); assert.equal(a.a, null); assert.equal(a.confirmed, true); assert.equal(a.h.missing[0].why, "Knee");
  const b = B.buildLineups({ lineup_status: "predicted", lineups: { home: { players: [...Array.from({ length: 11 }, (_, i) => p(i + 1, { substitute: false })), p(12, { substitute: true })] }, away: { players: Array.from({ length: 16 }, (_, i) => p(i + 1)) } } });
  assert.equal(b.confirmed, false); assert.equal(b.h.players.filter((x) => x.sub).length, 1); assert.equal(b.a.players.filter((x) => !x.sub).length, 11, "unflagged 16 -> 11 + 5 bench");
  assert.equal(B.buildLineups({ lineup_status: "unavailable", lineups: null }), null); assert.equal(B.buildLineups({ lineups: { home: { players: [] } } }), null);
  assert.equal(B.sheetOf({ starting_xi: [{ name: "X", position: "GK" }] }).players[0].pos, "G"); assert.equal(B.sheetOf({ starting_xi: [{ name: "X", position: "ATT" }] }).players[0].pos, "F");
});
t("commentary: goals (penalty/own), cards, substitutions with the right sides and players", () => {
  const L = (type, team, p, r) => ({ type, team, minute: 10, added_time: null, player: p && { id: 1, name: p }, related_player: r && { id: 2, name: r } });
  const e = B.buildEvents({ commentary: [L("goal", "home", "Scorer", "Assist"), L("penalty_goal", "away", "Pen"), L("own_goal", "home", "Defender", "Nobody"), L("yellow_card", "away", "Booked"), L("second_yellow_card", "home", "Twice"), L("red_card", "home", "Red"),
    L("substitution", "home", "Off", "On"), L("corner", "home"), L("period_start", null)] });
  assert.deepEqual(e.goals.map((g) => [g.s, g.k, g.p, g.a]), [["h", "reg", "Scorer", "Assist"], ["a", "pen", "Pen", null], ["h", "og", "Defender", null]]);
  assert.deepEqual(e.cards.map((c) => c.k), ["y", "yr", "r"]); assert.deepEqual([e.subs[0].i, e.subs[0].o], ["On", "Off"]);
  const d = B.buildDetails({ id: 5, code: "L1", commentary: { status: "finished", commentary: [] }, lineups: null, stats: null });
  assert.deepEqual([d.finished, d.goals, d.lineups], [true, [], null], "finished 0-0: empty goal list, not unknown");
  assert.equal(B.buildDetails({ id: 5, code: "L1", commentary: { status: "upcoming", commentary: [] } }).goals, null, "upcoming: goals unknown");
});
t("h2h: only the pair, newest first, null scores dropped", () => {
  const m = (i, h, a, hs, as) => ({ event_id: i, date: `202${i}-01-01T00:00:00+00:00`, home_team_id: h, away_team_id: a, home_score: hs, away_score: as });
  const r = B.buildH2H({ total_matches: 5, recent_matches: [m(1, 1, 2, 1, 0), m(2, 2, 1, 2, 2), m(3, 1, 9, 1, 1), m(4, 1, 2, null, null), m(5, 2, 1, 0, 3)] }, 2, 1);
  assert.deepEqual(r.matches.map((x) => x.id), [5, 2, 1]); assert.deepEqual(r.ids, [1, 2]);
});
t("flat: scalars and nested names only; never throws on odd input", () => {
  assert.deepEqual(B.flat({ a: 1, b: "x", c: null, d: "", e: { id: 3, name: "N" }, f: [1, 2], g: false, h: { z: 1 } }), { a: 1, b: "x", e: "N", e_id: 3, g: false });
  assert.deepEqual(B.flat(null), {}); assert.equal(B.buildSquad({ players: [{ id: 1, name: "A" }, { name: "no id" }] }).length, 1); assert.deepEqual(B.firstArray({ x: 1, y: [1] }), [1]); assert.deepEqual(B.firstArray(null), []);
  const p = B.buildPlayerPack({ id: 1, name: "P", team: { id: 2, name: "T" } }, { results: [{ season: "2025" }] }, [{ fee: 1 }], null); assert.equal(p.profile.team, "T"); assert.equal(p.career.length, 1); assert.equal(p.transfers.length, 1); assert.deepEqual(p.log, []);
});

/* ---------- scorers and assists ---------- */
const G = (type, team, p, r, minute = 10, extra = {}) => ({ type, team, minute, added_time: null, period: minute > 45 ? 2 : 1, player: p && { id: 1, name: p }, related_player: r && { id: 2, name: r }, ...extra });
t("goalsRow: scorer and assist names, penalty and own goal, complete when the count matches the 90-minute score", () => {
  const r = B.goalsRow({ commentary: [G("goal", "home", "Scorer", "Assist", 12), G("penalty_goal", "away", "Pen", null, 40), G("own_goal", "home", "Defender", "Nobody", 70), G("yellow_card", "home", "Booked"), G("corner", "away")] }, 1, 2);
  assert.equal(r.n, 3);
  assert.deepEqual(r.g.map((x) => [x.s, x.k, x.p, x.a]), [["h", "reg", "Scorer", "Assist"], ["a", "pen", "Pen", undefined], ["h", "og", "Defender", undefined]]);
  assert.equal(r.complete, false, "own goal is credited to the home side in the feed, so home has 2 and the score says 1: flagged, not hidden");
  assert.equal(B.goalsRow({ commentary: [G("goal", "home", "A", "B", 12), G("goal", "away", "C", null, 30)] }, 1, 1).complete, true);
});
t("goalsRow: extra-time goals are kept but flagged and never counted against the 90-minute score; a missing goal is incomplete; unknown score is unknown", () => {
  const et = { period: 3 };
  const r = B.goalsRow({ commentary: [G("goal", "home", "A", "B", 12), G("goal", "away", "C", "D", 105, et)] }, 1, 0);
  assert.equal(r.complete, true); assert.equal(r.g[1].et, 1); assert.equal(r.n, 1);
  assert.equal(B.goalsRow({ commentary: [G("goal", "home", "A", "B")] }, 2, 1).complete, false);
  assert.equal(B.goalsRow({ commentary: [] }, 1, 0).complete, false, "empty commentary for a 1-0 is incomplete, not 'no goals'");
  assert.equal(B.goalsRow({ commentary: [G("goal", "home", "A", "B")] }, null, null).complete, null);
  const noPeriod = { commentary: [{ type: "goal", team: "home", minute: 95, player: { name: "X" } }] };
  assert.equal(B.goalsRow(noPeriod, 0, 0).g[0].et, 1, "no period field: minutes after 90 count as extra time");
  assert.equal(B.goalsRow({ commentary: [{ type: "goal", team: "home", minute: 20 }] }, 1, 0).g[0].p, undefined, "unknown scorer stays unknown");
});
t("goalsDue: newest first, 0-0 needs no call, complete ones skipped, incomplete retried later then given up, corrected score refetched", () => {
  const now = 1_000_000, H = 3600, D = 86400;
  const res = [{ id: 1, t: now - 5 * D, hg: 2, ag: 0 }, { id: 2, t: now - 1 * D, hg: 0, ag: 0 }, { id: 3, t: now - 2 * H, hg: 1, ag: 1 }, { id: 4, t: now - 4 * H, hg: 3, ag: 0 }, { id: 5, t: now - 3 * H, hg: null, ag: null }, { id: 6, t: now - 8 * H, hg: 1, ag: 0 }, { id: 7, t: now - 6 * D, hg: 1, ag: 0 }, { id: 8, t: now - 9 * H, hg: 2, ag: 1 }];
  const have = { 4: { ok: 1, n: 3, at: now - H }, 6: { ok: 0, n: 0, at: now - 1 * H }, 7: { ok: 0, n: 0, at: now - 4 * D }, 8: { ok: 1, n: 2, at: now - 2 * H } };
  const r = B.goalsDue(res, have, now, 10);
  assert.deepEqual(r.fetch, [3, 8, 1], "3 and 1 are new; 8 was complete for a 2-goal score but is now 3 (corrected); 4 complete; 6 retried too soon; 7 given up; 5 unscored");
  assert.deepEqual(r.zero, [2]);
  assert.deepEqual(B.goalsDue(res, have, now, 1).fetch, [3], "cap respected, newest first");
  assert.deepEqual(B.goalsDue(res, { ...have, 6: { ok: 0, n: 0, at: now - 7 * H } }, now, 10).fetch.includes(6), true, "incomplete and old enough: retried");
});
t("pruneGoals: keeps season matches and recent fetches, drops the rest, stays under the size limit", () => {
  const now = 2_000_000, m = { 1: { g: [], ok: 1, at: now - 30 * 86400 }, 2: { g: [], ok: 1, at: now - 30 * 86400 }, 3: { g: [], ok: 1, at: now - 86400 } };
  assert.deepEqual(Object.keys(B.pruneGoals(m, new Set([1]), now)).sort(), ["1", "3"]);
  const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i, { g: [{ p: "x".repeat(200) }], ok: 1, at: now - i }]));
  const kept = B.pruneGoals(big, new Set(Object.keys(big).map(Number)), now, { maxBytes: 5000 });
  assert.ok(JSON.stringify(kept).length <= 5000 && kept[0] && !kept[49], "newest entries survive");
});

/* ---------- referee, venue, managers ---------- */
t("infoOf: nested objects, bare names, sibling id/name fields and coaches as object, array or home_coach", () => {
  const a = B.infoOf({ referee: { id: 7, name: " M. Oliver " }, venue: { id: 9, name: "Villa Park", city: "Birmingham", capacity: 42682 }, coaches: { home: { id: 1, name: "U. Emery" }, away: "E. Howe" }, attendance: 41000 });
  assert.deepEqual(a, { rf: { id: 7, n: "M. Oliver" }, vn: { id: 9, n: "Villa Park", city: "Birmingham", cap: 42682 }, hc: { id: 1, n: "U. Emery" }, ac: { n: "E. Howe" }, att: 41000 });
  const b = B.infoOf({ referee: "A. Taylor", referee_id: 5, venue_name: "Anfield", venue_id: 3, home_coach: { id: 4, name: "A. Slot" }, away_coach_name: "P. Guardiola", away_coach_id: 8 });
  assert.deepEqual([b.rf, b.vn, b.hc, b.ac], [{ id: 5, n: "A. Taylor" }, { id: 3, n: "Anfield" }, { id: 4, n: "A. Slot" }, { id: 8, n: "P. Guardiola" }]);
  const c = B.infoOf({ coaches: [{ side: "away", id: 2, name: "Away Boss" }, { side: "home", id: 1, name: "Home Boss" }] });
  assert.deepEqual([c.hc, c.ac], [{ id: 1, n: "Home Boss" }, { id: 2, n: "Away Boss" }]);
  assert.equal(B.infoOf({ id: 1, status: "finished" }), null, "nothing found: null, never an empty object or a guess");
  assert.equal(B.infoOf(null), null); assert.equal(B.infoOf({ referee: null, venue: {}, coaches: null }), null);
});
t("teamExtras: venue id/capacity and coach id survive (flat() would drop them)", () => {
  assert.deepEqual(B.teamExtras({ id: 1, venue: { id: 9, name: "Stadium", capacity: 40000, city: "X" }, coach: { id: 5, name: "Boss" } }), { vn: { id: 9, n: "Stadium", city: "X", cap: 40000 }, co: { id: 5, n: "Boss" } });
  assert.equal(B.teamExtras({ id: 1, colors: "red" }), null);
});
t("manager career: record kept with nulls as nulls, home/away blocks, appointment effect only when both sides have matches", () => {
  const rec = { matches: 38, wins: 20, draws: 8, losses: 10, points: 68, ppm: 1.79, goals_for: 60, goals_against: 40, goal_diff: 20 };
  const s = B.spellOf({ team: { id: 3, name: "Alpha FC" }, start_date: "2022-07-01", ...rec, home: rec, away: { ...rec, ppm: null, matches: 0 }, appointment_effect: { window: 10, before: { matches: 10, points: 11, ppm: 1.1 }, after: { matches: 10, points: 21, ppm: 2.1 }, ppm_change: 1.0 } });
  assert.equal(s.team, "Alpha FC"); assert.equal(s.team_id, 3); assert.equal("matches" in s, false, "record moved into rec");
  assert.equal(s.rec.ppm, 1.79); assert.equal(s.away.ppm, null, "null ppm stays null, not 0"); assert.equal(s.home.wins, 20);
  assert.deepEqual(s.ae, { window: 10, before: { matches: 10, points: 11, ppm: 1.1 }, after: { matches: 10, points: 21, ppm: 2.1 }, ppm_change: 1 });
  assert.equal(B.aeOf(null), null); assert.equal(B.aeOf({ window: 10, before: { matches: 0, points: 0, ppm: null }, after: { matches: 5, points: 9, ppm: 1.8 }, ppm_change: null }), null, "promoted club: no 'before', no invented 0.0");
  const pack = B.buildManagerPack({ id: 5, name: "Boss", preferred_formation: "4-3-3", team: { id: 3, name: "Alpha FC" }, record: { matches: 100, wins: 50 } }, { results: [{ team: "Old FC", matches: 10 }] }, "T");
  assert.equal(pack.profile.preferred_formation, "4-3-3"); assert.equal(pack.profile.team, "Alpha FC"); assert.equal(pack.rec.wins, 50); assert.equal(pack.career.length, 1); assert.equal(pack.career[0].rec.matches, 10);
});
t("flat2 / referee and venue packs / people lists", () => {
  assert.deepEqual(B.flat2({ id: 1, name: "R", country: { id: 2, name: "England", code: "EN" }, stats: { yellow_cards_per_match: 3.4, deep: { x: 1 }, id: 9 }, tags: [1] }), { id: 1, name: "R", country: "England", country_id: 2, stats_id: 9, country_code: "EN", stats_yellow_cards_per_match: 3.4 });
  assert.equal(B.buildRefereePack({ id: 1, name: "R", aggregates: { red_cards: 0.1 } }).profile.aggregates_red_cards, 0.1);
  const v = B.buildVenuePack({ id: 3, name: "V", capacity: 50000, home_team: { id: 7, name: "T" } }, { results: [{ id: 1, name: "League" }] });
  assert.equal(v.profile.capacity, 50000); assert.equal(v.profile.home_team, "T"); assert.equal(v.competitions[0].name, "League");
  assert.equal(B.buildPeople({ results: [{ id: 1, name: "A", team: { id: 5, name: "T" } }, { name: "no id" }] }).length, 1);
});
t("buildDetails keeps the match info when the event record is supplied", () => {
  const d = B.buildDetails({ id: 5, code: "L1", commentary: { status: "finished", commentary: [] }, detail: { referee: { id: 1, name: "R" }, venue: "V" } });
  assert.deepEqual(d.info, { rf: { id: 1, n: "R" }, vn: { n: "V" } });
  assert.equal(B.buildDetails({ id: 5, code: "L1", commentary: { status: "finished", commentary: [] } }).info, null);
});
t("profileRec: the real manager profile (matches_total, wins, draws, losses) gives points and ppm by arithmetic, nothing invented", () => {
  const r = B.profileRec({ matches_total: 40, wins: 20, draws: 10, losses: 10 });
  assert.deepEqual([r.matches, r.points, r.ppm], [40, 70, 1.75]);
  assert.equal(B.profileRec({ id: 1, name: "x" }), null);
  assert.equal(B.profileRec({ matches_total: 40, wins: 20 }).points, null, "draws unknown: no points, no ppm");
});
console.log(`\nALL ${n} BSD HELPER TESTS PASSED`);
