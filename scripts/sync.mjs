// BetIQ data sync: Bzzoiro Sports Data (BSD) football API v2 -> Firestore.  https://sports.bzzoiro.com/docs/football/
//
// The token lives ONLY here (local .env or a GitHub secret), never in the browser. The free tier allows 7,500 calls per day
// (reset at midnight UTC), read from the `RateLimit` response header, so this script is:
//   * budgeted    - MAX_REQUESTS per run, and it stops when the account has QUOTA_RESERVE calls left (500; 20 for --requests-only so users' requests always get served)
//   * prioritised - users' queued requests first, then competitions by staleness, then rolling jobs (squads, stats, players)
//   * resumable   - every timestamp lives in the stored documents; an interrupted run simply continues next time
//
// Env: BSD_API_KEY (required). Optional: SYNC_LEAGUES (all | 1,3,4), SYNC_EXCLUDE, SEASONS_BACK, MAX_REQUESTS, QUOTA_RESERVE,
//      TEAMPACK_PER_RUN, MSTATS_PER_RUN, H2H_PER_RUN, PLAYERS_PER_RUN, REQUESTS_PER_RUN, REQUESTS_ONLY=1, DRY_RUN=1, BSD_BASE,
//      GOALS_PER_COMP, GOALS_PER_RUN, GOALS_FROM_FINALS_PER_RUN, GOALS_RESERVE, INFO_UPCOMING, INFO_DETAIL_CALLS, INFO_PER_RUN, INFO_TTL_HOURS, VENUES_PER_RUN, VENUE_TTL_DAYS, REFEREES_PER_RUN, REFEREE_TTL_DAYS, PEOPLE_TTL_HOURS
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
const GOALS_COMP = int("GOALS_PER_COMP", 25), GOALS_RUN = int("GOALS_PER_RUN", 300), GOALS_FIN = int("GOALS_FROM_FINALS_PER_RUN", 60), GOALS_RESERVE = int("GOALS_RESERVE", 1000);
const INFO_UP = int("INFO_UPCOMING", 3), INFO_DETAIL = int("INFO_DETAIL_CALLS", 0), INFO_RUN = int("INFO_PER_RUN", 250), INFO_TTL_H = int("INFO_TTL_HOURS", 24);      // referee / venue / managers of the next fixtures
const VEN_RUN = int("VENUES_PER_RUN", 100), VEN_TTL_D = int("VENUE_TTL_DAYS", 30);   // venue names (the match feed only carries venue ids)
const REF_RUN = int("REFEREES_PER_RUN", 0), REF_TTL_D = int("REFEREE_TTL_DAYS", 7), PEOPLE_TTL_H = int("PEOPLE_TTL_HOURS", 24);
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
  return { ...lg, meta, teams, cur: new Map(), fixtures: new Map(), mstats: null, mstatsDirty: false, goals: null, goalsDirty: false, info: null, infoDirty: false };
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
  if (L.goalsDirty) { const keep = new Set([...L.cur.keys()]); await put(`goals/${L.code}`, { code: L.code, m: B.pruneGoals(L.goals, keep, Math.floor(Date.now() / 1000)), updated: now }); L.goalsDirty = false; }
  if (L.infoDirty) { const keep = new Set([...L.cur.keys(), ...L.fixtures.keys()]); await put(`info/${L.code}`, { code: L.code, m: Object.fromEntries(Object.entries(L.info).filter(([id]) => keep.has(+id))), updated: now }); L.infoDirty = false; }
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
  L.info ??= (await store.get(`info/${L.code}`))?.m ?? {};
  for (const e of evs) {
    const inf = B.infoOf(e);                                    // if the list rows already carry referee / venue / coaches, every match gets them for free
    if (inf && e.id != null) { L.info[e.id] = { ...(L.info[e.id] ?? {}), ...inf, at: Math.floor(Date.now() / 1000) }; L.infoDirty = true; }
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

/* ---------- scorers and assists (names) ---------- */
// One /events/{id}/commentary/ call per finished match that had a goal (0-0 needs none). Three feeds, all resumable:
//   1. users' "match details" requests also store the goals (no extra call)
//   2. goalsFromFinals: matches the live runner saw finish (live/finals), within one runner/sync cycle of full time
//   3. goalsFor: per competition, newest finished matches first, GOALS_PER_COMP per competition and GOALS_PER_RUN per run
// None of them spends the last GOALS_RESERVE calls of the day, so the core data sync and users' requests always keep working.
const roomForGoals = () => remaining === null || remaining > GOALS_RESERVE;
const goalEntry = (row, nowS) => ({ g: row.g, ok: row.complete === true ? 1 : 0, n: row.n, at: nowS });
async function goalsFor(L, cap) {
  L.goals ??= (await store.get(`goals/${L.code}`))?.m ?? {};
  const nowS = Math.floor(Date.now() / 1000), { fetch, zero } = B.goalsDue([...L.cur.values()], L.goals, nowS, cap);
  for (const id of zero) { L.goals[id] = { g: [], ok: 1, n: 0, at: nowS }; L.goalsDirty = true; }
  let n = 0;
  for (const id of fetch) {
    if (!roomForGoals()) break;
    const r = L.cur.get(id), d = await soft(`${L.code} goals ${id}`, () => api(`/events/${id}/commentary/`));
    if (!d) continue;
    L.goals[id] = goalEntry(B.goalsRow(d, r.hg, r.ag), nowS); L.goalsDirty = true; n++;
  }
  return n;
}
async function goalsFromFinals(cap) {
  const fin = Object.values((await store.get("live/finals"))?.m ?? {}).filter((f) => f && f.lg != null && f.hg != null && f.ag != null).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const docs = new Map(), nowS = Math.floor(Date.now() / 1000), dirty = new Set();
  let n = 0;
  for (const f of fin) {
    const code = B.codeOf(f.lg);
    if (!docs.has(code)) docs.set(code, (await store.get(`goals/${code}`)) ?? { code, m: {} });
    const doc = docs.get(code), t = f.ko ? Math.floor(Date.parse(f.ko) / 1000) : nowS;
    const { fetch, zero } = B.goalsDue([{ id: f.id, t: Number.isFinite(t) ? t : nowS, hg: f.hg, ag: f.ag }], doc.m, nowS, 1);
    if (zero.length) { doc.m[f.id] = { g: [], ok: 1, n: 0, at: nowS }; dirty.add(code); }
    if (!fetch.length || n >= cap || !roomForGoals()) continue;
    const d = await soft(`${code} goals ${f.id}`, () => api(`/events/${f.id}/commentary/`));
    if (!d) continue;
    doc.m[f.id] = goalEntry(B.goalsRow(d, f.hg, f.ag), nowS); dirty.add(code); n++;
  }
  for (const code of dirty) { const doc = docs.get(code); await put(`goals/${code}`, { ...doc, m: B.pruneGoals(doc.m, new Set(Object.keys(doc.m).map(Number)), nowS), updated: iso() }); }
  if (n) log(`goals from live finals: ${n} match(es)`);
  return n;
}

/* ---------- referee / venue / managers of the next fixtures, and lists per competition ---------- */
// /events/{id}/ is documented to carry coaches, referee and venue (field names are not spelled out: B.infoOf reads the plausible shapes; npm run probe prints the real one).
async function infoFor(L, cap, refIds) {
  L.info ??= (await store.get(`info/${L.code}`))?.m ?? {};
  const now = Math.floor(Date.now() / 1000), up = [...L.fixtures.values()].filter((f) => f.s === "notstarted").sort((a, b) => a.t - b.t).slice(0, INFO_UP);
  let n = 0;
  for (const f of up) {
    const old = L.info[f.id];
    if (INFO_DETAIL && n < cap && !(old?.dat && now - old.dat < INFO_TTL_H * 3600)) {      // off by default: the match list already carries the ids
      const d = await soft(`${L.code} info ${f.id}`, () => api(`/events/${f.id}/`));
      if (d) { L.info[f.id] = { ...(old ?? {}), ...(B.infoOf(d) ?? {}), at: now, dat: now }; L.infoDirty = true; n++; }
    }
    const rid = L.info[f.id]?.rf?.id; if (rid != null) refIds.add(rid);
  }
  return n;
}
async function peopleLists(L) {                                  // managers and referees active in the competition: 1 call each (200 per page)
  if (hoursSince(L.meta.peopleAt) < PEOPLE_TTL_H) return 0;
  let n = 0;
  for (const [kind, coll] of [["managers", "managers"], ["referees", "referees"]]) {
    const list = await soft(`${L.code} ${kind}`, async () => B.buildPeople({ results: await pages(`/${kind}/`, { league_id: L.id }, 2) }));
    if (list) { await put(`${coll}/${L.code}`, { code: L.code, list, updated: iso() }); n++; }
  }
  if (n) L.meta.peopleAt = iso();
  return n;
}
async function venuePacks(ids) {                                 // name, city and capacity of the venues seen in matches: 1 call per venue, refreshed every VENUE_TTL_DAYS
  let n = 0;
  for (const id of ids) {
    if (n >= VEN_RUN || !roomForGoals()) break;
    const old = await store.get(`venues/${id}`);
    if (old && hoursSince(old.updated) < VEN_TTL_D * 24) continue;
    const d = await soft(`venue ${id}`, () => api(`/venues/${id}/`));
    if (d) { await put(`venues/${id}`, { id, ...B.buildVenuePack(d, null), competitions: old?.competitions ?? [] }); n++; }
  }
  if (n) log(`venues: ${n} loaded`);
  return n;
}
async function refereePacks(ids) {                               // profile + per-match aggregates of referees assigned to upcoming matches
  let n = 0;
  for (const id of ids) {
    if (n >= REF_RUN) break;
    const old = await store.get(`officials/${id}`);
    if (old && hoursSince(old.updated) < REF_TTL_D * 24) continue;
    const d = await soft(`referee ${id}`, () => api(`/referees/${id}/`));
    if (d) { await put(`officials/${id}`, { id, ...B.buildRefereePack(d) }); n++; }
  }
  return n;
}
async function managerPack(id) { const [p, c] = [await api(`/managers/${id}/`), await soft(`manager ${id} career`, () => api(`/managers/${id}/career/`))]; return B.buildManagerPack(p, c); }
async function venuePack(id) { const [p, c] = [await api(`/venues/${id}/`), await soft(`venue ${id} competitions`, () => api(`/venues/${id}/competitions/`))]; return B.buildVenuePack(p, c); }

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
        await put(`squads/${t.id}`, { id: t.id, name: t.name, code, profile: B.flat(profile ?? {}), extra: B.teamExtras(profile), players: B.buildSquad(squad), updated: iso() });
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
        const [lineups, commentary, stats, detail] = [await soft(`lineups ${eid}`, () => api(`/events/${eid}/lineups/`)), await soft(`commentary ${eid}`, () => api(`/events/${eid}/commentary/`)), await soft(`stats ${eid}`, () => api(`/events/${eid}/stats/`)), await soft(`event ${eid}`, () => api(`/events/${eid}/`))];
        if (!lineups && !commentary && !stats) throw new ApiError("nothing available", 0);
        await put(`details/${eid}`, B.buildDetails({ id: eid, code: d.league, lineups, commentary, stats, detail }));
        const inf = detail ? B.infoOf(detail) : null, hg = B.num(detail?.home_score), ag = B.num(detail?.away_score), nowS = Math.floor(Date.now() / 1000);
        if (inf) { const doc = (await store.get(`info/${d.league}`)) ?? { code: d.league, m: {} }; doc.m[eid] = { ...(doc.m[eid] ?? {}), ...inf, at: nowS, dat: nowS }; await put(`info/${d.league}`, { ...doc, updated: iso() }); }
        if (commentary?.status === "finished" && hg !== null && ag !== null) { const doc = (await store.get(`goals/${d.league}`)) ?? { code: d.league, m: {} }; doc.m[eid] = goalEntry(B.goalsRow(commentary, hg, ag), nowS); await put(`goals/${d.league}`, { ...doc, updated: iso() }); }
        const row = stats ? B.statsRow(stats) : null;
        if (row) { const doc = (await store.get(`mstats/${d.league}`)) ?? { code: d.league, m: {} }; doc.m[eid] = row; await put(`mstats/${d.league}`, { ...doc, updated: iso() }); }
        log(`request: details for match ${eid}`);
      } else if (d.kind === "h2h" && Number.isFinite(+d.eid) && Number.isFinite(+d.h) && Number.isFinite(+d.a)) {
        const data = await api(`/events/${+d.eid}/h2h/`);
        const doc = B.buildH2H(data, +d.h, +d.a);
        await put(`h2h/${doc.ids[0]}_${doc.ids[1]}`, { ...doc, fetched: iso() });
        log(`request: head-to-head ${doc.ids.join(" v ")} (${doc.matches.length} meetings)`);
      } else if (d.kind === "manager" && Number.isFinite(+d.oid)) {
        await put(`coaches/${+d.oid}`, { id: +d.oid, ...(await managerPack(+d.oid)) });
        log(`request: manager ${d.oid}`);
      } else if (d.kind === "referee" && Number.isFinite(+d.oid)) {
        await put(`officials/${+d.oid}`, { id: +d.oid, ...B.buildRefereePack(await api(`/referees/${+d.oid}/`)) });
        log(`request: referee ${d.oid}`);
      } else if (d.kind === "venue" && Number.isFinite(+d.oid)) {
        await put(`venues/${+d.oid}`, { id: +d.oid, ...(await venuePack(+d.oid)) });
        log(`request: venue ${d.oid}`);
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
  await goalsFromFinals(GOALS_FIN);                         // scorers of matches the live runner saw finish (0 calls when there are none)
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
    let ms = 0, h2h = 0, goals = 0, info = 0;
    const refIds = new Set(), venIds = new Set();
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
        if (goals < GOALS_RUN) goals += await goalsFor(L, Math.min(GOALS_COMP, GOALS_RUN - goals));
        if (info < INFO_RUN) info += await infoFor(L, INFO_RUN - info, refIds);
        await soft(`${L.code} managers/referees`, () => peopleLists(L));
        for (const e of Object.values(L.info ?? {})) if (e?.vn?.id != null) venIds.add(e.vn.id);
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
    await refereePacks([...refIds]);
    await venuePacks([...venIds]);
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
