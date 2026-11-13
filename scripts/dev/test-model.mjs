// Sanity tests for src/lib/model.js using synthetic leagues with KNOWN strengths.  npm test
import assert from "node:assert/strict";
import { buildModel, predict, markets, backtest, headToHead, teamForm } from "../../src/lib/model.js";

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pois = (l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const teams = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, att: 0.6 + rnd() * 1.0, def: 0.6 + rnd() * 1.0 }));
const now = Math.floor(Date.now() / 1000);
function season(startDaysAgo, s) {
  const out = []; let k = 0;
  for (const h of teams) for (const a of teams) if (h !== a) out.push({ h, a });
  out.sort(() => rnd() - 0.5);
  return out.map(({ h, a }, i) => ({ id: s * 1000 + i, h: h.id, a: a.id, hg: pois(1.5 * h.att * a.def), ag: pois(1.2 * a.att * h.def),
    t: now - (startDaysAgo - Math.floor((i * 300) / out.length)) * 86400, r: Math.floor(i / 10), s }));
}
const results = [...season(700, 1), ...season(380, 0)];

// 1) Markets are proper probability distributions and internally consistent
const mk = markets(1.6, 1.1);
assert.ok(Math.abs(mk.home + mk.draw + mk.away - 1) < 1e-9, "1X2 sums to 1");
assert.ok(mk.over15 > mk.over25 && mk.over25 > mk.over35, "over lines are ordered");
assert.ok(mk.home > mk.away, "higher lambda wins more often");
assert.ok(Math.abs(mk.matrix.flat().reduce((a, b) => a + b, 0) - 1) < 0.01, "6x6 grid covers ~all mass");
console.log("ok  markets");

// 2) Model recovers known team quality: stronger attack => higher expected goals
const model = buildModel(results, now);
const best = [...teams].sort((x, y) => y.att - x.att)[0], worst = [...teams].sort((x, y) => x.att - y.att)[0];
assert.ok(model.teams[best.id].attHome > model.teams[worst.id].attHome, "attack ranking recovered");
const corr = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); };
const cAtt = corr(teams.map((t) => t.att), teams.map((t) => (model.teams[t.id].attHome + model.teams[t.id].attAway) / 2));
const cDef = corr(teams.map((t) => t.def), teams.map((t) => (model.teams[t.id].defHome + model.teams[t.id].defAway) / 2));
console.log(`ok  strengths recovered (corr attack ${cAtt.toFixed(2)}, defence ${cDef.toFixed(2)})`);
assert.ok(cAtt > 0.6 && cDef > 0.6, "recovered strengths correlate with truth");

// 3) Prediction sanity: best attack at home vs worst defence >> reverse fixture
const p = predict(model, best.id, worst.id, {}), q = predict(model, worst.id, best.id, {});
assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-9);
assert.ok(p.lh > q.lh, "better team expects more goals");
console.log(`ok  predict ${p.home.toFixed(2)}/${p.draw.toFixed(2)}/${p.away.toFixed(2)}  lambda ${p.lh.toFixed(2)}-${p.la.toFixed(2)}`);

// 4) Form / H2H helpers
const f = teamForm(results, 3); assert.equal(f.last.length, 5); assert.ok(f.form.every((x) => "WDL".includes(x)));
const h = headToHead(results, 3, 4); assert.equal(h.rec.n, 4, "each pair meets twice per season, 2 seasons"); assert.equal(h.rec.w + h.rec.d + h.rec.l, h.rec.n);
console.log("ok  form + head-to-head");

// 5) Backtest: the model must beat naive baselines on data it never saw
const bt = backtest(results, { limit: 120 });
const fmt = (s) => `acc ${(s.acc * 100).toFixed(1)}%  logloss ${s.logloss.toFixed(3)}  brier ${s.brier.toFixed(3)}`;
console.log(`backtest on ${bt.n} matches\n  baseline  ${fmt(bt.base)}\n  strength  ${fmt(bt.strength)}\n  +form     ${fmt(bt.form)}\n  full      ${fmt(bt.full)}`);
assert.ok(bt.strength.logloss < bt.base.logloss, "strength model beats league-frequency baseline");
assert.ok(bt.full.logloss < bt.base.logloss);
console.log("calibration:", bt.bins.map((b) => `${Math.round(b.lo * 100)}-${Math.round(b.hi * 100)}%: n=${b.n} predicted ${b.avg ? (b.avg * 100).toFixed(0) : "-"}% actual ${b.hit != null ? (b.hit * 100).toFixed(0) : "-"}%`).join(" | "));
console.log("\nALL TESTS PASSED");
