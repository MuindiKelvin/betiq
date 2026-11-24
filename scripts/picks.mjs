// BetIQ daily picks: stored fixtures + results of every synced competition -> daily/<YYYY-MM-DD> (one document per UTC day) for the Daily Picks page.
// Makes NO API calls: it only reads what the data sync already wrote (catalog, meta, teams, fixtures, seasons) and runs the app's own model (src/lib).
//   npm run picks:local     (reads .env)       npm run picks   (CI: FIREBASE_SERVICE_ACCOUNT)
//   npm run picks:why -- "Champions"   explains why each fixture of that competition got or missed a pick (writes nothing)
// Env: DAILY_AHEAD_DAYS (3: today + 3 more UTC days), DAILY_PER_COMP (5 per league), DAILY_PER_CUP (10 per cup / continental competition), DRY_RUN=1 (reads/writes ./.sync-out)
// Picks of matches that already started are kept exactly as stored (frozen); the rest are recomputed on every run (see mergeDay in src/lib/daily.js).
import fs from "node:fs";
import path from "node:path";
import { DAILY, dayPicks, mergeDay, utcDay } from "../src/lib/daily.js";
import { MARKETS } from "../src/lib/util.js";

const env = process.env, int = (k, d) => (Number.isFinite(+env[k]) && env[k] !== undefined && env[k] !== "" ? +env[k] : d);
const AHEAD = int("DAILY_AHEAD_DAYS", DAILY.ahead), CAP = int("DAILY_PER_COMP", DAILY.cap), CAP_CUP = int("DAILY_PER_CUP", DAILY.capCup), DRY = env.DRY_RUN === "1", WHY_AT = process.argv.indexOf("--why"), WHY = WHY_AT < 0 ? "" : (process.argv[WHY_AT + 1] ?? "").trim().toLowerCase();   // npm run picks:why -- "Champions": explain why fixtures of that competition got no pick (reads, never writes)

let store;
if (DRY) {
  const file = (p) => path.join(".sync-out", p + ".json");
  store = {
    get: async (p) => { try { return JSON.parse(fs.readFileSync(file(p), "utf8")); } catch { return null; } },
    set: async (p, d) => { fs.mkdirSync(path.dirname(file(p)), { recursive: true }); fs.writeFileSync(file(p), JSON.stringify(d)); },
    ids: async (c) => { try { return fs.readdirSync(path.join(".sync-out", c)).map((f) => f.replace(/\.json$/, "")); } catch { return []; } },
    del: async (p) => { try { fs.unlinkSync(file(p)); } catch { /* gone */ } },
  };
} else {
  const admin = (await import("firebase-admin")).default;
  const sa = env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : JSON.parse(fs.readFileSync("serviceAccountKey.json", "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();
  store = { get: async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; }, set: (p, d) => db.doc(p).set(d), ids: async (c) => (await db.collection(c).listDocuments()).map((x) => x.id), del: (p) => db.doc(p).delete() };
}

if (WHY_AT >= 0 && !WHY) { console.error('Usage: npm run picks:why -- "Champions"   (a competition name or code)'); process.exit(1); }
const MARKETS_LABEL = (r) => `${MARKETS[r.m].sel[r.s]} ${Math.round(r.p * 100)}% (${MARKETS[r.m].label})`;
const nowMs = Date.now(), nowSec = Math.floor(nowMs / 1000), cat = await store.get("catalog/main");
if (!cat?.leagues?.length) { console.error("No catalog yet: run the data sync first (npm run sync:local)."); process.exit(1); }
const untilSec = Date.parse(utcDay(nowMs + AHEAD * 864e5) + "T00:00:00Z") / 1000 + 86400;      // end of the last UTC day
const fresh = [], noPick = []; let comps = 0, skipped = 0;
for (const l of cat.leagues) {
  if (!l.s?.at) continue;                                                                       // never synced
  if (WHY && !`${l.code} ${l.name}`.toLowerCase().includes(WHY)) continue;
  const [meta, fx] = await Promise.all([store.get(`meta/${l.code}`), store.get(`fixtures/${l.code}`)]);
  if (!meta || !(fx?.list ?? []).some((f) => f.t > nowSec && f.t <= untilSec)) continue;       // nothing to pick: skip the other reads
  try {
    const [teams, ...seasons] = await Promise.all([store.get(`teams/${l.code}`), ...(meta.seasons ?? []).map((s, i) => store.get(`seasons/${l.code}_${s.id}`).then((d) => (d?.results ?? []).map((r) => ({ ...r, s: i }))))]);
    const results = seasons.flat().sort((a, b) => b.t - a.t);                                   // same list the app builds (loadResults)
    const why = [], rows = dayPicks({ code: l.code, comp: l, fixtures: fx.list, teams: teams?.list, results, nowSec, untilSec, why });
    fresh.push(...rows); noPick.push(...why.map((x) => ({ c: l.code, id: x.id, h: x.h, a: x.a, hn: x.hn, an: x.an, t: x.t, w: x.code })));
    if (WHY) {
      console.log(`\n${l.name} (${l.code}${l.kind === "comp" ? ", cup/continental: raised minimums" : ""}): ${rows.length} fixtures qualify, ${why.length} do not`);
      for (const x of [...rows.map((r) => ({ ...r, reason: `PICK ${MARKETS_LABEL(r)}` })), ...why].sort((a, b) => a.t - b.t)) console.log(`  ${new Date((x.t) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC  ${(x.hn + " vs " + x.an).padEnd(44)} ${x.reason}`);
    }
    comps++;
  } catch (e) { skipped++; console.error(`picks: ${l.code} skipped: ${e.message}`); }
}
if (WHY) process.exit(0);                                                                       // explain-only run: nothing is written
const kinds = Object.fromEntries(cat.leagues.map((l) => [l.code, l.kind])), byDay = new Map();
for (let i = 0; i <= AHEAD; i++) byDay.set(utcDay(nowMs + i * 864e5), []);
for (const x of fresh) byDay.get(utcDay(x.t * 1000))?.push(x);
const noByDay = new Map([...byDay.keys()].map((d) => [d, []]));
for (const x of noPick) noByDay.get(utcDay(x.t * 1000))?.push(x);
const updated = new Date().toISOString(); let n = 0;
for (const [day, list] of byDay) {
  const rows = mergeDay({ prev: (await store.get(`daily/${day}`))?.list, fresh: list, nowSec, cap: (c) => (kinds[c] === "comp" ? CAP_CUP : CAP) });
  // fixtures without a pick are stored too (with the reason), so the page can show a complete list; "cap" = qualified but cut by the per-competition limit
  const kept = new Set(rows.map((x) => `${x.c}:${x.id}`)), cut = list.filter((x) => !kept.has(`${x.c}:${x.id}`)).map((x) => ({ c: x.c, id: x.id, h: x.h, a: x.a, hn: x.hn, an: x.an, t: x.t, w: "cap" }));
  const none = [...noByDay.get(day), ...cut].sort((a, b) => a.t - b.t || a.id - b.id);
  await store.set(`daily/${day}`, JSON.parse(JSON.stringify({ day, n: rows.length, list: rows, skipped: none, updated }))); n += rows.length;
}
const keep = utcDay(nowMs - 864e5);                                                             // yesterday stays (a local day can span two UTC days); older days go
for (const id of await store.ids("daily")) if (id < keep) await store.del(`daily/${id}`);
console.log(`picks: ${n} picks from ${comps} competitions in ${byDay.size} days${skipped ? `, ${skipped} skipped` : ""}${DRY ? " | DRY RUN" : ""}`);
process.exit(0);
