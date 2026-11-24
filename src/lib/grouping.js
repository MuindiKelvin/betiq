import { shiftDay } from "./board.js";

// Folds finished match days into weeks, months and years so old history stays short.
//   - the last RECENT_DAYS days (counting back from today) stay as single days
//   - older days of the current month  -> grouped by week  (Monday to Sunday, cut at the month's edges)
//   - older days of earlier months     -> month > week > day
//   - days of earlier years            -> year > month > week > day
// Input: receipts (see buildReceipts) newest first, `today` as a local day key "YYYY-MM-DD".
// Output: nodes newest first, either { type: "day", r } or { type: "group", level, key, label, children, stats }.
export const RECENT_DAYS = 7;

const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const fmt = (key, o) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: "UTC", ...o }); };

// the week of a day key, cut to its month: { key, label }
export function weekOf(key) {
  const [y, m, d] = key.split("-").map(Number), dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // Monday = 0
  const first = `${key.slice(0, 7)}-01`, last = iso(y, m + 1, 0), mon = iso(y, m, d - dow), sun = iso(y, m, d - dow + 6);
  const a = mon < first ? first : mon, b = sun > last ? last : sun, day = { day: "numeric", month: "short" };
  return { key: "w" + a, label: a === b ? fmt(a, day) : `${fmt(a, day)} – ${fmt(b, day)}` };
}

// totals over the days inside a group
export function statsOf(days) {
  const pl = days.filter((r) => r.profit != null);
  return { days: days.length, picks: days.reduce((s, r) => s + r.picks.length, 0), settled: days.reduce((s, r) => s + r.settled, 0), won: days.reduce((s, r) => s + r.won, 0), profit: pl.length ? pl.reduce((s, r) => s + r.profit, 0) : null };
}

export function groupFinished(list, today, recentDays = RECENT_DAYS) {
  const cutoff = shiftDay(today, -recentDays), nodes = [], index = new Map();
  // find or create the group `key` inside `parent` (an array), keeping first-seen (newest first) order
  const group = (parent, level, key, label) => {
    let g = index.get(key);
    if (!g) { g = { type: "group", level, key: "g:" + key, label, children: [], days: [] }; index.set(key, g); parent.push(g); }
    return g;
  };
  for (const r of list) {
    if (r.key >= cutoff) { nodes.push({ type: "day", r }); continue; }
    let parent = nodes;
    const path = [];
    if (r.key.slice(0, 4) < today.slice(0, 4)) path.push(["year", "y" + r.key.slice(0, 4), r.key.slice(0, 4)]);
    if (r.key.slice(0, 7) < today.slice(0, 7)) path.push(["month", "m" + r.key.slice(0, 7), fmt(r.key, { month: "long", year: "numeric" })]);
    const w = weekOf(r.key); path.push(["week", w.key, w.label]);
    for (const [level, key, label] of path) { const g = group(parent, level, key, label); g.days.push(r); parent = g.children; }
    parent.push({ type: "day", r });
  }
  const done = (n) => { if (n.type === "group") { n.stats = statsOf(n.days); delete n.days; n.children.forEach(done); } return n; };
  return nodes.map(done);
}

// every group key in a tree (for Expand all / Collapse all)
export const groupKeys = (nodes) => nodes.flatMap((n) => (n.type === "group" ? [n.key, ...groupKeys(n.children)] : []));
// does a group contain the day `key`?
export const holds = (n, key) => n.type === "day" ? n.r.key === key : n.children.some((c) => holds(c, key));
