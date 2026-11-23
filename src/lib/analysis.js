import { buildModel, headToHead, keyFactors, predict, teamForm, teamMatches } from "./model.js";
import { perGame, summary } from "./util.js";

// Everything the Analyze screen shows for one pairing. results = all loaded matches of the league.
// Adds meetings found by the all-competition lookup that the league data does not already contain (same pair, within a day).
export function mergeH2H(results, H, A, extra = []) {
  const days = new Map();
  for (const m of results) if ((m.h === H.id && m.a === A.id) || (m.h === A.id && m.a === H.id)) (days.get(`${m.h}-${m.a}`) ?? days.set(`${m.h}-${m.a}`, []).get(`${m.h}-${m.a}`)).push(Math.floor(m.t / 86400));
  const fresh = extra.filter((x) => !(days.get(`${x.h}-${x.a}`) ?? []).some((d) => Math.abs(d - Math.floor(x.t / 86400)) <= 1)).map((x) => ({ ...x, s: 9 }));
  return fresh.length ? [...results.filter((m) => (m.h === H.id && m.a === A.id) || (m.h === A.id && m.a === H.id)), ...fresh] : null;
}

const wins = (l) => l.filter((m) => m.res === "W").length;
export function insights({ results, H, A, fh, fa, h2h, p }) {
  const out = [], n = (x) => x.name;
  if (fh.last.length >= 5) out.push({ ok: wins(fh.last) >= 3, text: `${n(H)} ${wins(fh.last) >= 3 ? "are in good form" : "have struggled lately"} (${wins(fh.last)}W in last 5).` });
  const away = teamMatches(results, A.id).filter((m) => !m.home).slice(0, 5);
  if (away.length >= 3) out.push({ ok: wins(away) >= Math.ceil(away.length / 2), text: `${n(A)} ${wins(away) >= Math.ceil(away.length / 2) ? "travel well" : "have struggled away"} (${wins(away)}W in last ${away.length} away).` });
  const r = h2h.rows.slice(0, 10), w = r.filter((m) => m.f > m.a).length;
  if (r.length >= 3) {
    out.push({ ok: w >= r.filter((m) => m.f < m.a).length, text: `${n(H)} won ${w} of the last ${r.length} head-to-head meetings.` });
    const o = r.filter((m) => m.f + m.a > 2).length; out.push({ ok: o / r.length >= 0.5, text: `Over 2.5 goals in ${Math.round((o / r.length) * 100)}% of past meetings.` });
  }
  out.push({ ok: p.confidence !== "Low", text: `Model confidence is ${p.confidence.toLowerCase()}${p.thin ? " (little data for at least one team)" : ""}.` });
  return out.slice(0, 5);
}

// comp: { name, kind } of the competition (kind "comp" = cup/continental: rough predictions)
export function analyze({ results, H, A, byId, code, comp, extraH2H }) {
  const nm = (id) => byId[id]?.name ?? "Team";
  const model = buildModel(results);
  const pairRows = extraH2H?.length ? mergeH2H(results, H, A, extraH2H) : null;
  const fh = teamForm(results, H.id), fa = teamForm(results, A.id), h2h = headToHead(pairRows ?? results, H.id, A.id);
  const p = predict(model, H.id, A.id, { formH: fh, formA: fa, h2h });
  const cur = results.filter((r) => r.s === 0);
  const rowsFor = (id) => (cur.filter((m) => m.h === id || m.a === id).length >= 5 ? cur : results); // early season: use older data too
  const sH = summary(rowsFor(H.id), H.id), sA = summary(rowsFor(A.id), A.id);
  return {
    code, comp: comp ?? null, allComp: !!pairRows, H, A, p, model, fh, fa, h2h, sH, sA,
    homeAtHome: summary(rowsFor(H.id), H.id, "home"), awayAway: summary(rowsFor(A.id), A.id, "away"),
    pgH: perGame(H.st), pgA: perGame(A.st),
    insights: insights({ results, H, A, fh, fa, h2h, p }),
    factors: keyFactors({ H: H.id, A: A.id, p, fh, fa, h2h, model, nm }),
  };
}
// Probability of one selection in one market, for the odds/value check.
export const selProb = (p, market, sel) => ({
  "1X2": { H: p.home, D: p.draw, A: p.away },
  DC: { HD: p.home + p.draw, DA: p.draw + p.away, HA: p.home + p.away },
  OU15: { O: p.over15, U: 1 - p.over15 },
  OU25: { O: p.over25, U: 1 - p.over25 },
  OU35: { O: p.over35, U: 1 - p.over35 },
  BTTS: { Y: p.btts, N: 1 - p.btts },
  CSH: { Y: p.homeCS, N: 1 - p.homeCS },
  CSA: { Y: p.awayCS, N: 1 - p.awayCS },
})[market]?.[sel];
