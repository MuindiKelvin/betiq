// Daily model picks. Pure functions (no Firebase, no DOM): scripts/picks.mjs uses them to write daily/<UTC day>, the Daily Picks page to show and download them.
// A pick is the model's most probable selection among the three headline markets, kept only above a minimum probability. There are no bookmaker
// odds here, so these are model picks, not value bets: use the Value finder to compare a pick with a real price.
// Cups and continental competitions (kind "comp") are included, but their model is rough (strengths come only from that competition's own matches),
// so every minimum probability is raised by DAILY.roughPlus there.
import { analyze, selProb } from "./analysis.js";
import { TOP } from "./board.js";
import { MARKETS, timeLabel, tzAt } from "./util.js";

export const DAILY = { cap: 5, capCup: 10, ahead: 3, roughPlus: 0.05, min: { "1X2": 0.5, OU25: 0.6, BTTS: 0.6 } };   // cap / capCup: picks per league / per cup or continental competition per UTC day (a Champions League night has up to 18 matches); ahead: UTC days after today
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const rnd = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// p: a model prediction (predict()). Returns { m, s, p } for the most probable selection that clears its market's minimum, else null.
export function bestPick(p, min = DAILY.min) {
  let best = null;
  for (const m of Object.keys(min)) for (const s of Object.keys(MARKETS[m].sel)) {
    const v = selProb(p, m, s);
    if (v >= min[m] && (!best || v > best.p)) best = { m, s, p: v };
  }
  return best;
}

// One competition: fixtures [{ id, h, a, t, s }], teams [{ id, name, ... }], results (every loaded season, as the app loads them).
// Rows: { c, id, h, a, hn, an, t, m, s, p, x: [expected goals home, away] }. Skipped: fixtures that are not "not started" or whose kick-off is outside
// (nowSec, untilSec], and pairs where either team has fewer than 8 matches of data. Cups and continental competitions use the raised minimums.
// why (optional array): receives { id, hn, an, t, reason } for every in-window fixture that got no pick, so a missing match can be explained (npm run picks:why).
export function dayPicks({ code, comp, fixtures, teams, results, nowSec, untilSec, why }) {
  if (!results?.length) return [];
  const min = comp?.kind === "comp" ? Object.fromEntries(Object.entries(DAILY.min).map(([m, v]) => [m, v + DAILY.roughPlus])) : DAILY.min;
  const byId = Object.fromEntries((teams ?? []).map((t) => [t.id, t])), out = [];
  for (const f of fixtures ?? []) {
    if (f?.id == null || f.t == null || f.t <= nowSec || f.t > untilSec || (f.s ?? "notstarted") !== "notstarted") continue;
    const H = byId[f.h], A = byId[f.a], skip = (reason) => why?.push({ id: f.id, hn: H?.name ?? `team ${f.h}`, an: A?.name ?? `team ${f.a}`, t: f.t, reason });
    if (!H || !A) { skip("a team is missing from this competition's team list"); continue; }
    let o; try { o = analyze({ results, H, A, byId, code, comp }); } catch (e) { skip("model error: " + e.message); continue; }
    if (o.p.thin) { skip("too little data: one team has fewer than 8 matches in the loaded seasons"); continue; }
    const b = bestPick(o.p, min);
    if (!b && why) skip("no selection clears its minimum: " + Object.keys(min).map((m) => { const t = bestPick(o.p, { [m]: 0 }); return `${MARKETS[m].sel[t.s]} ${Math.round(t.p * 100)}% < ${Math.round(min[m] * 100)}%`; }).join(", "));
    if (b) out.push({ c: code, id: f.id, h: f.h, a: f.a, hn: H.name, an: A.name, t: f.t, m: b.m, s: b.s, p: rnd(b.p, 4), x: [rnd(o.p.lh, 2), rnd(o.p.la, 2)] });
  }
  return out;
}

// One UTC day. prev: rows already stored for the day; fresh: rows computed now (all of them kick off after nowSec).
// A pick whose match has started is frozen: it stays exactly as it was and is never recomputed, so the list does not change after kick-off.
// The rest is replaced by the fresh rows, best probability first, up to `cap` picks per competition (frozen ones count).
// cap: a number, or a function of the competition code (leagues and cups have different caps).
export function mergeDay({ prev, fresh, nowSec, cap = DAILY.cap }) {
  const capOf = typeof cap === "function" ? cap : () => cap, key = (x) => `${x.c}:${x.id}`, frozen = (prev ?? []).filter((x) => x.t <= nowSec), ids = new Set(frozen.map(key)), per = new Map();
  for (const x of frozen) per.set(x.c, (per.get(x.c) ?? 0) + 1);
  const add = [];
  for (const x of [...fresh].sort((a, b) => b.p - a.p || a.t - b.t || a.id - b.id)) {
    if (ids.has(key(x)) || (per.get(x.c) ?? 0) >= capOf(x.c)) continue;
    per.set(x.c, (per.get(x.c) ?? 0) + 1); add.push(x);
  }
  return [...frozen, ...add].sort((a, b) => a.t - b.t || a.id - b.id);
}

// Rows -> competition groups: the most used competitions first (same order as the Live board), then by name. byCode: catalog by code.
export function groupByComp(rows, byCode = {}) {
  const g = new Map();
  for (const x of rows) (g.get(x.c) ?? g.set(x.c, []).get(x.c)).push(x);
  const list = [...g].map(([code, picks]) => ({ code, name: byCode[code]?.name ?? code, country: byCode[code]?.country ?? "", id: byCode[code]?.id ?? +code.slice(1), picks: picks.sort((a, b) => a.t - b.t || a.id - b.id) }));
  const rank = (x) => { const i = TOP.indexOf(x.id); return i >= 0 ? i : TOP.length; };
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// The id a confirmed daily pick is saved under in My Picks. One per match and market, so confirming twice cannot create a duplicate.
export const pickId = (x) => `a_${x.id}_${x.m}`;

// A receipt (same shape as My Picks receipts, see lib/receipts.js) for the rows of one day, optionally one competition (code). rows must not be empty.
export function dailyReceipt(rows, { day, code = null }) {
  const picks = rows.map((x) => ({ v: 3, matchId: x.id, league: x.c, home: x.hn, away: x.an, market: x.m, selection: x.s, prob: x.p, odds: null, stake: null, note: `Kick-off ${timeLabel(x.t)} ${tzAt(x.t)}`.trim() }));
  const tag = code ? "-" + code : "";
  return { key: `daily-${day}${tag}`, id: `BIQ-D${day.replace(/-/g, "")}${tag}`, t: Math.min(...rows.map((x) => x.t)), picks, open: false, openCount: 0, settled: 0, won: 0, stake: 0, ret: 0, profit: null };
}
