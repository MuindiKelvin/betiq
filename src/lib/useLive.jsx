import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { feedState, phaseOf } from "./phase";

// One listener on live/main (written by scripts/live.mjs). Without it, or without permission, the app keeps working and
// every match falls back to schedule-only wording ("Kick-off passed"), never to a guessed score.
export const LiveContext = createContext({ doc: null, finals: null, err: null, nowMs: Date.now(), clockOff: false, feed: { state: "none", ageS: null } });

export function LiveProvider({ children }) {
  const [data, setData] = useState(null), [finals, setFinals] = useState(null), [err, setErr] = useState(null), [nowMs, setNow] = useState(Date.now()), [lag, setLag] = useState(null), later = useRef(false);
  useEffect(() => onSnapshot(doc(db, "live", "main"), (s) => {
    const v = s.exists() ? s.data() : null;
    setData(v); setErr(null); setNow(Date.now());
    // Delay between the runner writing and this device receiving it. The first snapshot is skipped (it may be an old document); the smallest later delay
    // is the real network latency plus any error in this device's clock.
    if (later.current && v?.updated && !s.metadata.fromCache) { const l = Date.now() - Date.parse(v.updated); setLag((x) => (x === null ? l : Math.min(x, l))); }
    later.current = true;
  }, (e) => setErr(e.message)), []);
  // live/finals: finished matches kept for a few days by the runner, so results do not vanish from the app before the next data sync
  useEffect(() => onSnapshot(doc(db, "live", "finals"), (s) => setFinals(s.exists() ? s.data()?.m ?? null : null), () => setFinals(null)), []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(i); }, []);
  const value = useMemo(() => ({ doc: data, finals, err, nowMs, clockOff: lag !== null && Math.abs(lag) > 90000, lagMs: lag, feed: feedState(data, nowMs) }), [data, finals, err, nowMs, lag]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
export const useLive = () => useContext(LiveContext);
export function usePhase(fx) { const { doc: d, finals, nowMs } = useLive(); return fx && fx.id != null ? phaseOf(fx, d, nowMs, finals) : null; }
export function useLiveCount() { const { doc: d, feed } = useLive(); return feed.state === "live" ? Object.keys(d?.events ?? {}).length : 0; }
