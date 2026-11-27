// Small motion helpers shared by the components. Nothing here touches Firebase or the network.
import { useEffect, useRef, useState } from "react";

export const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// True for `ms` after `value` changes. Never on the first render, so a row that has just loaded does not flash.
// ok(prev, next) decides whether a change counts. n counts the changes: put it in a `key` so an animation restarts when the value changes again inside the window.
export function useChange(value, { ms = 1600, ok = () => true } = {}) {
  const prev = useRef(value), timer = useRef(0), [st, setSt] = useState({ n: 0, on: false });
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    const was = prev.current; prev.current = value;
    if (!ok(was, value)) return;
    setSt((s) => ({ n: s.n + 1, on: true }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt((s) => ({ ...s, on: false })), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return st;
}
// a goal: both numbers are real numbers and they differ (a score that appears for the first time, null -> 0, is not a goal)
export const isGoal = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a !== b;

// false on the first render, true one frame after it is painted: lets a CSS transition start from its "empty" state on mount.
export function useEntered() {
  const [on, setOn] = useState(reducedMotion);
  useEffect(() => {
    if (on) return undefined;
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setOn(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [on]);
  return on;
}

// A number that counts up to `target` on mount and between values afterwards. Not a number (null, NaN) or reduced motion: shown as is.
export function useCountUp(target, { ms = 700 } = {}) {
  const [v, setV] = useState(() => (reducedMotion() || !Number.isFinite(target) ? target : 0));
  const cur = useRef(v);
  useEffect(() => {
    if (reducedMotion() || !Number.isFinite(target)) { cur.current = target; setV(target); return undefined; }
    const from = Number.isFinite(cur.current) ? cur.current : 0, t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), val = k >= 1 ? target : from + (target - from) * (1 - Math.pow(1 - k, 3));
      cur.current = val; setV(val);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// CSS custom property for staggered entrances: style={stagger(i)} with .rise (delay = --i x 40 ms, capped at max steps)
export const stagger = (i, max = 10) => ({ "--i": Math.min(Math.max(0, i), max) });
