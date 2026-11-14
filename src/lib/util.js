// Times are unix seconds (t). Display uses the viewer's local timezone.
export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(d) + "%");
export const dayLabel = (t) => new Date(t * 1000).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export const shortDate = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
export const timeLabel = (t) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const dateTimeLabel = (t) => `${dayLabel(t)} · ${timeLabel(t)}`;

// Upcoming matches in date order: drops finished and long-overdue "not started" entries, keeps live, postponed and cancelled ones (shown with a badge)
export const upcoming = (list, now = Date.now() / 1000) => list
  .filter((f) => f.t != null && f.s !== "finished" && (["postponed", "cancelled", "canceled", "inprogress"].includes(f.s) || f.t >= now - 3 * 3600))
  .sort((a, b) => a.t - b.t || a.id - b.id);

export function groupByDay(list) {
  const g = new Map();
  for (const m of list) { const k = dayLabel(m.t); if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
  return [...g];
}

// League table from finished matches. venue: "total" | "home" | "away"
export function standings(results, teams, venue = "total") {
  const T = Object.fromEntries(teams.map((t) => [t.id, { t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  const add = (r, f, a) => { r.p++; r.gf += f; r.ga += a; if (f > a) { r.w++; r.pts += 3; } else if (f === a) { r.d++; r.pts++; } else r.l++; };
  for (const m of results) {
    const H = T[m.h], A = T[m.a];
    if (H && venue !== "away") add(H, m.hg, m.ag);
    if (A && venue !== "home") add(A, m.ag, m.hg);
  }
  return Object.values(T).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.t.name.localeCompare(b.t.name));
}

// Per-team summary from results. venue: "all" | "home" | "away"
export function summary(results, id, venue = "all") {
  const ms = results.filter((m) => (venue !== "away" && m.h === id) || (venue !== "home" && m.a === id));
  const n = ms.length, c = { w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, fts: 0, btts: 0, o25: 0 };
  for (const m of ms) {
    const home = m.h === id, f = home ? m.hg : m.ag, a = home ? m.ag : m.hg;
    if (f > a) c.w++; else if (f === a) c.d++; else c.l++;
    c.gf += f; c.ga += a; if (!a) c.cs++; if (!f) c.fts++; if (f && a) c.btts++; if (f + a > 2) c.o25++;
  }
  const r = (v) => (n ? v / n : null);
  return { n, w: c.w, d: c.d, l: c.l, gf: r(c.gf), ga: r(c.ga), winPct: r(c.w), cs: r(c.cs), fts: r(c.fts), btts: r(c.btts), o25: r(c.o25), ppg: r(c.w * 3 + c.d) };
}

// Team form statistics (averages per game over the last matches, from the data sync) -> the keys the comparison rows use.
// Returns null when the sync has no statistics for the team yet.
export function perGame(st) {
  const a = st?.avg;
  if (!a || !Object.keys(a).length) return null;
  return { n: st.n ?? 0, shots: a.total_shots, shotsOnTarget: a.shots_on_target, corners: a.corner_kicks, yellowCards: a.yellow_cards, redCards: a.red_cards, fouls: a.fouls,
    offsides: a.offsides, ballPossession: a.ball_possession, xg: a.expected_goals ?? a.xg };
}

/* ---------- picks ---------- */
export const MARKETS = {
  "1X2": { label: "Match result", sel: { H: "Home win", D: "Draw", A: "Away win" } },
  OU25: { label: "Total goals 2.5", sel: { O: "Over 2.5", U: "Under 2.5" } },
  BTTS: { label: "Both teams score", sel: { Y: "Yes", N: "No" } },
};
export function outcomeOf(market, hg, ag) {
  if (market === "1X2") return hg > ag ? "H" : hg < ag ? "A" : "D";
  if (market === "OU25") return hg + ag > 2 ? "O" : "U";
  return hg > 0 && ag > 0 ? "Y" : "N";
}
// Old picks (v1 app) only had { predicted: "H"|"D"|"A" }
export const pickMarket = (p) => p.market ?? "1X2";
export const pickSel = (p) => p.selection ?? p.predicted;
export function settle(p, hg, ag) {
  const won = outcomeOf(pickMarket(p), hg, ag) === pickSel(p);
  const profit = p.odds && p.stake ? (won ? p.stake * (p.odds - 1) : -p.stake) : null;
  return { won, profit };
}
export const pickLabel = (p) => MARKETS[pickMarket(p)]?.sel[pickSel(p)] ?? pickSel(p);

/* ---------- generic record display (squads, players, transfers: field names vary) ---------- */
export const humanize = (k) => String(k).replace(/_/g, " ").replace(/\bid\b/i, "ID").replace(/^\w/, (c) => c.toUpperCase());
const MONEY = /(fee|value|spend|income|price|salary|wage)/i;
export function fmtVal(k, v) {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return MONEY.test(k) && Math.abs(v) >= 1000 ? "€" + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M" : Math.round(v / 1e3) + "K") : String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return Number.isNaN(+d) ? s : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
  return s;
}
export const first = (o, ...keys) => { for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
export const ageOf = (dob) => { const t = Date.parse(dob); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 31557600000) : null; };
