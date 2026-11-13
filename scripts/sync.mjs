// BetIQ data sync: Bzzoiro Sports Data (BSD) football API v2 -> Firestore.  https://sports.bzzoiro.com/docs/football/
//
// The token lives ONLY here (local .env or a GitHub secret), never in the browser. The free tier allows 7,500 calls per day
// (reset at midnight UTC), read from the `RateLimit` response header, so this script is:
//   * budgeted    - MAX_REQUESTS per run, and it stops when the account has QUOTA_RESERVE calls left (500; 20 for --requests-only so users' requests always get served)
//   * prioritised - users' queued requests first, then competitions by staleness, then rolling jobs (squads, stats, players)
//   * resumable   - every timestamp lives in the stored documents; an interrupted run simply continues next time
//
// Env: BSD_API_KEY (required). Optional: SYNC_LEAGUES (all | 1,3,4), SYNC_EXCLUDE, SEASONS_BACK, MAX_REQUESTS, QUOTA_RESERVE,
//      TEAMPACK_PER_RUN, MSTATS_PER_RUN, H2H_PER_RUN, PLAYERS_PER_RUN, REQUESTS_PER_RUN, REQUESTS_ONLY=1, DRY_RUN=1, BSD_BASE
import fs from "node:fs";
import path from "node:path";
import * as B from "./lib/bsd.mjs";

const env = process.env, int = (k, d) => (Number.isFinite(+env[k]) && env[k] !== undefined && env[k] !== "" ? +env[k] : d);
const KEY = env.BSD_API_KEY, BASE = (env.BSD_BASE || "https://sports.bzzoiro.com/api/v2").replace(/\/$/, "");
const DRY = env.DRY_RUN === "1", REQ_ONLY = env.REQUESTS_ONLY === "1" || process.argv.includes("--requests-only");
// --back=N --ahead=N: only fetch current-season matches dated within N days back / N days ahead of today (merged into what is already stored).
// Either flag implies --force (ignore the refresh TTLs). The missing side defaults to 365 days.
const flag = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); const v = a ? +a.split("=")[1] : NaN; return Number.isFinite(v) && v >= 0 ? v : null; };
const W_BACK = flag("back"), W_AHEAD = flag("ahead"), FORCE = process.argv.includes("--force") || W_BACK !== null || W_AHEAD !== null;
const WIN = W_BACK !== null || W_AHEAD !== null ? { from: Date.now() - (W_BACK ?? 365) * 864e5, to: Date.now() + (W_AHEAD ?? 365) * 864e5 } : null;
const MAX = int("MAX_REQUESTS", 6000), RESERVE = int("QUOTA_RESERVE", REQ_ONLY ? 20 : 500), PAUSE = int("REQUEST_PAUSE_MS", 70);
const BACK = int("SEASONS_BACK", 5);                       // past seasons per competition (head-to-head depth, model data)
const CORE_BUDGET = int("CORE_BUDGET", 3500);              // calls for competition refreshes per run
const TOP_TTL_H = int("TOP_TTL_HOURS", 3), TTL_H = int("CORE_TTL_HOURS", 12);
const LEADERS_TTL_H = int("LEADERS_TTL_HOURS", 24), TRANSFERS_TTL_H = int("TRANSFERS_TTL_HOURS", 24), TRANSFER_DAYS = int("TRANSFER_DAYS", 180);
const PACK_N = int("TEAMPACK_PER_RUN", 400), PACK_TTL_D = int("TEAMPACK_TTL_DAYS", 4);
const MS_COMP = int("MSTATS_PER_COMP", 15), MS_RUN = int("MSTATS_PER_RUN", 600);
const H2H_UP = int("H2H_UPCOMING", 3), H2H_RUN = int("H2H_PER_RUN", 250), H2H_TTL_D = int("H2H_TTL_DAYS", 7);
const PLAYERS_RUN = int("PLAYERS_PER_RUN", 100), REQS_RUN = int("REQUESTS_PER_RUN", 60);
const TOP = [1, 3, 4, 5, 6, 7, 8, 83, 64, 10, 2, 12, 18, 17];   // most used competitions: refreshed more often and synced first

if (!KEY) { console.error("BSD_API_KEY is missing. Put it in .env (local) or a GitHub secret. Register free at https://sports.bzzoiro.com/register/"); process.exit(1); }

/* ---------- storage: Firestore, or ./.sync-out when DRY_RUN=1 ---------- */
let store;
if (DRY) {
  const file = (p) => path.join(".sync-out", p + ".json");
  store = {
    get: async (p) => { try { return JSON.parse(fs.readFileSync(file(p), "utf8")); } catch { return null; } },
    set: async (p, d) => { fs.mkdirSync(path.dirname(file(p)), { recursive: true }); fs.writeFileSync(file(p), JSON.stringify(d)); },
    list: async (c) => { try { return fs.readdirSync(path.join(".sync-out", c)).map((f) => ({ id: f.replace(/\.json$/, ""), data: JSON.parse(fs.readFileSync(path.join(".sync-out", c, f), "utf8")) })); } catch { return []; } },
    del: async (p) => { try { fs.unlinkSync(file(p)); } catch { /* already gone */ } },
  };
} else {
  const admin = (await import("firebase-admin")).default;
  const sa = env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : JSON.parse(fs.readFileSync("serviceAccountKey.json", "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();
  store = {
    get: async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; },
    set: (p, d) => db.doc(p).set(d),
    list: async (c) => (await db.collection(c).get()).docs.map((x) => ({ id: x.id, data: x.data() })),
    del: (p) => db.doc(p).delete(),
  };
}
const put = (p, d) => store.set(p, JSON.parse(JSON.stringify(d)));   // drops undefined/NaN: Firestore rejects them

/* ---------- API client ---------- */
class Stop extends Error {}                                   // quota/budget/auth: end the run cleanly, keep progress
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
let used = 0, remaining = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString(), isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const hoursSince = (s) => (s ? (Date.now() - Date.parse(s)) / 36e5 : Infinity);
const log = (...a) => console.log(...a), warn = (what, e) => console.warn(`  ! ${what}: ${e.message ?? e}`);

async function api(p, params = {}, tries = 3) {
  if (used >= MAX) throw new Stop(`request budget reached (${MAX} per run; raise MAX_REQUESTS)`);
  if (remaining !== null && remaining <= RESERVE) throw new Stop(`only ${remaining} calls left in today's quota (resets 00:00 UTC)`);
  const url = new URL(BASE + p);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  used++; await sleep(PAUSE);
  let r;
  try { r = await fetch(url, { headers: { Authorization: `Token ${KEY}`, Accept: "application/json" } }); }
  catch (e) { if (tries > 1) { await sleep(1500); return api(p, params, tries - 1); } throw new ApiError(`${p}: network error ${e.message}`, 0); }
  const rl = r.headers.get("ratelimit"), m = rl && /;\s*r=(\d+)/.exec(rl);   // RateLimit: "football";r=7213;t=52800  (absent on paid plans = unlimited)
  if (m) remaining = +m[1];
  if (r.status === 401) throw new Stop("HTTP 401: BSD_API_KEY is missing or invalid");
  if (r.status === 429) {
    const body = await r.json().catch(() => ({}));
    if (body.code === "taster_exhausted") throw new Stop("daily quota exhausted (resets 00:00 UTC)");
    if (tries > 1) { await sleep(Math.max(1, +r.headers.get("retry-after") || 1) * 1000); return api(p, params, tries - 1); }
    throw new Stop("rate limited (429) repeatedly");
  }
  if (r.status >= 500 && tries > 1) { await sleep(2000); return api(p, params, tries - 1); }
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new ApiError(`${p} -> HTTP ${r.status}${b.detail ? ": " + String(b.detail).slice(0, 160) : ""}`, r.status); }
  return r.json();
}
// Paginated list endpoints ({count,next,results}); limit max 200
async function pages(p, params = {}, maxPages = 40) {
  const out = [];
  for (let i = 0, offset = 0; i < maxPages; i++) {
    const d = await api(p, { ...params, limit: 200, offset }), list = B.firstArray(d, ["results"]);
    out.push(...list);
    if (Array.isArray(d) || !d?.next || !list.length) break;
    offset += list.length;
  }
  return out;
}
const soft = async (what, fn, fallback = null) => { try { return await fn(); } catch (e) { if (e instanceof Stop) throw e; warn(what, e); return fallback; } };

/* ---------- competition state ---------- */
async function openComp(lg) {
  const meta = (await store.get(`meta/${lg.code}`)) ?? { code: lg.code };
  const teams = new Map(((await store.get(`teams/${lg.code}`))?.list ?? []).map((t) => [t.id, t]));
  return { ...lg, meta, teams, cur: new Map(), fixtures: new Map(), mstats: null, mstatsDirty: false };
}
function setTeam(L, id, name, extra = {}) {
  if (id == null) return;
  const old = L.teams.get(id) ?? { id };
  L.teams.set(id, { ...old, id, name: name ?? old.name ?? `Team ${id}`, ...(extra.country_code ? { cc: extra.country_code } : {}), ...(extra.country ? { country: extra.country } : {}) });
}
// a team is "active" when it appears in the current season's matches or standings
function markActive(L) {
  const act = new Set([...L.fixtures.values(), ...L.cur.values()].flatMap((x) => [x.h, x.a]));
  for (const r of L.standingIds ?? []) act.add(r);
  if (L.cur.size || L.fixtures.size || L.standingIds) for (const t of L.teams.values()) t.active = act.has(t.id);
}
async function flush(L) {
  const now = iso();
  markActive(L);
  await put(`teams/${L.code}`, { code: L.code, list: [...L.teams.values()], updated: now });
  await put(`meta/${L.code}`, { ...L.meta, code: L.code, id: L.id, name: L.name, country: L.country, kind: L.kind, women: L.women, updated: now });
  if (L.mstatsDirty) await put(`mstats/${L.code}`, { code: L.code, m: L.mstats, updated: now });
}

/* ---------- competition jobs ---------- */
async function refreshCore(L) {
  const m = L.meta;
  if (!m.seasons?.length || m.back !== BACK || hoursSince(m.seasonsAt) > 24 * 7) {
    const ps = B.pickSeasons(B.firstArray(await api(`/leagues/${L.id}/seasons/`), ["results", "seasons"]), BACK);
    if (!ps.current) throw new ApiError("no seasons returned", 0);
    m.seasons = ps.seasons; m.current = ps.current; m.back = BACK; m.seasonsAt = iso();
  }
  if (!L.teams.size || hoursSince(m.teamsAt) > 24 * 7) {
    let list = await pages("/teams/", { league_id: L.id, season_id: m.current });
    if (!list.length) list = await pages("/teams/", { league_id: L.id });
    for (const t of list) setTeam(L, t?.id != null ? +t.id : null, t.name, t);
    m.teamsAt = iso();
  }
  const evs = await pages("/events/", { league_id: L.id, season_id: m.current, ...(WIN ? { date_from: isoDay(WIN.from), date_to: isoDay(WIN.to) } : {}) });
  const byName = new Map([...L.teams.values()].map((t) => [B.norm(t.name), t.id])), skips = {};
  for (const e of evs) {
    const r = B.toRow(e, byName);
    if (r.skip) { const k = r.raw ? `${r.skip}:${r.raw}` : r.skip; skips[k] = (skips[k] ?? 0) + 1; continue; }
    for (const [id, name] of r.names) setTeam(L, id, name);
    if (r.result) L.cur.set(r.result.id, r.result); else L.fixtures.set(r.fixture.id, r.fixture);
  }
  if (WIN) {                                                      // a windowed fetch must not shrink what is already stored
    const prevS = await store.get(`seasons/${L.code}_${m.current}`), prevF = await store.get(`fixtures/${L.code}`), lo = WIN.from / 1000, hi = WIN.to / 1000;
    for (const r of prevS?.results ?? []) if (!L.cur.has(r.id) && !(r.t >= lo && r.t <= hi)) L.cur.set(r.id, r);
    for (const f of prevF?.list ?? []) if (!L.fixtures.has(f.id) && !L.cur.has(f.id) && !(f.t >= lo && f.t <= hi)) L.fixtures.set(f.id, f);
  }
  if (evs.length && !L.cur.size && !L.fixtures.size) throw new ApiError(`${evs.length} events but none usable (skipped: ${JSON.stringify(skips)}); run npm run probe`, 0);
  const now = iso(), cur = m.seasons.find((s) => s.id === m.current);
  await put(`seasons/${L.code}_${m.current}`, { code: L.code, seasonId: m.current, year: cur?.year ?? cur?.name ?? null, results: [...L.cur.values()].sort((a, b) => b.t - a.t), updated: now });
  await put(`fixtures/${L.code}`, { code: L.code, list: [...L.fixtures.values()].sort((a, b) => a.t - b.t), updated: now });
  m.skips = Object.keys(skips).length ? skips : undefined;
  const st = await soft(`${L.code} standings`, async () => B.buildStandings(await api(`/leagues/${L.id}/standings/`, { season_id: m.current })));
  if (st) {
    await put(`standings/${L.code}`, { code: L.code, seasonId: m.current, ...st, updated: now });
    L.standingIds = [...st.rows, ...st.groups.flatMap((g) => g.rows)].map((r) => r.id).filter((x) => x != null);
    for (const r of [...st.rows, ...st.groups.flatMap((g) => g.rows)]) if (r.id != null) setTeam(L, r.id, r.n);
  }
  markActive(L);
  m.coreAt = now;
  m.counts = { fixtures: L.fixtures.size, results: { ...(m.counts?.results ?? {}), [m.current]: L.cur.size } };
}

async function backfillPast(L) {                              // finished seasons never change: fetched once
  const m = L.meta;
  for (const s of (m.seasons ?? []).slice(1)) {
    const done = m.past?.[s.id];
    if (done && (done.n > 0 || hoursSince(done.at) < 24 * 30)) continue;
    const evs = await pages("/events/", { league_id: L.id, season_id: s.id });
    const byName = new Map([...L.teams.values()].map((t) => [B.norm(t.name), t.id])), res = new Map();
    for (const e of evs) {
      const r = B.toRow(e, byName);
      if (!r.result) continue;
      res.set(r.result.id, r.result);
      for (const [id, name] of r.names) if (!L.teams.has(id)) setTeam(L, id, name);
    }
    await put(`seasons/${L.code}_${s.id}`, { code: L.code, seasonId: s.id, year: s.year ?? s.name ?? null, results: [...res.values()].sort((a, b) => b.t - a.t), updated: iso() });
    (m.past ??= {})[s.id] = { n: res.size, at: iso() };
    (m.counts ??= {}).results = { ...(m.counts.results ?? {}), [s.id]: res.size };
  }
}

async function refreshLeaders(L) {
  const out = { code: L.code, seasonId: L.meta.current, updated: iso() };
  for (const stat of ["scorers", "assists", "yellowcards", "redcards"]) out[stat] = (await soft(`${L.code} top ${stat}`, async () => B.buildLeaders(await api(`/leagues/${L.id}/top/${stat}/`, { season_id: L.meta.current, limit: 20 })))) ?? [];
  await put(`leaders/${L.code}`, out);
  L.meta.leadersAt = out.updated;
  return out;
}

async function refreshTransfers(L) {
  const from = isoDay(Date.now() - TRANSFER_DAYS * 864e5), to = isoDay(Date.now());
  const list = await pages("/transfers/", { league_id: L.id, date_from: from, date_to: to }, 3);
  const ledger = (await soft(`${L.code} ledger`, async () => B.firstArray(await api("/transfers/ledger/", { league_id: L.id, date_from: from }), ["clubs", "results", "ledger"]), [])).slice(0, 40);
  await put(`transfers/${L.code}`, { code: L.code, from, to, list: list.map((t) => B.flat(t)).slice(0, 600), ledger, updated: iso() });
  L.meta.transfersAt = iso();
}

async function matchStats(L, cap) {                           // per-match shots/corners/cards/possession/xG for the newest finished matches
  L.mstats ??= (await store.get(`mstats/${L.code}`))?.m ?? {};
  const todo = [...L.cur.values()].sort((a, b) => b.t - a.t).filter((r) => L.mstats[r.id] === undefined).slice(0, cap);
  let n = 0;
  for (const r of todo) {
    const d = await soft(`${L.code} stats ${r.id}`, () => api(`/events/${r.id}/stats/`));
    if (!d) continue;
    const row = B.statsRow(d);
    if (row) { L.mstats[r.id] = row; L.mstatsDirty = true; n++; }
    else if (Date.now() / 1000 - r.t > 3 * 86400) { L.mstats[r.id] = 0; L.mstatsDirty = true; }   // nothing reported and settled: stop asking
  }
  return n;
}

async function autoH2H(L, cap) {
  let n = 0;
  for (const f of [...L.fixtures.values()].filter((x) => x.s === "notstarted").sort((a, b) => a.t - b.t).slice(0, H2H_UP)) {
    if (n >= cap) break;
    const key = `${Math.min(f.h, f.a)}_${Math.max(f.h, f.a)}`, old = await store.get(`h2h/${key}`);
    if (old && hoursSince(old.fetched) < H2H_TTL_D * 24) continue;
    const d = await soft(`${L.code} h2h ${key}`, () => api(`/events/${f.id}/h2h/`));
    if (!d) continue;
    await put(`h2h/${key}`, { ...B.buildH2H(d, f.h, f.a), fetched: iso() }); n++;
  }
  return n;
}

/* ---------- rolling jobs: squads + team statistics, player profiles ---------- */
async function teamPacks(idx, comps, packUsed) {
  const now = Date.now() / 1000, due = [...idx.values()].filter((t) => !t.pk || now - t.pk > PACK_TTL_D * 86400)
    .sort((a, b) => (a.pk ?? 0) - (b.pk ?? 0) || (comps.get(a.code)?.kind === "league" ? -1 : 1)).slice(0, PACK_N);
  const byCode = new Map();
  for (const t of due) (byCode.get(t.code) ?? byCode.set(t.code, []).get(t.code)).push(t);
  let n = 0;
  for (const [code, list] of byCode) {
    const lg = comps.get(code); if (!lg) continue;
    const L = packUsed.get(code) ?? (await openComp(lg));
    try {
      for (const t of list) {
        const [profile, squad, form] = [
          await soft(`${code} team ${t.id}`, () => api(`/teams/${t.id}/`)),
          await soft(`${code} squad ${t.id}`, () => api(`/teams/${t.id}/squad/`)),
          await soft(`${code} form ${t.id}`, () => api(`/teams/${t.id}/form/`, { last: 20, league_id: lg.id })),
        ];
        if (!profile && !squad && !form) continue;
        const entry = L.teams.get(t.id) ?? { id: t.id, name: t.name };
        const st = B.buildTeamSt(form); if (st) entry.st = st;
        L.teams.set(t.id, entry);
        await put(`squads/${t.id}`, { id: t.id, name: t.name, code, profile: B.flat(profile ?? {}), players: B.buildSquad(squad), updated: iso() });
        t.pk = now; n++;
      }
    } finally { await flush(L); }
  }
  return n;
}

async function playerPacks(ids) {
  let n = 0;
  for (const id of ids) {
    if (n >= PLAYERS_RUN) break;
    if (await store.get(`players/${id}`)) continue;
    const pack = await fetchPlayer(id);
    if (pack) { await put(`players/${id}`, { id, ...pack }); n++; }
  }
  return n;
}
async function fetchPlayer(id) {
  const profile = await soft(`player ${id}`, () => api(`/players/${id}/`));
  if (!profile) return null;
  const [career, transfers, stats] = [await soft(`career ${id}`, () => api(`/players/${id}/career/`)), await soft(`transfers ${id}`, () => api(`/players/${id}/transfers/`)), await soft(`stats ${id}`, () => api(`/players/${id}/stats/`))];
  return B.buildPlayerPack(profile, career, transfers, stats);
}

/* ---------- users' requests (queued from the app) ---------- */
async function fulfillRequests() {
  const reqs = await store.list("requests");
  let n = 0;
  for (const r of reqs) {
    if (n++ >= REQS_RUN) break;
    const d = r.data ?? {};
    try {
      if (d.kind === "details" && Number.isFinite(+d.eid) && d.league) {
        const eid = +d.eid;
        const [lineups, commentary, stats] = [await soft(`lineups ${eid}`, () => api(`/events/${eid}/lineups/`)), await soft(`commentary ${eid}`, () => api(`/events/${eid}/commentary/`)), await soft(`stats ${eid}`, () => api(`/events/${eid}/stats/`))];
        if (!lineups && !commentary && !stats) throw new ApiError("nothing available", 0);
        await put(`details/${eid}`, B.buildDetails({ id: eid, code: d.league, lineups, commentary, stats }));
        const row = stats ? B.statsRow(stats) : null;
        if (row) { const doc = (await store.get(`mstats/${d.league}`)) ?? { code: d.league, m: {} }; doc.m[eid] = row; await put(`mstats/${d.league}`, { ...doc, updated: iso() }); }
        log(`request: details for match ${eid}`);
      } else if (d.kind === "h2h" && Number.isFinite(+d.eid) && Number.isFinite(+d.h) && Number.isFinite(+d.a)) {
        const data = await api(`/events/${+d.eid}/h2h/`);
        const doc = B.buildH2H(data, +d.h, +d.a);
        await put(`h2h/${doc.ids[0]}_${doc.ids[1]}`, { ...doc, fetched: iso() });
        log(`request: head-to-head ${doc.ids.join(" v ")} (${doc.matches.length} meetings)`);
      } else if (d.kind === "player" && Number.isFinite(+d.pid)) {
        const pack = await fetchPlayer(+d.pid);
        if (!pack) throw new ApiError("player not found", 404);
        await put(`players/${+d.pid}`, { id: +d.pid, ...pack });
        log(`request: player ${d.pid}`);
      }
    } catch (e) { if (e instanceof Stop) throw e; warn(`request ${r.id}`, e); }
    await store.del(`requests/${r.id}`);                       // done, or permanently failed: do not retry forever
  }
}

/* ---------- run ---------- */
const opened = [];
let catalog = null, idx = new Map();
try {
  await fulfillRequests();
  if (!REQ_ONLY) {
    // catalog: every competition BSD covers
    const prev = await store.get("catalog/main");
    if (prev && hoursSince(prev.fetched) < 24) catalog = prev;
    else {
      const list = (await pages("/leagues/", {})).filter((l) => l?.id != null).map(B.leagueEntry), old = new Map((prev?.leagues ?? []).map((l) => [l.id, l]));
      catalog = { fetched: iso(), leagues: list.map((l) => ({ ...l, s: old.get(l.id)?.s ?? null })) };
    }
    const want = (env.SYNC_LEAGUES ?? "all").trim().toLowerCase(), skip = new Set((env.SYNC_EXCLUDE ?? "").split(",").map((x) => +x).filter(Boolean));
    const ids = want === "all" ? null : new Set(want.split(",").map((x) => +x).filter(Boolean));
    const comps = new Map(catalog.leagues.filter((l) => (!ids || ids.has(l.id)) && !skip.has(l.id)).map((l) => [l.code, l]));
    log(`${comps.size} competitions selected of ${catalog.leagues.length} available`);
    if (WIN) log(`window: ${isoDay(WIN.from)} .. ${isoDay(WIN.to)} (forced refresh)`); else if (FORCE) log("forced refresh");
    for (const t of (await store.get("index/teams"))?.t ?? []) idx.set(t[0], { id: t[0], name: t[1], code: t[2], pk: t[3] });

    const rank = (l) => (TOP.includes(l.id) ? TOP.indexOf(l.id) : 1000 + l.id), ttl = (l) => (TOP.includes(l.id) ? TOP_TTL_H : TTL_H);
    const due = [...comps.values()].filter((l) => FORCE || hoursSince(l.s?.at) > ttl(l)).sort((a, b) => (Date.parse(a.s?.at) || 0) - (Date.parse(b.s?.at) || 0) || rank(a) - rank(b));
    const coreStart = used, leaderIds = [], packUsed = new Map();
    let ms = 0, h2h = 0;
    for (const lg of due) {
      if (used - coreStart >= CORE_BUDGET) { log("core budget used; remaining competitions continue next run"); break; }
      const L = await openComp(lg); opened.push(L);
      try {
        await refreshCore(L);
        if (BACK > 0) await backfillPast(L);
        if (hoursSince(L.meta.leadersAt) > LEADERS_TTL_H) { const ld = await refreshLeaders(L); for (const s of ["scorers", "assists"]) for (const r of ld[s]) leaderIds.push(r.id); }
        if (hoursSince(L.meta.transfersAt) > TRANSFERS_TTL_H) await soft(`${L.code} transfers`, () => refreshTransfers(L));
        if (ms < MS_RUN) ms += await matchStats(L, Math.min(MS_COMP, MS_RUN - ms));
        if (h2h < H2H_RUN) h2h += await autoH2H(L, H2H_RUN - h2h);
        for (const t of L.teams.values()) if (t.active) { const o = idx.get(t.id); if (!o || (o.code !== L.code && comps.get(o.code)?.kind !== "league" && L.kind === "league")) idx.set(t.id, { id: t.id, name: t.name, code: L.code, pk: o?.pk }); }
        const results = Object.values(L.meta.counts?.results ?? {}).reduce((a, b) => a + b, 0);
        const c = catalog.leagues.find((x) => x.id === L.id); if (c) c.s = { at: iso(), teams: [...L.teams.values()].filter((t) => t.active).length, results, fixtures: L.fixtures.size };
        packUsed.set(L.code, L);
        log(`${L.code} ${L.name}: ${L.cur.size} results, ${L.fixtures.size} fixtures, ${L.teams.size} teams`);
      } catch (e) {
        if (e instanceof Stop) throw e;
        warn(`${L.code} ${L.name}`, e);
        const c = catalog.leagues.find((x) => x.id === L.id); if (c) c.s = { ...(c.s ?? {}), at: iso(), err: String(e.message).slice(0, 120) };
      } finally { await flush(L); }
    }
    await teamPacks(idx, comps, packUsed);
    await playerPacks([...new Set(leaderIds)]);
  }
  log("Sync finished.");
} catch (e) {
  if (e instanceof Stop) console.warn("Stopped early: " + e.message + "\nProgress is saved; the next run continues from here.");
  else { console.error(e); process.exitCode = 1; }
} finally {
  if (catalog) {
    await put("catalog/main", { ...catalog, updated: iso() });
    await put("index/teams", { updated: iso(), t: [...idx.values()].map((t) => [t.id, t.name, t.code, t.pk ?? 0]) });
  }
  log(`API calls this run: ${used}${remaining !== null ? ` | calls left today: ${remaining}` : ""}${DRY ? " | DRY RUN (wrote ./.sync-out)" : ""}`);
}
