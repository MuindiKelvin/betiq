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
console.log(`\nALL ${n} BSD HELPER TESTS PASSED`);
