import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { dayKey, utcDaysFor } from "./board";
import { pickId } from "./daily";

// daily/<UTC day> documents are written by scripts/picks.mjs after each data sync. Cached for 5 minutes per day.
const TTL = 5 * 60e3, cache = new Map();
function loadDay(day) {
  const c = cache.get(day);
  if (c && Date.now() - c.at < TTL) return c.p;
  const p = getDoc(doc(db, "daily", day)).then((s) => (s.exists() ? s.data().list ?? [] : null));
  cache.set(day, { at: Date.now(), p }); p.catch(() => cache.delete(day));
  return p;
}
// Picks whose match is played on the local day `day` (a day key). missing = none of the three documents exists (picks not built for those dates).
export function useDaily(day) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let on = true;
    setSt({ loading: true });
    Promise.all(utcDaysFor(day).map(loadDay)).then((docs) => on && setSt({ rows: docs.flatMap((l) => l ?? []).filter((x) => dayKey(x.t) === day), missing: docs.every((l) => l === null), loading: false }), (e) => on && setSt({ err: e.message, loading: false }));
    return () => { on = false; };
  }, [day]);
  return st;
}

// Ids of the user's saved picks (to show which daily picks are already confirmed).
export async function savedPickIds(uid) {
  return new Set((await getDocs(collection(db, "users", uid, "picks"))).docs.map((x) => x.id));
}

// Confirm = save the model pick to My Picks (same shape as a pick saved from the analysis page, without odds). The id is fixed per match and market,
// and picks can only be created, never updated (firestore.rules), so a second confirm is refused instead of duplicating.
export async function confirmPick(uid, x) {
  await setDoc(doc(db, "users", uid, "picks", pickId(x)), { v: 3, matchId: x.id, kickoff: x.t, league: x.c, homeId: x.h, awayId: x.a, home: x.hn, away: x.an, market: x.m, selection: x.s, prob: x.p, odds: null, stake: null, myProb: null, mktProb: null, createdAt: serverTimestamp() });
}
