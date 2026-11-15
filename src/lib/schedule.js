import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { utcDaysFor } from "./board";

// schedule/<UTC day> documents are written by scripts/schedule.mjs after each data sync. Cached for 5 minutes per day.
const TTL = 5 * 60e3, cache = new Map();
function loadDay(day) {
  const c = cache.get(day);
  if (c && Date.now() - c.at < TTL) return c.p;
  const p = getDoc(doc(db, "schedule", day)).then((s) => (s.exists() ? s.data().list ?? [] : null));
  cache.set(day, { at: Date.now(), p }); p.catch(() => cache.delete(day));
  return p;
}
// Rows around a local day key. missing = none of the three documents exists (schedule not built for those dates).
export function useSchedule(day) {
  const [st, setSt] = useState({ loading: true }), [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), TTL); return () => clearInterval(i); }, []);
  useEffect(() => {
    let on = true;
    setSt((x) => ({ ...x, loading: true }));
    Promise.all(utcDaysFor(day).map(loadDay)).then((docs) => on && setSt({ rows: docs.flatMap((l) => l ?? []), missing: docs.every((l) => l === null), loading: false }), (e) => on && setSt({ err: e.message, loading: false }));
    return () => { on = false; };
  }, [day, tick]);
  return st;
}
