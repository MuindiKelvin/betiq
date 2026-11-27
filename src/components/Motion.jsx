import { isGoal, useChange, useCountUp } from "../lib/motion";

// A number that counts up to `value` (and between values). format(v) turns the running number into text; not a number: `fallback`.
export function Count({ value, decimals = 0, prefix = "", suffix = "", format, fallback = "n/a", ms = 700 }) {
  const v = useCountUp(value, { ms });
  if (!Number.isFinite(v)) return <>{fallback}</>;
  return <>{format ? format(v) : prefix + v.toFixed(decimals) + suffix}</>;
}

// One number of a live score. When it changes to another number (a goal) the new value highlights and bumps; the first time it is drawn nothing happens.
export function Num({ v }) {
  const f = useChange(v, { ms: 1700, ok: isGoal });
  return <span key={f.n} className={"sn" + (f.on ? " sn-bump" : "")}>{v ?? "–"}</span>;
}
// Home–away score with the goal highlight on whichever side changed.
export const Score = ({ a, b, className = "score" }) => <span className={className}><Num v={a} />–<Num v={b} /></span>;
