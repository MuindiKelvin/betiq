// Fake BSD football API v2 following the documented response shapes. For testing the sync without spending quota.
//   node scripts/dev/mock-bsd.mjs   (port 8788)   then:  BSD_BASE=http://localhost:8788/api/v2 BSD_API_KEY=testkey DRY_RUN=1 node scripts/sync.mjs
// Like the real API it answers 400 to query parameters an endpoint does not accept, and 401 without the token.
import http from "node:http";

const PORT = +(process.env.PORT ?? 8788), TOKEN = "testkey", DAY = 86400;
let calls = 0;
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pois = (r, l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };

const LEAGUES = [{ id: 1, name: "Premier League", country: "England" }, { id: 3, name: "La Liga", country: "Spain" }, { id: 64, name: "UEFA Nations League", country: "Europe" }, { id: 85, name: "Liga Profesional de Fútbol", country: "Argentina" }];
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango"];
const teamsOf = (lid) => NAMES.slice(0, lid === 64 ? 8 : 20).map((n, i) => ({ id: lid * 1000 + i, name: `${n} ${lid === 3 ? "CF" : "FC"}`, country: LEAGUES.find((l) => l.id === lid).country, country_code: "XX", att: 0.7 + ((i * 37) % 9) / 10, def: 0.7 + ((i * 53) % 9) / 10 }));
const seasonsOf = (lid) => Array.from({ length: 7 }, (_, k) => ({ id: lid * 100 + k, name: `${LEAGUES.find((l) => l.id === lid).name} ${2026 - k}`, year: 2026 - k, start_date: `${2026 - k}-01-01`, end_date: `${2026 - k}-12-31`, is_current: k === 0 }));
const eventsOf = (lid, sid) => {
  const teams = teamsOf(lid), k = sid - lid * 100, cur = k === 0, now = Math.floor(Date.now() / 1000), list = [];
  let i = 0;
  for (const h of teams) for (const a of teams) { if (h === a) continue; list.push({ h, a, i: i++ }); }
  const total = list.length, playedN = cur ? Math.min(120, total - 20) : total, ids = (e) => sid * 1000 + e.i;
  return list.map((e) => {
    const t = cur ? now - (100 - Math.floor((e.i * 100) / 120)) * DAY : now - (k * 365 - Math.floor((e.i * 300) / total)) * DAY, done = e.i < playedN, r = rnd(ids(e));
    const ev = { id: ids(e), league_id: lid, season_id: sid, home_team: e.h.name, away_team: e.a.name, event_date: new Date(t * 1000).toISOString(), status: done ? "finished" : "upcoming",
      home_score: done ? pois(r, 1.45 * e.h.att * e.a.def) : null, away_score: done ? pois(r, 1.15 * e.a.att * e.h.def) : null, round_number: Math.floor(e.i / 10) + 1, round_name: `Matchday ${Math.floor(e.i / 10) + 1}`, group_name: null };
    if (lid !== 3) { ev.home_team_id = e.h.id; ev.away_team_id = e.a.id; }      // La Liga omits ids: the sync must fall back to team names
    return ev;
  });
};
const findEvent = (id) => { const sid = Math.floor(id / 1000), lid = Math.floor(sid / 100); return LEAGUES.some((l) => l.id === lid) ? eventsOf(lid, sid).find((e) => e.id === id) : null; };
const tid = (e, side) => e[`${side}_team_id`] ?? teamsOf(Math.floor(e.season_id / 100)).find((t) => t.name === e[`${side}_team`])?.id;

const OK = { leagues: ["country", "is_women", "include_inactive", "limit", "offset"], events: ["date_from", "date_to", "league_id", "season_id", "status", "team_id", "team_name", "stage", "round", "limit", "offset"],
  teams: ["country_code", "league_id", "season_id", "in_competition", "is_women", "name", "limit", "offset"], standings: ["season_id"], top: ["season_id", "team_id", "limit"], form: ["last", "league_id", "venue"],
  transfers: ["league_id", "player_id", "team_id", "from_team_id", "to_team_id", "date_from", "date_to", "min_fee", "has_fee", "ordering", "limit", "offset"], ledger: ["team_id", "league_id", "date_from", "date_to"], none: [] };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname.replace(/^\/api\/v2/, ""), q = Object.fromEntries(u.searchParams);
  const send = (code, body, hdr = {}) => { res.writeHead(code, { "content-type": "application/json", ratelimit: `"football";r=${Math.max(0, 7500 - calls)};t=52800`, "ratelimit-policy": '"football";q=7500;w=86400', ...hdr }); res.end(JSON.stringify(body)); };
  if (p === "/__calls") return send(200, { calls });
  if (req.headers.authorization !== `Token ${TOKEN}`) return send(401, { error: true, status: 401, detail: "Invalid token." });
  calls++;
  const check = (name) => { const bad = Object.keys(q).filter((k) => !OK[name].includes(k)); if (bad.length) { send(400, { error: true, status: 400, detail: `Unknown query parameter(s): ${bad.join(", ")}.`, unknown_parameters: bad, accepted_parameters: OK[name] }); return false; } return true; };
  const page = (list) => { const limit = Math.min(200, +(q.limit ?? 50)), off = +(q.offset ?? 0), next = off + limit < list.length ? `http://x${p}?limit=${limit}&offset=${off + limit}` : null; return { count: list.length, next, previous: off ? "x" : null, results: list.slice(off, off + limit) }; };
  let m;
  if (p === "/leagues/") { if (!check("leagues")) return; return send(200, page(LEAGUES.map((l) => ({ ...l, is_women: false })))); }
  if ((m = p.match(/^\/leagues\/(\d+)\/seasons\/$/))) { if (!check("none")) return; return send(200, { count: 7, results: seasonsOf(+m[1]) }); }
  if ((m = p.match(/^\/leagues\/(\d+)\/standings\/$/))) {
    if (!check("standings")) return; const lid = +m[1], row = (t, i) => ({ position: i + 1, team_id: t.id, team_name: t.name, played: 6, won: 3, drawn: 2, lost: 1, gf: 10, ga: 6, pts: 11, form: "WDWLW", live: false, zone: i < 2 ? { key: "cl", label: "Champions League", type: "qualification" } : null });
    const ts = teamsOf(lid); return send(200, lid === 64 ? { groups: [{ name: "Group A", standings: ts.slice(0, 4).map(row) }, { name: "Group B", standings: ts.slice(4).map(row) }] } : { standings: ts.map(row), zones: [{ key: "cl", label: "Champions League", type: "qualification", from: 1, to: 2 }] });
  }
  if ((m = p.match(/^\/leagues\/(\d+)\/top\/(scorers|assists|yellowcards|redcards|fouls)\/$/))) {
    if (!check("top")) return; const lid = +m[1];
    return send(200, { league_id: lid, stat: m[2], team_id: null, results: Array.from({ length: Math.min(20, +(q.limit ?? 20)) }, (_, i) => ({ rank: i + 1, player_id: lid * 10000 + i, player_name: `Player ${i}`, position: "F", team_id: lid * 1000 + (i % 20), team_name: "T", value: 20 - i, matches: 10 })) });
  }
  if (p === "/teams/") {
    if (!check("teams")) return; const lid = +(q.league_id ?? 0);
    return send(200, page(teamsOf(lid).map(({ att, def, ...t }) => t)));
  }
  if ((m = p.match(/^\/teams\/(\d+)\/(squad|form)?\/?$/))) {
    const id = +m[1], lid = Math.floor(id / 1000);
    if (!m[2]) { if (!check("none")) return; return send(200, { id, name: "Team " + id, country: "X", venue: { name: "Stadium " + id, capacity: 40000 }, coach: { id: 5, name: "Coach " + id }, colors: "red" }); }
    if (m[2] === "squad") { if (!check("none")) return; return send(200, { team_id: id, players: Array.from({ length: 24 }, (_, i) => ({ id: id * 100 + i, name: `Squad ${id}-${i}`, position: "GDMF"[i % 4], shirt_number: i + 1, nationality_code: "XX", availability: i === 3 ? "injured" : "available", injury_type: i === 3 ? "Knee Injury" : "", injury_expected_return: null })) }); }
    if (!check("form")) return; if (!LEAGUES.some((l) => l.id === lid)) return send(404, { error: true, status: 404, detail: "Not found." });
    return send(200, { team_id: id, requested: +(q.last ?? 10), matches: 20, overall: { matches: 20, won: 9, drawn: 5, lost: 6, goals_for: 30, goals_against: 22, points_per_match: 1.6, form: "WWDLW", stats: { ball_possession: { average: 52.3, total: 1046, matches: 20 }, total_shots: { average: 13.5, total: 270, matches: 20 }, corner_kicks: { average: 5.8, total: 116, matches: 20 }, yellow_cards: { average: 1.9, total: 38, matches: 20 } } } });
  }
  if (p === "/events/") {
    if (!check("events")) return; const sid = +q.season_id, lid = Math.floor(sid / 100);
    if (!LEAGUES.some((l) => l.id === lid)) return send(200, page([]));
    return send(200, page(eventsOf(lid, sid)));
  }
  if ((m = p.match(/^\/events\/(\d+)\/(stats|lineups|commentary|h2h)\/$/))) {
    if (!check("none")) return; const id = +m[1], e = findEvent(id); if (!e) return send(404, { error: true, status: 404, detail: "Not found." });
    const fin = e.status === "finished", H = tid(e, "home"), A = tid(e, "away");
    if (m[2] === "stats") return send(200, { event_id: id, xg_estimated: false, stats: { home: { ball_possession: 54, total_shots: 13, shots_on_target: 5, corner_kicks: 6, fouls: 11, yellow_cards: 2, red_cards: 0, offsides: 1, xg: { actual: 1.62, estimated: false } }, away: { ball_possession: 46, total_shots: 9, shots_on_target: 3, corner_kicks: 4, fouls: 12, yellow_cards: 1, red_cards: 0, offsides: 2, xg: { actual: 0.9, estimated: false } } },
      shotmap: [{ player_id: 1, home: true, min: 23, type: "goal", sit: "assisted", pos: { x: 88.2, y: 44.1, z: 0 }, xg: 0.34 }, { player_id: 2, home: false, min: 50, type: "save", sit: "open", pos: { x: 85, y: 30 }, xg: 0.2 }, { player_id: 3, home: true, min: 121, type: "miss", sit: "shootout", pos: { x: 90, y: 50 }, xg: null }],
      momentum: [{ m: 1, v: 12 }, { m: 2, v: -4 }], average_positions: { home: [{ player_id: 1, name: "G. Home", pos: "G", x: 8, y: 50, n: 30 }, { player_id: 2, name: "F. Home", pos: "F", x: 61.5, y: 38, n: 54 }], away: [{ player_id: 11, name: "G. Away", pos: "G", x: 7, y: 50, n: 30 }, { player_id: 12, name: "F. Away", pos: "F", x: 60, y: 40, n: 50 }] } });
    if (m[2] === "lineups") {
      const mk = (b, i, sub) => ({ player_id: b * 100 + i, name: `P ${b}-${i}`, position: i === 1 ? "G" : i < 6 ? "D" : i < 9 ? "M" : "F", shirt_number: i, captain: i === 4, ...(sub === undefined ? {} : { substitute: sub }) });
      const A_ = (b) => ({ formation: "4-3-3", starting_xi: Array.from({ length: 11 }, (_, i) => mk(b, i + 1)), substitutes: Array.from({ length: 5 }, (_, i) => mk(b, i + 12)) });
      const B_ = (b) => ({ formation: "4-4-2", players: [...Array.from({ length: 11 }, (_, i) => mk(b, i + 1, false)), ...Array.from({ length: 5 }, (_, i) => mk(b, i + 12, true))] });
      const v = id % 2 ? A_ : B_;
      return send(200, { event_id: id, lineup_status: "confirmed", beta: false, lineups: { home: v(H), away: v(A) }, unavailable_players: { home: [{ name: "Hurt Guy", reason: "Knee" }], away: [] }, updated_at: "x" });
    }
    if (m[2] === "commentary") {
      const lines = []; let hs = 0, as = 0, n = 0;
      for (let i = 0; i < (e.home_score ?? 0) + (e.away_score ?? 0); i++) { const home = i < e.home_score; home ? hs++ : as++; lines.push({ id: "g" + n++, period: 1, minute: 10 + i * 13, added_time: null, type: i === 0 ? "penalty_goal" : "goal", team: home ? "home" : "away", player: { id: 9, name: "P. Scorer" + i }, related_player: i ? { id: 7, name: "P. Assist" } : null, text: "Goal!", score: { home: hs, away: as }, important: true }); }
      lines.push({ id: "c1", period: 1, minute: 33, added_time: null, type: "yellow_card", team: "away", player: { id: 5, name: "P. Booked" }, related_player: null, text: "Yellow", score: { home: hs, away: as }, important: false }, { id: "s1", period: 2, minute: 60, added_time: null, type: "substitution", team: "home", player: { id: 9, name: "P. Off" }, related_player: { id: 14, name: "P. On" }, text: "Sub", score: { home: hs, away: as }, important: false });
      return send(200, { event_id: id, status: fin ? "finished" : "upcoming", has_play_by_play: true, commentary: fin ? lines : [] });
    }
    const rm = (i, hh) => ({ event_id: 800000 + i, date: new Date(Date.now() - (i + 1.5) * 365 * DAY * 1000).toISOString(), home: "X", away: "Y", home_team_id: hh ? H : A, away_team_id: hh ? A : H, home_score: i % 3, away_score: 1, score: `${i % 3}-1` });
    return send(200, { total_matches: 5, home_wins: 2, draws: 1, away_wins: 2, recent_matches: [rm(0, true), rm(1, false), rm(2, true), rm(3, true), { ...rm(4, true), home_team_id: 1, away_team_id: 2 }] });
  }
  if ((m = p.match(/^\/players\/(\d+)\/(career|transfers|stats)?\/?$/))) {
    if (!check("none")) return; const id = +m[1];
    if (!m[2]) return send(200, { id, name: "Player " + id, position: "F", nationality_code: "AR", date_of_birth: "1999-05-04", height: 181, preferred_foot: "right", shirt_number: 9, market_value: 25000000, team: { id: 1000, name: "Alpha FC" } });
    if (m[2] === "career") return send(200, { results: [{ season: "2025", team: { id: 1000, name: "Alpha FC" }, matches: 30, goals: 12 }, { season: "2024", team: { id: 3, name: "Old FC" }, matches: 28, goals: 9 }] });
    if (m[2] === "transfers") return send(200, { results: [{ date: "2024-07-01", from_team: { id: 3, name: "Old FC" }, to_team: { id: 1000, name: "Alpha FC" }, fee: 15000000, type: "transfer" }] });
    return send(200, { results: Array.from({ length: 5 }, (_, i) => ({ event_id: i, minutes_played: 90, goals: i % 2, assists: 0, rating: 7.1 })) });
  }
  if (p === "/transfers/") { if (!check("transfers")) return; return send(200, page(Array.from({ length: 250 }, (_, i) => ({ id: i, player_id: 100 + i, player_name: `Mover ${i}`, from_team: { id: 5, name: "From FC" }, to_team: { id: 6, name: "To FC" }, date: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), fee: i % 3 ? 1000000 * i : null, type: "transfer" })))); }
  if (p === "/transfers/ledger/") { if (!check("ledger")) return; return send(200, { league_id: +q.league_id, clubs: Array.from({ length: 20 }, (_, i) => ({ team_id: i, team_name: "Club " + i, gross_spend_eur: 1e7 * i, gross_income_eur: 5e6 * i, net_spend_eur: 5e6 * i, squad_size: 25, incoming: { moves: 3, permanent: 2 }, outgoing: { moves: 2, permanent: 1 } })) }); }
  send(404, { error: true, status: 404, detail: "Not found." });
}).listen(PORT, () => console.log("mock BSD API on :" + PORT));
