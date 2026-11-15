// BetIQ live runner: BSD /events/live/ -> Firestore document live/main, which every browser listens to.
//   npm run live:local            runs until stopped (your PC or a small server)
//   LIVE_RUN_MINUTES=19 npm run live   time-boxed (GitHub Actions)
// The token stays here, never in the browser. What it does each tick:
//   1. GET /coverage/ (no token): is anything live or about to kick off? If not, no quota is spent.
//   2. GET /events/live/: score, minute, extra time, shoot-out. Matches that disappear from it are looked up with GET /events/{id}/
//      so their real status (finished, still in play, ...) is stored instead of being guessed.
//   2b. Sweep (every ~2 min): matches in the stored schedule (schedule/<day>) that kicked off 110 min to 12 h ago and were never reported finished (feed gap, runner was off)
//      are looked up with GET /events/{id}/. Finished ones go to live/finals, postponed/cancelled ones to the change list. Capped by SWEEP_MAX_PER_DAY.
//   2c. Every match the API reports finished (with a score it sent) is also kept for 4 days in live/finals so results (and My Picks) do not wait for the next data sync.
//   3. GET /fixtures/changes/ every few minutes: kick-off moves and postponements/cancellations.
// Env: BSD_API_KEY (required); FIREBASE_SERVICE_ACCOUNT or serviceAccountKey.json. Optional: LIVE_POLL_SECONDS (30, min 10), LIVE_RUN_MINUTES (0 = no limit),
//      LIVE_RESERVE (1000: stop when this many calls are left today, so the data sync and users' requests keep working), LIVE_LEAD_MINUTES (10),
//      CHANGES_EVERY_MINUTES (5), LIVE_FOREVER=1 (never exit: after the daily quota is used up, sleep until 00:00 UTC and carry on; used by `npm start`),
//      LIVE_SWEEP=0 (turn off the sweep below), SWEEP_PER_TICK (10), SWEEP_MAX_PER_DAY (400),
//      CHANGES_EVERY_MINUTES (5), LIVE_EXIT_IDLE=1 (exit as soon as nothing is live or due: for scheduled CI runs), LIVE_REVISIT_MINUTES (how long until the next run starts; the app
//      then treats an idle heartbeat that old as still valid), DRY_RUN=1 (writes ./.sync-out/live/main.json instead of Firestore), BSD_BASE
import fs from "node:fs";
import path from "node:path";
import * as B from "./lib/bsd.mjs";
import * as L from "./lib/live.mjs";

const env = process.env, int = (k, d) => (Number.isFinite(+env[k]) && env[k] !== undefined && env[k] !== "" ? +env[k] : d);
const KEY = env.BSD_API_KEY, BASE = (env.BSD_BASE || "https://sports.bzzoiro.com/api/v2").replace(/\/$/, ""), DRY = env.DRY_RUN === "1";
const POLL_S = Math.max(DRY ? 1 : 10, int("LIVE_POLL_SECONDS", 30)), RUN_MIN = int("LIVE_RUN_MINUTES", 0), RESERVE = int("LIVE_RESERVE", 1000);
const LEAD_MS = int("LIVE_LEAD_MINUTES", 10) * 60e3, CH_MS = int("CHANGES_EVERY_MINUTES", 5) * 60e3, DETAIL_PER_TICK = int("LIVE_DETAIL_PER_TICK", 20);
const FOREVER = env.LIVE_FOREVER === "1", SWEEP_ON = env.LIVE_SWEEP !== "0", SWEEP_N = int("SWEEP_PER_TICK", 10), SWEEP_DAY_MAX = int("SWEEP_MAX_PER_DAY", 400), SWEEP_EVERY_MS = DRY ? 1000 : 120e3;
const EXIT_IDLE = env.LIVE_EXIT_IDLE === "1", REVISIT_S = int("LIVE_REVISIT_MINUTES", 0) * 60;
const HEARTBEAT_LIVE_MS = 60e3, HEARTBEAT_IDLE_MS = 300e3, IDLE_SLEEP_MS = DRY ? 1000 : 60e3;
if (!KEY) { console.error("BSD_API_KEY is missing. Put it in .env (local) or a GitHub secret. Register free at https://sports.bzzoiro.com/register/"); process.exit(1); }

/* ---------- storage ---------- */
let store;
if (DRY) {
  const file = (p) => path.join(".sync-out", p + ".json");
  store = { get: async (p) => { try { return JSON.parse(fs.readFileSync(file(p), "utf8")); } catch { return null; } }, set: async (p, d) => { fs.mkdirSync(path.dirname(file(p)), { recursive: true }); fs.writeFileSync(file(p), JSON.stringify(d)); } };
} else {
  const admin = (await import("firebase-admin")).default;
  const sa = env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : JSON.parse(fs.readFileSync("serviceAccountKey.json", "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();
  store = { get: async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; }, set: (p, d) => db.doc(p).set(d) };
}

/* ---------- API client ---------- */
class Stop extends Error { constructor(msg, halt) { super(msg); this.halt = halt; } }
let used = 0, remaining = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function get(urlOrPath, params = {}, { auth = true, tries = 3 } = {}) {
  if (auth && remaining !== null && remaining <= RESERVE) throw new Stop(`only ${remaining} calls left today (reserve ${RESERVE}); live updates paused until 00:00 UTC`, "quota");
  const url = new URL(urlOrPath.startsWith("http") ? urlOrPath : BASE + urlOrPath);
  if (url.origin !== new URL(BASE).origin) throw new Error("refusing to follow a link to another host: " + url.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  if (auth) used++;
  let r;
  try { r = await fetch(url, { headers: { ...(auth ? { Authorization: `Token ${KEY}` } : {}), Accept: "application/json" } }); }
  catch (e) { if (tries > 1) { await sleep(1500); return get(urlOrPath, params, { auth, tries: tries - 1 }); } throw new Error(`${url.pathname}: network error ${e.message}`); }
  const rl = r.headers.get("ratelimit"), m = rl && /;\s*r=(\d+)/.exec(rl);   // RateLimit: "football";r=7213;t=52800
  if (m) remaining = +m[1];
  if (r.status === 401 && auth) throw new Stop("HTTP 401: BSD_API_KEY is missing or invalid", "auth");
  if (r.status === 429) {
    const body = await r.json().catch(() => ({}));
    if (body.code === "taster_exhausted") throw new Stop("daily quota exhausted (resets 00:00 UTC)", "quota");
    if (tries > 1) { await sleep(Math.max(1, +r.headers.get("retry-after") || 1) * 1000); return get(urlOrPath, params, { auth, tries: tries - 1 }); }
    throw new Error(`${url.pathname}: rate limited (429) repeatedly`);
  }
  if (r.status >= 500 && tries > 1) { await sleep(2000); return get(urlOrPath, params, { auth, tries: tries - 1 }); }
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(`${url.pathname} -> HTTP ${r.status}${b.detail ? ": " + String(b.detail).slice(0, 160) : ""}`); }
  return r.json();
}
// /events/live/ without parameters (unknown ones are rejected with 400); if the answer is paginated, follow the API's own `next` links
async function liveList() {
  let d = await get("/events/live/"), list = B.firstArray(d, ["results"]);
  const all = [...list], count = d && !Array.isArray(d) ? B.num(d.count) : null;
  for (let i = 0; i < 10 && d && !Array.isArray(d) && d.next; i++) { d = await get(d.next); all.push(...B.firstArray(d, ["results"])); }
  return { all, partial: count !== null && count !== all.length };
}

/* ---------- state ---------- */
const fresh = () => ({ v: 1, events: {}, left: {}, changes: {}, changesUntil: null });
let doc = { ...fresh(), ...((await store.get("live/main")) ?? {}) };
doc.events ??= {}; doc.left ??= {}; doc.changes ??= {};
let finals = pruneF((await store.get("live/finals"))?.m ?? {}), finalsSig = JSON.stringify(finals), lastSweep = 0, sweepTried = {}, sweepDay = { day: "", n: 0 };
let lastWrite = 0, lastChanges = 0, lastSig = "", tryAt = {};
function pruneF(m) { return L.pruneFinals(m, Date.now()); }
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const put = (d, p = "live/main") => store.set(p, JSON.parse(JSON.stringify(d)));
const sig = (d) => JSON.stringify([d.mode, d.events, d.left, d.changes, d.bad, d.partial]);

// Look up matches that should be over but were never reported finished. Returns a short note for the log.
async function sweep(nowMs, nowIso) {
  const today = utcDay(nowMs); if (sweepDay.day !== today) sweepDay = { day: today, n: 0 };
  if (sweepDay.n >= SWEEP_DAY_MAX) return "";
  const entries = [];
  for (const day of [utcDay(nowMs - 864e5), today]) entries.push(...((await store.get(`schedule/${day}`))?.list ?? []));
  const byId = new Map(entries.map((e) => [+e.id, e]));
  const ids = L.sweepCandidates({ entries, doc, finals, nowMs, tried: sweepTried, max: Math.min(SWEEP_N, SWEEP_DAY_MAX - sweepDay.n) });
  let fin = 0, moved = 0;
  for (const id of ids) {
    sweepTried[id] = nowMs; sweepDay.n++;
    let detail; try { detail = await get(`/events/${id}/`); } catch (e) { if (e instanceof Stop) throw e; log(`  ! sweep ${id}: ${e.message}`); continue; }
    const e = byId.get(id), prev = { h: e.h, a: e.a, lg: /^L(\d+)$/.test(e.c ?? "") ? +e.c.slice(1) : null, ko: e.t }, l = L.leftEntry(detail, prev, nowIso, 1);
    const fe = L.finalEntry(id, l, nowIso);
    if (fe) { finals[id] = fe; fin++; }
    else if (l.s === "postponed" || l.s === "cancelled") { doc.changes[id] = { ...(doc.changes[id] ?? {}), status: { s: l.s, raw: l.raw, at: nowIso } }; moved++; }
  }
  for (const id of Object.keys(sweepTried)) if (nowMs - sweepTried[id] > 864e5) delete sweepTried[id];
  return ids.length ? `, sweep ${ids.length} looked up (${fin} finished, ${moved} postponed/cancelled)` : "";
}

async function tick() {
  const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString();
  const cov = await get("/coverage/", {}, { auth: false, tries: 2 }).catch((e) => { log("  ! coverage:", e.message); return null; });
  const pendingLeft = Object.values(doc.left).some((l) => L.needsRecheck(l, nowMs));
  const g = L.gate({ cov, nowMs, leadMs: LEAD_MS, hadLive: Object.keys(doc.events).length > 0 || pendingLeft });
  let mode = g.poll ? "live" : "idle", note = g.why;
  if (g.poll) {
    const { all, partial } = await liveList();
    const rows = all.map(L.liveRow).filter(Boolean), bad = all.length - rows.length;
    if (bad) log(`  ! ${bad} live record(s) had no readable id. First one's keys: ${Object.keys(all.find((e) => L.liveRow(e) === null) ?? {}).join(", ")}`);
    const { events, dropped } = L.reconcile(doc.events, rows);
    const prevEvents = doc.events;
    for (const id of Object.keys(events)) delete doc.left[id];             // back in the feed
    const look = [...dropped.filter((id) => !(id in doc.left)), ...Object.keys(doc.left).map(Number).filter((id) => L.needsRecheck(doc.left[id], nowMs))].slice(0, DETAIL_PER_TICK);
    for (const id of look) {
      const prev = prevEvents[id] ?? doc.left[id], tries = (doc.left[id]?.tries ?? 0) + 1;
      let detail = null;
      try { detail = await get(`/events/${id}/`); } catch (e) { if (e instanceof Stop) throw e; log(`  ! detail ${id}: ${e.message}`); }
      doc.left[id] = L.leftEntry(detail, prev, nowIso, tries);
      const fe = L.finalEntry(id, doc.left[id], nowIso); if (fe) finals[id] = fe;
    }
    doc.events = events; doc.bad = bad; doc.partial = partial;
    note = `${rows.length} live, ${dropped.length} left${partial ? ", PARTIAL list" : ""}`;
  }
  if (SWEEP_ON && nowMs - lastSweep >= SWEEP_EVERY_MS) {
    lastSweep = nowMs;
    try { note += await sweep(nowMs, nowIso); } catch (e) { if (e instanceof Stop) throw e; log("  ! sweep:", e.message); }
  }
  if (nowMs - lastChanges >= (g.poll ? CH_MS : CH_MS * 6)) {
    try {
      const resp = await get("/fixtures/changes/", { since: doc.changesUntil ?? undefined, change: "kickoff,status", limit: 500 }), p = L.parseChanges(resp);
      doc.changes = L.applyChanges(doc.changes, p.items); doc.changesUntil = L.nextCursor(p, doc.changesUntil); lastChanges = nowMs;
      if (p.items.length) note += `, ${p.items.length} fixture change(s)`;
    } catch (e) { if (e instanceof Stop) throw e; log("  ! changes:", e.message); }
  }
  doc.changes = L.pruneChanges(doc.changes, nowMs); doc.left = L.pruneLeft(doc.left, nowMs); finals = L.pruneFinals(finals, nowMs);
  const fs_ = JSON.stringify(finals); if (fs_ !== finalsSig) { await put({ m: finals, updated: nowIso }, "live/finals"); finalsSig = fs_; }
  doc.mode = mode; doc.pollS = POLL_S; doc.revisitS = REVISIT_S; doc.halt = null;
  const s = sig(doc), due = nowMs - lastWrite >= (mode === "live" ? HEARTBEAT_LIVE_MS : HEARTBEAT_IDLE_MS);
  if (s !== lastSig || due) { doc.updated = nowIso; await put(doc); lastSig = s; lastWrite = nowMs; }
  log(`${mode}: ${note} | calls ${used}${remaining !== null ? `, ${remaining} left today` : ""}`);
  return { polling: g.poll, nextAt: g.nextAt ?? null };
}

/* ---------- loop ---------- */
const t0 = Date.now(); let polling = true;
const flush = async () => { doc.updated = new Date().toISOString(); await put(doc); };
log(`live runner started: poll ${POLL_S}s, ${RUN_MIN ? RUN_MIN + " min limit" : "no time limit"}, quota reserve ${RESERVE}${DRY ? ", DRY RUN" : ""}`);
for (;;) {
  if (RUN_MIN && Date.now() - t0 >= RUN_MIN * 60e3) { log("time limit reached"); break; }
  try {
    const r = await tick(); polling = r.polling;
    if (EXIT_IDLE && !r.polling && (r.nextAt === null || r.nextAt - Date.now() > REVISIT_S * 1000 + LEAD_MS)) { await flush(); log("idle: nothing live or due before the next scheduled run, exiting"); break; }
  }
  catch (e) {
    if (e instanceof Stop) {
      log("stopping:", e.message); doc.halt = e.halt; doc.updated = new Date().toISOString(); await put(doc).catch(() => {});
      if (FOREVER && e.halt === "quota") {                       // wait for the daily reset instead of exiting; the app shows "paused" meanwhile
        const wait = Date.parse(utcDay(Date.now() + 864e5)) + 60e3 - Date.now(); log(`quota used up: sleeping ${Math.round(wait / 60e3)} min until 00:00 UTC`);
        await sleep(Math.max(60e3, wait)); remaining = null; used = 0; doc.halt = null; lastSig = ""; continue;
      }
      break;
    }
    log("  ! tick failed (nothing written):", e.message); polling = true;
  }
  await sleep(polling ? POLL_S * 1000 : IDLE_SLEEP_MS);
}
process.exit(0);
