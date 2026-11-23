import { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { fresh } from "./data";
import { first } from "./util";

// Manager, referee and venue profiles are stored by the data sync; like players, they are queued from the app when missing.
const RID = { manager: "m", referee: "r", venue: "v" }, COLL = { manager: "coaches", referee: "officials", venue: "venues" };
export function useEntity(kind, id, league) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let on = true;
    setSt({ loading: true });
    (async () => {
      try { const pack = await fresh(COLL[kind], id); on && setSt(pack ? { pack } : { queued: !!(await fresh("requests", `${RID[kind]}_${id}`).catch(() => null)) }); }
      catch (e) { on && setSt({ err: e.message }); }
    })();
    return () => { on = false; };
  }, [kind, id]);
  async function request() {
    setSt((s) => ({ ...s, busy: true }));
    try { await setDoc(doc(db, "requests", `${RID[kind]}_${id}`), { kind, league: league ?? "", oid: id, at: serverTimestamp(), uid: auth.currentUser?.uid }); setSt({ queued: true }); }
    catch (e) { setSt({ err: "Could not queue the request: " + e.message }); }
  }
  return { st, request };
}

// Referee card averages: the API documents "per-match aggregates (cards, fouls, penalties)" without naming the fields, so look for them by name.
export function cardsOf(p) {
  const find = (re) => Object.keys(p ?? {}).find((k) => re.test(k) && typeof p[k] === "number");
  const y = find(/yellow.*(per|avg|average)|(per|avg|average).*yellow/i), r = find(/red.*(per|avg|average)|(per|avg|average).*red/i), n = find(/^(matches|matches_officiated|total_matches|games)$/i);
  return { y: y ? p[y] : null, r: r ? p[r] : null, n: n ? p[n] : null };
}
// current manager of a team from a competition's managers list (documented filter: team_id = current club)
export const managerOfTeam = (list, id, name) => (list ?? []).find((r) => Number(first(r, "team_id", "current_team_id", "club_id")) === id) ?? (list ?? []).find((r) => name && first(r, "team", "team_name", "club") === name);
// record from a manager list row / profile (matches_total, wins, draws, losses); points per match is arithmetic on those
const n = (v) => (v == null || v === "" ? NaN : Number(v));
export function profileRec(p) {
  const m = n(p?.matches ?? p?.matches_total), w = n(p?.wins), d = n(p?.draws), l = n(p?.losses);
  return [m, w, d, l].every(Number.isFinite) && m > 0 ? { matches: m, wins: w, draws: d, losses: l, ppm: Math.round(((3 * w + d) / m) * 100) / 100 } : null;
}
// { id: row } from a managers / referees list document
export const byIdMap = (doc) => Object.fromEntries((doc?.list ?? []).map((r) => [r.id, r]));
