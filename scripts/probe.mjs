// Spends about 20 of your 7,500 daily calls to check the token and to print the real response shapes the sync relies on.
//   npm run probe
import * as B from "./lib/bsd.mjs";
const KEY = process.env.BSD_API_KEY, BASE = (process.env.BSD_BASE || "https://sports.bzzoiro.com/api/v2").replace(/\/$/, "");
if (!KEY) { console.error("BSD_API_KEY missing in .env (free key: https://sports.bzzoiro.com/register/)"); process.exit(1); }
let left = null;
async function get(p, params = {}) {
  const u = new URL(BASE + p); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: `Token ${KEY}`, Accept: "application/json" } });
  const m = /;\s*r=(\d+)/.exec(r.headers.get("ratelimit") ?? ""); if (m) left = +m[1];
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const ok = (c, m) => console.log((c ? "  PASS " : "  FAIL ") + m);
const keys = (o) => Object.keys(o ?? {}).join(", ");
const need = async (label, p, params) => { const r = await get(p, params); if (r.status !== 200) { console.log(`  FAIL ${label}: HTTP ${r.status} ${r.text.slice(0, 140)}`); if (r.status === 401) process.exit(1); } return r.status === 200 ? r.json : null; };

console.log("1) Competitions");
const lg = await need("leagues", "/leagues/", { limit: 200 });
const leagues = B.firstArray(lg, ["results"]);
ok(leagues.length > 0, `${leagues.length} competitions (catalog); first: ${JSON.stringify(leagues[0])}`);
const L = leagues.find((l) => /^premier league$/i.test(l.name) && /england/i.test(l.country ?? "")) ?? leagues[0];
console.log(`   using "${L?.name}" (id ${L?.id}) for the checks below`);

console.log("2) Seasons, standings, top scorers");
const seasons = B.pickSeasons(B.firstArray(await need("seasons", `/leagues/${L.id}/seasons/`), ["results", "seasons"]), 1);
ok(!!seasons.current, `current season id ${seasons.current}; list keys: ${keys(B.firstArray(await need("seasons2", `/leagues/${L.id}/seasons/`), ["results", "seasons"])[0])}`);
const st = B.buildStandings(await need("standings", `/leagues/${L.id}/standings/`, { season_id: seasons.current }));
ok(!!st, st ? `${st.rows.length || st.groups.length + " groups"} rows; first: ${JSON.stringify(st.rows[0] ?? st.groups[0]?.rows[0])}` : "no standings parsed");
const top = B.buildLeaders(await need("top", `/leagues/${L.id}/top/scorers/`, { season_id: seasons.current, limit: 3 }));
ok(top.length > 0, `top scorers parsed: ${JSON.stringify(top[0])}`);

console.log("3) Events (the team-id check matters most)");
const ev = await need("events", "/events/", { league_id: L.id, season_id: seasons.current, limit: 200 });
const events = B.firstArray(ev, ["results"]), sample = events.find((e) => B.statusOf(e.status) === "finished") ?? events[0];
console.log("   status values seen:", JSON.stringify(events.reduce((a, e) => ({ ...a, [e.status]: (a[e.status] ?? 0) + 1 }), {})), "| first/last event_date:", events[0]?.event_date, events.at(-1)?.event_date);
ok(events.length > 0, `${events.length} events on page 1 of ${ev?.count}; keys: ${keys(sample)}`);
ok(sample && (sample.home_team_id != null || typeof sample.home_team === "object"), sample && (sample.home_team_id != null || typeof sample.home_team === "object") ? "events carry team ids" : "events carry team NAMES only: the sync maps names to ids through the teams list (check the next line)");
const teams = B.firstArray(await need("teams", "/teams/", { league_id: L.id, season_id: seasons.current, limit: 200 }), ["results"]);
const byName = new Map(teams.map((t) => [B.norm(t.name), t.id]));
const rows = events.map((e) => B.toRow(e, byName)), usable = rows.filter((r) => r.result || r.fixture).length;
ok(usable === events.length, `${usable}/${events.length} events usable. skipped: ${JSON.stringify(rows.filter((r) => r.skip).reduce((a, r) => ({ ...a, [r.raw ? r.skip + ":" + r.raw : r.skip]: (a[r.raw ? r.skip + ":" + r.raw : r.skip] ?? 0) + 1 }), {}))}`);

console.log("4) Team: profile, squad, form statistics");
const T = teams[0];
ok(!!T, `team: ${JSON.stringify(B.flat(T))}`);
if (T) {
  const prof = await need("team", `/teams/${T.id}/`); ok(!!prof, "profile keys: " + keys(prof));
  const sq = B.buildSquad(await need("squad", `/teams/${T.id}/squad/`)); ok(sq.length > 0, `${sq.length} squad players; first: ${JSON.stringify(sq[0])}`);
  const form = B.buildTeamSt(await need("form", `/teams/${T.id}/form/`, { last: 20, league_id: L.id })); ok(!!form, form ? `form stats keys: ${keys(form.avg)}` : "no form statistics");
}

console.log("5) Transfers and a player");
const tr = B.firstArray(await need("transfers", "/transfers/", { league_id: L.id, limit: 3 }), ["results"]);
ok(tr.length > 0, `transfer row keys: ${keys(B.flat(tr[0]))}`);
const led = B.firstArray(await need("ledger", "/transfers/ledger/", { league_id: L.id }), ["clubs", "results", "ledger"]);
ok(led.length > 0, `ledger club keys: ${keys(led[0])}`);
const pid = top[0]?.id;
if (pid) {
  const pl = await need("player", `/players/${pid}/`); ok(!!pl, "player keys: " + keys(B.flat(pl)));
  const pk = B.buildPlayerPack(pl, await need("career", `/players/${pid}/career/`), await need("ptransfers", `/players/${pid}/transfers/`), await need("pstats", `/players/${pid}/stats/`));
  ok(true, `career rows ${pk.career.length} (keys: ${keys(pk.career[0])}), transfer rows ${pk.transfers.length}, match log rows ${pk.log.length}`);
}

console.log("6) A finished match: stats, lineups, commentary, head-to-head");
const fin = events.find((e) => B.statusOf(e.status) === "finished");
if (fin) {
  const stats = await need("stats", `/events/${fin.id}/stats/`), row = B.statsRow(stats), ex = B.buildStatsExtras(stats ?? {});
  ok(!!row, row ? `stats row ${JSON.stringify(row)}; shots ${ex.shots.length}; average positions ${ex.avgpos ? ex.avgpos.h.length + "+" + ex.avgpos.a.length : "none"}` : "no match statistics");
  const lu = await need("lineups", `/events/${fin.id}/lineups/`), sheet = B.buildLineups(lu);
  ok(!!sheet, sheet ? `lineups: home ${sheet.h?.players.length ?? 0} players, formation ${sheet.h?.formation}` : "no lineups parsed. top-level keys: " + keys(lu) + "; lineups keys: " + keys(lu?.lineups) + "; home keys: " + keys(lu?.lineups?.home));
  const co = B.buildEvents(await need("commentary", `/events/${fin.id}/commentary/`)); ok(co.hasLines, `commentary: ${co.goals.length} goals, ${co.cards.length} cards, ${co.subs.length} subs`);
  const h2h = B.buildH2H(await need("h2h", `/events/${fin.id}/h2h/`), B.teamIdOf(fin, "home", byName), B.teamIdOf(fin, "away", byName)); ok(h2h.matches.length > 0, `head-to-head: ${h2h.matches.length} past meetings of ${h2h.total}`);
} else console.log("  SKIP no finished match on the first page");

console.log("7) Scorers, referee, venue, managers (about 12 calls). These field names are NOT spelled out in the docs: the lines below show what the API really sends");
const snip = (v) => JSON.stringify(v)?.slice(0, 260);
console.log("   /events/ list rows carry:", ["referee", "venue", "coaches", "home_coach", "attendance"].map((k) => `${k}=${sample && k in sample ? "yes" : "no"}`).join(" "));
if (fin) {
  const detail = await need("event detail", `/events/${fin.id}/`);
  if (detail) {
    console.log("   event detail keys:", keys(detail));
    for (const k of ["referee", "venue", "coaches", "home_coach", "away_coach", "attendance"]) if (k in detail) console.log(`   detail.${k} =`, snip(detail[k]));
    const info = B.infoOf(detail); ok(!!info, info ? `infoOf read: ${JSON.stringify(info)}` : "infoOf found NOTHING: send me the detail.* lines above");
    ok(!!info?.rf, info?.rf ? "referee found" : "no referee on this match (may be unassigned) or the field name differs");
    ok(!!info?.vn, info?.vn ? "venue found" : "no venue found");
    ok(!!(info?.hc && info?.ac), info?.hc && info?.ac ? "both managers found" : "managers NOT found: send me detail.coaches");
    const co = await need("commentary", `/events/${fin.id}/commentary/`), gr = B.goalsRow(co, B.num(detail.home_score), B.num(detail.away_score));
    ok(gr.complete === true || (gr.n === 0 && gr.complete === null), `scorers: ${gr.n} regulation goal(s) found, complete=${gr.complete} (score ${detail.home_score}-${detail.away_score}); first: ${snip(gr.g[0])}`);
    const inc = await need("incidents", `/events/${fin.id}/incidents/`), list = B.firstArray(inc, ["incidents", "results"]);
    console.log("   incidents (undocumented goal shape), first goal:", snip(list.find((x) => x?.type === "goal")) ?? "none", "| top-level keys:", keys(inc));
  }
}
const mg = B.firstArray(await need("managers", "/managers/", { league_id: L.id, limit: 3 }), ["results"]);
ok(mg.length > 0, `managers list keys: ${keys(mg[0])}`);
if (mg[0]) {
  const mp = await need("manager", `/managers/${mg[0].id}/`); ok(!!mp, "manager profile keys: " + keys(mp));
  const cp = await need("career", `/managers/${mg[0].id}/career/`), spells = B.firstArray(cp, ["career", "spells", "results"]).map(B.spellOf);
  ok(spells.length > 0, `career spells ${spells.length}; first: ${snip(spells[0])}; appointment_effect present: ${spells.some((s) => s.ae)}`);
}
const rf = B.firstArray(await need("referees", "/referees/", { league_id: L.id, limit: 3 }), ["results"]);
ok(rf.length > 0, `referees list keys: ${keys(rf[0])}`);
if (rf[0]) { const rp = await need("referee", `/referees/${rf[0].id}/`); ok(!!rp, "referee profile (flattened) keys: " + keys(B.flat2(rp))); }
const vn = B.firstArray(await need("venues", "/venues/", { team_id: T?.id, limit: 3 }), ["results"]);
ok(vn.length > 0, `venues list keys: ${keys(vn[0])}`);
if (vn[0]) { const vp = await need("venue", `/venues/${vn[0].id}/`); ok(!!vp, "venue profile (flattened) keys: " + keys(B.flat2(vp))); }
console.log(`\nCalls left today: ${left ?? "unlimited / not reported"}. Send me any FAIL lines and the key lists printed above.`);
