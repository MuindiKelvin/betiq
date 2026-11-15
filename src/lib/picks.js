import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";
import { loadResults } from "./data";
import { settle } from "./util";

// All of a user's saved picks, newest first, with finished matches settled (won / profit / score) from the synced results.
export async function loadPicks(uid) {
  const s = await getDocs(query(collection(db, "users", uid, "picks"), orderBy("createdAt", "desc")));
  const raw = s.docs.map((x) => ({ id: x.id, ...x.data() }));
  const codes = [...new Set(raw.filter((p) => p.v === 3 && p.matchId).map((p) => p.league))];
  const data = Object.fromEntries(await Promise.all(codes.map(async (c) => [c, await loadResults(c).catch(() => null)])));
  const out = raw.map((p) => {
    p.t = p.kickoff ?? p.createdAt?.seconds ?? Math.floor(Date.now() / 1000);
    const r = p.v === 3 && p.matchId ? data[p.league]?.results.find((x) => x.id === p.matchId) : null;
    if (r) { p.score = `${r.hg}–${r.ag}`; Object.assign(p, settle(p, r.hg, r.ag)); }
    return p;
  });
  return out.sort((x, y) => y.t - x.t);
}
