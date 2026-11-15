// BetIQ schedule builder: stored fixtures + results of every synced competition -> schedule/<YYYY-MM-DD> (one document per UTC day) for the Live page.
// Makes NO API calls: it only reads what the data sync already wrote (catalog, meta, fixtures, seasons) and writes ~22 small documents.
//   npm run schedule:local     (reads .env)       npm run schedule   (CI: FIREBASE_SERVICE_ACCOUNT)
// Env: SCHEDULE_BACK_DAYS (7), SCHEDULE_AHEAD_DAYS (14), DRY_RUN=1 (reads/writes ./.sync-out)
import fs from "node:fs";
import path from "node:path";
import { byDay, rowsOf, utcDay } from "./lib/schedule.mjs";

const env = process.env, int = (k, d) => (Number.isFinite(+env[k]) && env[k] !== undefined && env[k] !== "" ? +env[k] : d);
const BACK = int("SCHEDULE_BACK_DAYS", 7), AHEAD = int("SCHEDULE_AHEAD_DAYS", 14), DRY = env.DRY_RUN === "1";

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

const nowMs = Date.now(), cat = await store.get("catalog/main");
if (!cat?.leagues?.length) { console.error("No catalog yet: run the data sync first (npm run sync:local)."); process.exit(1); }
const lo = (nowMs - (BACK + 1) * 864e5) / 1000, hi = (nowMs + (AHEAD + 1) * 864e5) / 1000, rows = [];
let comps = 0;
for (const l of cat.leagues) {
  if (!l.s?.at) continue;                                        // never synced
  const meta = await store.get(`meta/${l.code}`);
  if (!meta) continue;
  const [fx, cur] = await Promise.all([store.get(`fixtures/${l.code}`), meta.current != null ? store.get(`seasons/${l.code}_${meta.current}`) : null]);
  const r = rowsOf(l.code, fx?.list, cur?.results).filter((x) => x.t >= lo && x.t <= hi);
  rows.push(...r); comps++;
}
const days = byDay(rows, nowMs, BACK, AHEAD), updated = new Date().toISOString();
for (const [day, list] of days) await store.set(`schedule/${day}`, JSON.parse(JSON.stringify({ day, n: list.length, list, updated })));
for (const id of await store.ids("schedule")) if (!days.has(id)) await store.del(`schedule/${id}`);       // days outside the window
console.log(`schedule: ${rows.length} matches from ${comps} competitions in ${days.size} days (${utcDay(nowMs - BACK * 864e5)} .. ${utcDay(nowMs + AHEAD * 864e5)})${DRY ? " | DRY RUN" : ""}`);
process.exit(0);
