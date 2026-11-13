// BetIQ analysis engine (pure functions, no Firebase). Results are compact rows:
//   { id, h, a, hg, ag, t (unix seconds), r (round), s (0 = current season, 1 = previous, ...) }
//
// 1) Strengths: time-decayed home/away attack & defence relative to the league average, shrunk toward 1
//    when a team has few matches.           2) Goals ~ Poisson(lambda) per team -> scoreline grid -> markets.
// 3) Two small, BOUNDED nudges: recent form (+/-5%) and head-to-head goal difference (+/-4%).
//    Use backtest() (Model tab) to check on your data whether those nudges help; set the K values to 0 to disable.
export const DEFAULTS = { decay: 0.0045, prior: 6, formK: 0.025, h2hK: 0.02 };
const DAY = 86400, clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const NEUTRAL = { attHome: 1, defHome: 1, attAway: 1, defAway: 1, n: 0 };

export function buildModel(results, now = Date.now() / 1000, o = {}) {
  const decay = o.decay ?? DEFAULTS.decay, prior = o.prior ?? DEFAULTS.prior;
  const T = new Map(), get = (id) => T.get(id) ?? (T.set(id, { hw: 0, hgf: 0, hga: 0, hn: 0, aw: 0, agf: 0, aga: 0, an: 0 }), T.get(id));
  let sw = 0, sh = 0, sa = 0;
  for (const m of results) {
    const w = Math.exp(-decay * Math.max(0, now - m.t) / DAY);
    sw += w; sh += w * m.hg; sa += w * m.ag;
    const H = get(m.h), A = get(m.a);
    H.hw += w; H.hgf += w * m.hg; H.hga += w * m.ag; H.hn++;
    A.aw += w; A.agf += w * m.ag; A.aga += w * m.hg; A.an++;
  }
  const avgHome = sw ? sh / sw : 1.5, avgAway = sw ? sa / sw : 1.2;
  const shrink = (v, n) => 1 + (n / (n + prior)) * (v - 1);
  const ratio = (g, w, avg) => (w && avg ? g / w / avg : 1);
  const teams = {};
  for (const [id, x] of T) teams[id] = {
    attHome: shrink(ratio(x.hgf, x.hw, avgHome), x.hn), defHome: shrink(ratio(x.hga, x.hw, avgAway), x.hn),
    attAway: shrink(ratio(x.agf, x.aw, avgAway), x.an), defAway: shrink(ratio(x.aga, x.aw, avgHome), x.an), n: x.hn + x.an,
  };
  return { avgHome, avgAway, teams, n: results.length };
}

/* ---------- team form and head-to-head ---------- */
const pts = (f, a) => (f > a ? 3 : f === a ? 1 : 0);
// Newest-first list of one team's matches, each from the team's own perspective.
export function teamMatches(results, id) {
  return results.filter((m) => m.h === id || m.a === id).sort((x, y) => y.t - x.t).map((m) => {
    const home = m.h === id, f = home ? m.hg : m.ag, a = home ? m.ag : m.hg;
    return { id: m.id, t: m.t, home, opp: home ? m.a : m.h, f, a, res: f > a ? "W" : f === a ? "D" : "L", s: m.s ?? 0 };
  });
}
export function teamForm(results, id, k = 5) {
  const ms = teamMatches(results, id), last = ms.slice(0, k), base = ms.slice(0, 20);
  const ppg = (l) => (l.length ? l.reduce((s, m) => s + pts(m.f, m.a), 0) / l.length : null);
  return { last, form: last.map((m) => m.res), points: last.reduce((s, m) => s + pts(m.f, m.a), 0), ppg5: ppg(last), ppgBase: base.length >= 8 ? ppg(base) : null,
    gf: last.reduce((s, m) => s + m.f, 0), ga: last.reduce((s, m) => s + m.a, 0), n: ms.length };
}
// Previous meetings of two teams (any venue, any loaded season), newest first, from `hId`'s perspective.
export function headToHead(results, hId, aId) {
  const list = results.filter((m) => (m.h === hId && m.a === aId) || (m.h === aId && m.a === hId)).sort((x, y) => y.t - x.t);
  const rec = { w: 0, d: 0, l: 0, gf: 0, ga: 0, btts: 0, o25: 0, n: list.length };
  const rows = list.map((m) => {
    const hHome = m.h === hId, f = hHome ? m.hg : m.ag, a = hHome ? m.ag : m.hg;
    rec.gf += f; rec.ga += a; if (f > a) rec.w++; else if (f === a) rec.d++; else rec.l++;
    if (f && a) rec.btts++; if (f + a > 2) rec.o25++;
    return { ...m, f, a, hHome };
  });
  return { rows, rec };
}

/* ---------- Poisson markets ---------- */
const FACT = [1]; for (let i = 1; i <= 14; i++) FACT[i] = FACT[i - 1] * i;
const pois = (l, k) => Math.exp(-l) * l ** k / FACT[k];

export function markets(lh, la, N = 10) {
  let H = 0, D = 0, A = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0, tot = 0;
  const scores = [], matrix = [];
  for (let i = 0; i <= N; i++) {
    if (i <= 5) matrix[i] = [];
    for (let j = 0; j <= N; j++) {
      const p = pois(lh, i) * pois(la, j); tot += p;
      if (i > j) H += p; else if (i === j) D += p; else A += p;
      if (i + j > 1) o15 += p; if (i + j > 2) o25 += p; if (i + j > 3) o35 += p;
      if (i && j) btts += p;
      if (i <= 5 && j <= 5) { matrix[i][j] = p; scores.push({ h: i, a: j, p }); }
    }
  }
  const n = (x) => x / tot;
  scores.sort((x, y) => y.p - x.p);
  return { home: n(H), draw: n(D), away: n(A), over15: n(o15), over25: n(o25), over35: n(o35), btts: n(btts),
    homeCS: Math.exp(-la), awayCS: Math.exp(-lh), scores: scores.slice(0, 6).map((s) => ({ ...s, p: n(s.p) })), matrix: matrix.map((r) => r.map(n)) };
}

export function predict(model, hId, aId, ctx = {}, o = {}) {
  const formK = o.formK ?? DEFAULTS.formK, h2hK = o.h2hK ?? DEFAULTS.h2hK;
  const h = model.teams[hId] ?? NEUTRAL, a = model.teams[aId] ?? NEUTRAL;
  let lh = model.avgHome * h.attHome * a.defAway, la = model.avgAway * a.attAway * h.defHome;
  const adj = { form: [1, 1], h2h: 1 };
  const fd = (f) => (f && f.ppg5 != null && f.ppgBase != null ? clamp(f.ppg5 - f.ppgBase, -2, 2) : 0);
  if (formK) { adj.form = [1 + formK * fd(ctx.formH), 1 + formK * fd(ctx.formA)]; lh *= adj.form[0]; la *= adj.form[1]; }
  const r = ctx.h2h?.rec;
  if (h2hK && r && r.n >= 3) {
    const recent = ctx.h2h.rows.slice(0, 6), gd = recent.reduce((s, m) => s + (m.f - m.a), 0) / recent.length;
    adj.h2h = 1 + h2hK * clamp(gd, -2, 2) * (recent.length / (recent.length + 4));
    lh *= adj.h2h; la /= adj.h2h;
  }
  lh = clamp(lh, 0.15, 4.5); la = clamp(la, 0.15, 4.5);
  const mk = markets(lh, la), top = Math.max(mk.home, mk.draw, mk.away);
  const thin = Math.min(h.n, a.n) < 8;
  return { ...mk, lh, la, adj, thin, outcome: mk.home >= mk.draw && mk.home >= mk.away ? "H" : mk.away >= mk.draw ? "A" : "D",
    confidence: thin ? "Low" : top > 0.55 ? "High" : top > 0.42 ? "Medium" : "Low" };
}
export const fairOdds = (p) => (p > 0.001 ? 1 / p : null);

/* ---------- backtest: predict each recent match using only data from before it ---------- */
export function backtest(results, { limit = 150, minPrior = 10 } = {}) {
  const asc = [...results].sort((x, y) => x.t - y.t), V = { base: [], strength: [], form: [], full: [] };
  const rows = [];
  for (let i = asc.length - 1; i >= 0 && rows.length < limit; i--) {
    const m = asc[i], prior = asc.slice(0, i).filter((x) => x.t < m.t);
    const cnt = (id) => prior.reduce((s, x) => s + (x.h === id || x.a === id ? 1 : 0), 0);
    if (cnt(m.h) < minPrior || cnt(m.a) < minPrior) continue;
    const model = buildModel(prior, m.t);
    const ctx = { formH: teamForm(prior, m.h), formA: teamForm(prior, m.a), h2h: headToHead(prior, m.h, m.a) };
    const actual = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;
    const f = prior.reduce((s, x) => { s[x.hg > x.ag ? 0 : x.hg === x.ag ? 1 : 2]++; return s; }, [0, 0, 0]), nn = prior.length || 1;
    const P = (x) => [x.home, x.draw, x.away];
    rows.push({ actual, base: f.map((v) => v / nn), strength: P(predict(model, m.h, m.a, ctx, { formK: 0, h2hK: 0 })),
      form: P(predict(model, m.h, m.a, ctx, { h2hK: 0 })), full: P(predict(model, m.h, m.a, ctx)) });
  }
  if (rows.length < 20) return null;
  const score = (key) => {
    let hit = 0, ll = 0, br = 0;
    for (const r of rows) {
      const p = r[key], pick = p.indexOf(Math.max(...p));
      if (pick === r.actual) hit++;
      ll -= Math.log(Math.max(p[r.actual], 1e-6));
      br += p.reduce((s, v, k) => s + (v - (k === r.actual ? 1 : 0)) ** 2, 0);
    }
    return { acc: hit / rows.length, logloss: ll / rows.length, brier: br / rows.length };
  };
  const bins = [[0, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 1.01]].map(([lo, hi]) => {
    const inb = rows.filter((r) => { const t = Math.max(...r.full); return t >= lo && t < hi; });
    return { lo, hi: Math.min(hi, 1), n: inb.length, hit: inb.length ? inb.filter((r) => r.full.indexOf(Math.max(...r.full)) === r.actual).length / inb.length : null,
      avg: inb.length ? inb.reduce((s, r) => s + Math.max(...r.full), 0) / inb.length : null };
  });
  return { n: rows.length, base: score("base"), strength: score("strength"), form: score("form"), full: score("full"), bins };
}

/* ---------- plain-language reasons shown next to the prediction ---------- */
export function keyFactors({ H, A, p, fh, fa, h2h, model, nm }) {
  const out = [], mh = model.teams[H] ?? NEUTRAL, ma = model.teams[A] ?? NEUTRAL, x = (v) => v.toFixed(2) + "x";
  out.push(`Expected goals ${p.lh.toFixed(1)} – ${p.la.toFixed(1)}: ${nm(H)} attack at home is ${x(mh.attHome)} the league average against ${nm(A)}'s away defence of ${x(ma.defAway)} (below 1.00x is a tighter defence).`);
  if (fh.last.length >= 3 && fa.last.length >= 3) {
    const lead = fh.points === fa.points ? null : fh.points > fa.points ? H : A;
    out.push(`Form: ${nm(H)} took ${fh.points} of ${fh.last.length * 3} points in their last ${fh.last.length}, ${nm(A)} ${fa.points} of ${fa.last.length * 3}${lead ? `, so ${nm(lead)} arrive in better shape` : ", so form is level"}.`);
  }
  if (h2h.rec.n) {
    const r = h2h.rec;
    out.push(`Head-to-head: ${r.n} meeting${r.n > 1 ? "s" : ""} on record, ${nm(H)} ${r.w}W ${r.d}D ${r.l}L, averaging ${((r.gf + r.ga) / r.n).toFixed(1)} goals.${p.adj.h2h !== 1 ? " This nudges the prediction slightly." : ""}`);
  } else out.push("Head-to-head: no meetings in the loaded seasons, so the prediction relies on team strength and form only.");
  if (p.thin) out.push("Caution: at least one team has fewer than 8 matches of data, so treat this as a rough estimate.");
  return out;
}
