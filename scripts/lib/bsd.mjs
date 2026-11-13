// Pure helpers for the Bzzoiro Sports Data (BSD) football API v2: turn API responses into compact Firestore documents.
// No network and no Firestore here, so everything is unit-tested (npm test). Field names follow https://sports.bzzoiro.com/docs/football/
// and each reader accepts the plausible alternatives, because a few shapes (lineup players, squad rows, transfer rows) are not spelled out.

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" || Number.isNaN(+v) ? null : +v);
export const ts = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };
const obj = (v) => v && typeof v === "object" && !Array.isArray(v);

// The array in a response body: a bare array, a preferred key, or (last resort) the first array-valued property.
export function firstArray(d, keys = []) {
  if (Array.isArray(d)) return d;
  if (!obj(d)) return [];
  for (const k of keys) if (Array.isArray(d[k])) return d[k];
  for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  return [];
}

// One level of scalars (plus name/id of nested objects) so unknown record shapes can still be stored and shown.
export function flat(o, maxStr = 300) {
  const out = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") out[k] = v.length > maxStr ? v.slice(0, maxStr) : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (obj(v)) { if (v.name != null) out[k] = String(v.name); if (v.id != null) out[k + "_id"] = v.id; }
  }
  return out;
}

/* ---------- competitions ---------- */
// Cups, continental and international tournaments: strengths come from far fewer matches, so predictions are flagged as rough.
const COMP_RE = /cup|copa|coppa|coupe|pokal|ta[cç]a|puchar|kupasi|super ?cup|champions league|europa league|conference league|libertadores|sudamericana|nations league|world cup|friendl|emperor/i;
export const kindOf = (lg) => (COMP_RE.test(lg?.name ?? "") ? "comp" : "league");
export const codeOf = (id) => "L" + id;
export const leagueEntry = (l) => ({ id: +l.id, code: codeOf(l.id), name: l.name ?? "League " + l.id, country: l.country ?? "", women: !!l.is_women, kind: kindOf(l) });

export function pickSeasons(list, back) {
  const s = (list ?? []).filter((x) => x?.id != null).map((x) => ({ id: +x.id, name: x.name ?? null, year: x.year ?? null, cur: !!x.is_current, sd: x.start_date ?? null, ed: x.end_date ?? null }));
  s.sort((a, b) => String(b.sd ?? "").localeCompare(String(a.sd ?? "")) || b.id - a.id);
  const cur = s.find((x) => x.cur) ?? s[0];
  if (!cur) return { current: null, seasons: [] };
  const past = s.filter((x) => x.id !== cur.id).slice(0, Math.max(0, back));
  return { current: cur.id, seasons: [cur, ...past] };
}

/* ---------- events ---------- */
// API status string (lowercased, separators stripped) -> internal status. Tolerant: the API's exact wording is not guaranteed.
const STATUS_MAP = { upcoming: "notstarted", notstarted: "notstarted", scheduled: "notstarted", fixture: "notstarted", ns: "notstarted", tbd: "notstarted", created: "notstarted",
  live: "inprogress", inprogress: "inprogress", playing: "inprogress", halftime: "inprogress", ht: "inprogress", "1sthalf": "inprogress", "2ndhalf": "inprogress", extratime: "inprogress", penalties: "inprogress",
  finished: "finished", ended: "finished", ft: "finished", aet: "finished", afterpenalties: "finished", afterextratime: "finished", complete: "finished", completed: "finished",
  cancelled: "cancelled", canceled: "cancelled", abandoned: "cancelled", postponed: "postponed", suspended: "postponed", delayed: "postponed" };
export const statusOf = (s) => STATUS_MAP[String(s ?? "").toLowerCase().replace(/[\s_-]+/g, "")];
const sideObj = (e, side) => e[`${side}_team`];
export const teamNameOf = (e, side) => { const o = sideObj(e, side); return (obj(o) ? o.name : o) ?? e[`${side}_team_name`] ?? null; };
export function teamIdOf(e, side, byName) {
  const o = sideObj(e, side), id = e[`${side}_team_id`] ?? (obj(o) ? o.id : undefined);
  if (id !== undefined && id !== null && id !== "") return +id;
  return byName?.get(norm(teamNameOf(e, side))) ?? null;
}
// -> { result } | { fixture } | { skip: reason }.  home_score/away_score are regulation time, which is what the model needs.
export function toRow(e, byName) {
  if (e?.id == null) return { skip: "noid" };
  let status = statusOf(e.status);
  if (!status) {                                                            // unknown wording: only a future, scoreless match is taken as upcoming; anything else is skipped and named
    const t0 = ts(e.event_date);
    if (t0 != null && t0 > Date.now() / 1000 && num(e.home_score) == null && num(e.away_score) == null) status = "notstarted";
    else return { skip: "status", raw: String(e.status ?? "none") };
  }
  const h = teamIdOf(e, "home", byName), a = teamIdOf(e, "away", byName), t = ts(e.event_date);
  if (h == null || a == null || h === a) return { skip: "teams" };
  if (t == null) return { skip: "date" };
  const names = [[h, teamNameOf(e, "home")], [a, teamNameOf(e, "away")]];
  if (status === "finished") {
    const hg = num(e.home_score), ag = num(e.away_score);
    return hg == null || ag == null ? { skip: "score" } : { result: { id: +e.id, h, a, hg, ag, t, r: num(e.round_number) }, names };
  }
  return { fixture: { id: +e.id, h, a, t, r: num(e.round_number), s: status, g: e.group_name ?? null, rn: e.round_name ?? null }, names };
}

/* ---------- standings, leaders ---------- */
const stRow = (r) => ({ p: num(r.position), id: num(r.team_id), n: r.team_name ?? null, pl: num(r.played), w: num(r.won), d: num(r.drawn), l: num(r.lost), gf: num(r.gf), ga: num(r.ga), pts: num(r.pts), f: r.form ?? null, live: !!r.live, z: obj(r.zone) ? { k: r.zone.key ?? null, l: r.zone.label ?? null, t: r.zone.type ?? null } : null });
export function buildStandings(d) {
  if (!d) return null;
  const groups = Array.isArray(d.groups) ? d.groups.map((g) => ({ name: g.name ?? g.group ?? g.group_name ?? "", rows: firstArray(g, ["standings", "rows", "table", "results"]).map(stRow) })).filter((g) => g.rows.length) : [];
  const rows = groups.length ? [] : firstArray(d, ["standings", "table", "results"]).map(stRow);
  if (!groups.length && !rows.length) return null;
  return { rows, groups, zones: Array.isArray(d.zones) ? d.zones : obj(d.zones) ? d.zones : null };
}
export const buildLeaders = (d) => firstArray(d, ["results", "leaders", "top", "rows"]).map((r) => ({ rk: num(r.rank), id: num(r.player_id), n: r.player_name ?? null, pos: r.position ?? null, tid: num(r.team_id), tn: r.team_name ?? null, v: num(r.value), m: num(r.matches) })).filter((r) => r.id != null);

/* ---------- team form -> per-game statistics ---------- */
export function buildTeamSt(f) {
  const o = f?.overall;
  if (!o || !(num(o.matches) > 0)) return null;
  const avg = {};
  for (const [k, v] of Object.entries(o.stats ?? {})) if (v && typeof v.average === "number" && Number.isFinite(v.average)) avg[k] = Math.round(v.average * 100) / 100;
  return { n: num(o.matches), w: num(o.won), d: num(o.drawn), l: num(o.lost), gf: num(o.goals_for), ga: num(o.goals_against), ppm: num(o.points_per_match), form: o.form ?? null, avg };
}

/* ---------- match stats (stats + shotmap + average positions + momentum) ---------- */
const S8 = ["total_shots", "shots_on_target", "corner_kicks", "fouls", "yellow_cards", "red_cards", "offsides", "ball_possession"];
const xgOf = (s) => num(s?.xg?.actual ?? s?.expected_goals ?? (typeof s?.xg === "number" ? s.xg : null));
// [HS,AS, HST,AST, HC,AC, HF,AF, HY,AY, HR,AR, HP,AP, HXG,AXG]; null when the match reported nothing
export function statsRow(d) {
  const h = d?.stats?.home, a = d?.stats?.away;
  if (!obj(h) || !obj(a)) return null;
  const r = [num(h.total_shots), num(a.total_shots), num(h.shots_on_target), num(a.shots_on_target), num(h.corner_kicks), num(a.corner_kicks), num(h.fouls), num(a.fouls),
    num(h.yellow_cards), num(a.yellow_cards), num(h.red_cards), num(a.red_cards), num(h.ball_possession), num(a.ball_possession), xgOf(h), xgOf(a)];
  return r.every((v) => v == null) ? null : r;
}
const ap = (l) => firstArray({ l }, ["l"]).map((p) => ({ id: num(p.player_id ?? p.id), n: p.name ?? null, pos: p.pos ?? p.position ?? null, x: num(p.x), y: num(p.y) })).filter((p) => p.x != null && p.y != null);
export function buildStatsExtras(d) {
  const shots = firstArray({ s: d?.shotmap }, ["s"]).filter((s) => s && s.sit !== "shootout" && num(s.pos?.x) != null)
    .map((s) => ({ h: !!s.home, m: num(s.min), k: s.type ?? null, x: num(s.pos.x), y: num(s.pos.y), xg: num(s.xg), p: num(s.player_id) })).slice(0, 80);
  const avgpos = { h: ap(d?.average_positions?.home), a: ap(d?.average_positions?.away) };
  const momentum = firstArray({ m: d?.momentum }, ["m"]).map((x) => [num(x.m), num(x.v)]).filter((x) => x[0] != null && x[1] != null).slice(0, 130);
  const side = (s) => (obj(s) ? Object.fromEntries(S8.map((k) => [k, num(s[k])]).concat([["xg", xgOf(s)]])) : null);
  return { shots, avgpos: avgpos.h.length || avgpos.a.length ? avgpos : null, momentum, stats: { h: side(d?.stats?.home), a: side(d?.stats?.away) }, xgEstimated: d?.xg_estimated ?? null };
}

/* ---------- lineups ---------- */
const POS = { G: "G", D: "D", M: "M", F: "F", A: "F", S: "F", W: "F" };
const posOf = (p) => POS[String(p?.position ?? p?.pos ?? p?.player?.position ?? "").trim().toUpperCase().slice(0, 1)] ?? null;
const mkP = (p, sub) => ({ id: num(p?.player_id ?? p?.id ?? p?.player?.id), n: p?.name ?? p?.player_name ?? p?.player?.name ?? p?.short_name ?? null, pos: posOf(p), num: num(p?.shirt_number ?? p?.jersey_number ?? p?.number ?? p?.jersey ?? p?.player?.shirt_number), sub, cap: !!(p?.captain ?? p?.is_captain) });
const isSub = (p) => !!(p?.substitute ?? p?.is_substitute ?? p?.bench);
export function sheetOf(x, unavailable) {
  if (!obj(x)) return null;
  const start = firstArray({ a: x.starting_xi ?? x.starters ?? x.startXI ?? x.xi ?? x.lineup ?? x.starting ?? x.players }, ["a"]);
  const bench = firstArray({ a: x.substitutes ?? x.bench ?? x.subs }, ["a"]);
  let xi = start.filter((p) => !isSub(p)), extra = start.filter(isSub);
  if (xi.length > 11 && !bench.length && !extra.length) { extra = xi.slice(11); xi = xi.slice(0, 11); }   // starters and bench in one list, unflagged
  const players = [...xi.map((p) => mkP(p, false)), ...[...extra, ...bench].map((p) => mkP(p, true))].filter((p) => p.n);
  const missing = firstArray({ a: unavailable }, ["a"]).map((m) => ({ n: m?.name ?? m?.player_name ?? m?.player?.name ?? null, why: m?.reason ?? m?.type ?? m?.injury_type ?? null })).filter((m) => m.n);
  return players.length ? { formation: x.formation ?? null, players, missing } : null;
}
export function buildLineups(d) {
  const l = d?.lineups;
  if (!obj(l)) return null;
  const un = d.unavailable_players;
  const h = sheetOf(l.home ?? l.home_lineup ?? l.home_team, obj(un) ? un.home : null), a = sheetOf(l.away ?? l.away_lineup ?? l.away_team, obj(un) ? un.away : null);
  return h || a ? { status: d.lineup_status ?? null, confirmed: d.lineup_status ? d.lineup_status === "confirmed" : true, h, a } : null;
}

/* ---------- commentary -> goals, cards, substitutions ---------- */
const sideOf = (t) => (t === "home" ? "h" : t === "away" ? "a" : null);
const pn = (p) => (obj(p) ? p.name ?? null : null);
export function buildEvents(d) {
  const lines = firstArray(d, ["commentary", "lines", "results"]).filter((l) => l && sideOf(l.team));
  const at = (l) => ({ m: num(l.minute), x: num(l.added_time), s: sideOf(l.team) });
  const goals = lines.filter((l) => ["goal", "penalty_goal", "own_goal"].includes(l.type)).map((l) => ({ ...at(l), p: pn(l.player), a: l.type === "own_goal" ? null : pn(l.related_player), k: l.type === "penalty_goal" ? "pen" : l.type === "own_goal" ? "og" : "reg" }));
  const cards = lines.filter((l) => ["yellow_card", "second_yellow_card", "red_card"].includes(l.type)).map((l) => ({ ...at(l), p: pn(l.player), k: l.type === "yellow_card" ? "y" : l.type === "second_yellow_card" ? "yr" : "r" }));
  const subs = lines.filter((l) => l.type === "substitution").map((l) => ({ ...at(l), i: pn(l.related_player), o: pn(l.player) }));   // related = coming on, player = going off
  return { goals, cards, subs, hasLines: lines.length > 0 };
}

export function buildDetails({ id, code, lineups, stats, commentary, now = new Date().toISOString() }) {
  const ev = commentary ? buildEvents(commentary) : null, ex = stats ? buildStatsExtras(stats) : null;
  const finished = commentary?.status === "finished";
  const doc = { id: +id, league: code, finished, fetched: now, lineups: lineups ? buildLineups(lineups) : null, goals: null, cards: null, subs: null };
  if (ev && (ev.hasLines || finished)) { doc.goals = ev.goals; doc.cards = ev.cards; doc.subs = ev.subs; }
  if (ex) { doc.shots = ex.shots; doc.avgpos = ex.avgpos; doc.momentum = ex.momentum; doc.stats = ex.stats; }
  return doc;
}

/* ---------- h2h ---------- */
export function buildH2H(d, a, b) {
  const [x, y] = [+a, +b].sort((m, n) => m - n);
  const matches = firstArray(d, ["recent_matches", "matches", "results"]).map((m) => ({ id: num(m.event_id ?? m.id), t: ts(m.date), h: num(m.home_team_id), a: num(m.away_team_id), hg: num(m.home_score), ag: num(m.away_score) }))
    .filter((m) => m.t != null && m.h != null && m.a != null && m.hg != null && m.ag != null && [m.h, m.a].sort((p, q) => p - q).join() === [x, y].join()).sort((p, q) => q.t - p.t);
  return { ids: [x, y], total: num(d?.total_matches), matches };
}

/* ---------- players ---------- */
export const buildSquad = (d) => firstArray(d, ["players", "squad", "results"]).map((p) => flat(p)).filter((p) => p.id != null && (p.name ?? p.player_name));
export const rows = (d, keys) => firstArray(d, keys).map((r) => flat(r));
export function buildPlayerPack(profile, career, transfers, stats, now = new Date().toISOString()) {
  return { profile: flat(profile), career: rows(career, ["career", "seasons", "results"]).slice(0, 40), transfers: rows(transfers, ["transfers", "results"]).slice(0, 40),
    log: rows(stats, ["results", "stats", "matches"]).slice(0, 30), updated: now };
}
