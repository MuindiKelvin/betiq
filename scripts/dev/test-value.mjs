// Tests for src/lib/value.js and src/lib/calibration.js.  npm test
import assert from "node:assert/strict";
import { assess, kellyFraction, parseOdds, removeMargin, stakeFraction } from "../../src/lib/value.js";
import { MIN_PICKS, calibrate, compare } from "../../src/lib/calibration.js";
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// odds parsing
assert.equal(parseOdds("2.10"), 2.1); assert.equal(parseOdds("1"), null); assert.equal(parseOdds(""), null); assert.equal(parseOdds("abc"), null); assert.equal(parseOdds("0.5"), null);

// margin removal
const mk = removeMargin({ H: 2, D: 3.5, A: 4 }, ["H", "D", "A"]);
assert.ok(near(mk.margin, 0.5 + 1 / 3.5 + 0.25 - 1)); assert.ok(near(Object.values(mk.probs).reduce((a, b) => a + b), 1)); assert.ok(near(mk.probs.H, 0.5 / (0.5 + 1 / 3.5 + 0.25)));
assert.equal(removeMargin({ H: 2, D: 3.5 }, ["H", "D", "A"]), null); assert.equal(removeMargin({ O: 1.9, U: null }, ["O", "U"]), null);
const fair = removeMargin({ Y: 2, N: 2 }, ["Y", "N"]); assert.ok(near(fair.margin, 0) && near(fair.probs.Y, 0.5));

// Kelly staking
assert.ok(near(kellyFraction(0.55, 2), 0.1)); assert.equal(kellyFraction(0.4, 2), 0); assert.equal(kellyFraction(0.5, 1), 0); assert.equal(kellyFraction(1, 2), 0);
assert.ok(near(stakeFraction(0.55, 2), 0.025)); assert.equal(stakeFraction(0.9, 3), 0.05);

// verdict tiers
let a = assess({ prob: 0.55, odds: 2, mkt: null, sel: "H" }); assert.equal(a.tier, "value"); assert.ok(near(a.ev, 0.1)); assert.ok(near(a.edge, 0.05)); assert.ok(a.stakeFrac > 0);
a = assess({ prob: 0.5, odds: 2.02, mkt: null, sel: "H" }); assert.equal(a.tier, "fair"); assert.equal(a.stakeFrac, 0);
a = assess({ prob: 0.4, odds: 2, mkt: null, sel: "H" }); assert.equal(a.tier, "poor"); assert.equal(a.stakeFrac, 0);
a = assess({ prob: 0.55, odds: 2, mkt: null, sel: "H", rough: true }); assert.equal(a.tier, "value"); assert.equal(a.stakeFrac, 0);
a = assess({ prob: 0.55, odds: 2.2, mkt: removeMargin({ O: 2.2, U: 1.75 }, ["O", "U"]), sel: "O" }); assert.ok(a.mktProb > 0 && a.mktProb < 0.5 && a.margin > 0 && near(a.gap, 0.55 - a.mktProb));
console.log("ok  value");

// calibration
const rows = (n, p, wins) => Array.from({ length: n }, (_, i) => ({ won: i < wins, prob: p }));
let c = calibrate(rows(10, 0.5, 5), "prob"); assert.ok(near(c.brier, 0.25) && near(c.gap, 0) && near(c.ece, 0) && c.n === 10);
c = calibrate(rows(10, 1, 10), "prob"); assert.ok(near(c.brier, 0) && near(c.ece, 0));
c = calibrate(rows(10, 0.7, 5), "prob"); assert.ok(near(c.gap, 0.2) && near(c.ece, 0.2) && near(c.brier, (0.3 ** 2 * 5 + 0.7 ** 2 * 5) / 10)); assert.equal(c.bins[5].n, 10); assert.equal(c.bins.reduce((s, b) => s + b.n, 0), 10);
c = calibrate([...rows(4, 0, 0), ...rows(4, 0.35, 1), { won: true, prob: 1 }, { won: null, prob: 0.5 }, { won: true, prob: undefined }, { won: true, prob: null }], "prob");
assert.equal(c.n, 9); assert.equal(c.bins[0].n, 4); assert.equal(c.bins[1].n, 4); assert.equal(c.bins[5].n, 1);
assert.equal(calibrate([{ won: true }], "prob"), null); assert.equal(calibrate([], "prob"), null);
const mixed = [{ won: true, prob: 0.6, myProb: 0.9 }, { won: false, prob: 0.6, myProb: null }, { won: false, prob: 0.5, myProb: 0.1 }];
const cmp = compare(mixed, "prob", "myProb"); assert.equal(cmp.n, 2); assert.ok(near(cmp.a, (0.16 + 0.25) / 2)); assert.ok(near(cmp.b, 0.01)); assert.equal(compare(mixed, "prob", "mktProb"), null);
assert.equal(MIN_PICKS, 10);
console.log("ok  calibration");
