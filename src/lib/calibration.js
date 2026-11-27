// Scores probabilities against what happened. Pure functions. rows = settled picks: { won: boolean, prob, myProb, mktProb }
import { MARKETS, pickMarket } from "./util.js";
export const MIN_PICKS = 10;
const EDGES = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1];

const usable = (r, f) => r.won != null && typeof r[f] === "number" && r[f] >= 0 && r[f] <= 1;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const y = (r) => (r.won ? 1 : 0);

// 95% Wilson interval for a hit rate of k wins in n picks: how wide the true rate could plausibly be. Wide = small sample.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// brier: mean squared error (0 perfect, 0.25 = always saying 50%). gap: average stated probability minus hit rate (+ = overconfident).
// ece: weighted average gap per probability band.
export function calibrate(rows, field) {
  const d = rows.filter((r) => usable(r, field));
  if (!d.length) return null;
  const bins = EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: EDGES[i + 1], rows: [] }));
  for (const r of d) { let i = EDGES.length - 2; while (i > 0 && r[field] < EDGES[i]) i--; bins[i].rows.push(r); }
  const out = bins.map((b) => ({ lo: b.lo, hi: b.hi, n: b.rows.length, avg: b.rows.length ? mean(b.rows.map((r) => r[field])) : null, hit: b.rows.length ? mean(b.rows.map(y)) : null }));
  const avg = mean(d.map((r) => r[field])), hit = mean(d.map(y));
  const won = d.reduce((s, r) => s + y(r), 0);
  return { n: d.length, won, ci: wilson(won, d.length), brier: mean(d.map((r) => (r[field] - y(r)) ** 2)), avg, hit, gap: avg - hit,
    ece: out.reduce((s, b) => s + (b.n ? (b.n / d.length) * Math.abs(b.avg - b.hit) : 0), 0), bins: out };
}

// Brier scores of two sources on the picks where both exist (a fair, like-for-like comparison)
export function compare(rows, a, b) {
  const d = rows.filter((r) => usable(r, a) && usable(r, b));
  return d.length ? { n: d.length, a: calibrate(d, a).brier, b: calibrate(d, b).brier } : null;
}

// Hit rate per market (Match result, Total goals 2.5, ...), most picks first: shows where a source is strong or weak.
export function byMarket(rows, field) {
  const g = new Map();
  for (const r of rows.filter((r) => usable(r, field))) { const k = pickMarket(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return [...g].map(([key, list]) => ({ key, label: MARKETS[key]?.label ?? key, n: list.length, won: list.reduce((s, r) => s + y(r), 0), avg: mean(list.map((r) => r[field])), hit: mean(list.map(y)) }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
