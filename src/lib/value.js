// Value check helpers. Pure functions: no UI, no network.
export const KELLY_FRACTION = 0.25;   // stake a quarter of full Kelly: the model is an estimate, full Kelly is far too aggressive
export const STAKE_CAP = 0.05;        // never suggest more than 5% of the bankroll
export const VALUE_EV = 0.05;         // expected return per 1 staked needed to call a price "value"

export const validOdds = (x) => typeof x === "number" && Number.isFinite(x) && x > 1;
export const parseOdds = (s) => { const n = parseFloat(s); return validOdds(n) ? n : null; };

// Removes the bookmaker margin (proportional method). odds: { selection: decimal odds }, keys: EVERY selection of the market.
// total: what the fair probabilities add up to (1, or 2 for double chance, where each selection covers two of the three results).
// Returns null unless all of them have valid odds, else { margin, probs: { selection: fair probability } }.
export function removeMargin(odds, keys, total = 1) {
  if (keys.some((k) => !validOdds(odds[k]))) return null;
  const sum = keys.reduce((s, k) => s + 1 / odds[k], 0);
  return { margin: sum / total - 1, probs: Object.fromEntries(keys.map((k) => [k, (total / odds[k]) / sum])) };
}

// Full-Kelly fraction of bankroll for win probability p at decimal odds o (0 when there is no edge).
export const kellyFraction = (p, o) => (validOdds(o) && p > 0 && p < 1 ? Math.max(0, (p * o - 1) / (o - 1)) : 0);
export const stakeFraction = (p, o) => Math.min(STAKE_CAP, KELLY_FRACTION * kellyFraction(p, o));

// prob: model probability of the selection; odds: the price offered; mkt: removeMargin() result or null; rough: cup/continental model
export function assess({ prob, odds, mkt, sel, rough = false }) {
  const ev = prob * odds - 1, mktProb = mkt?.probs[sel] ?? null;
  const tier = ev > VALUE_EV ? "value" : ev > -VALUE_EV ? "fair" : "poor";
  return { ev, tier, mktProb, margin: mkt?.margin ?? null, edge: prob - (mktProb ?? 1 / odds), gap: mktProb == null ? null : prob - mktProb,
    stakeFrac: tier === "value" && !rough ? stakeFraction(prob, odds) : 0 };
}
