import { settle } from "./util.js";
import { validOdds } from "./value.js";

// The only fields of a saved pick that may change, and only before kick-off (firestore.rules enforces both).
export const EDITABLE = ["odds", "stake", "myProb", "mktProb"];
// Same test as the rule: a stored kick-off time that is still in the future (and, for the screen, nothing known yet about the match).
export const canEditPick = (p, nowMs) => p.v === 3 && !!p.matchId && typeof p.kickoff === "number" && p.kickoff * 1000 > nowMs && p.won == null && !p.live && !p.wait;
// Turns the three edit fields (text) into the update, or an error message. The market probability was worked out from the old odds, so it is cleared when the odds change.
export function editPatch(p, { odds, stake, mine }) {
  const txt = (v) => String(v ?? "").trim().replace(",", "."), o = txt(odds), s = txt(stake), m = txt(mine);
  const od = o === "" ? null : Number(o), st = s === "" ? null : Number(s), my = m === "" ? null : Number(m);
  if (od != null && !validOdds(od)) return { error: "Odds must be a decimal number above 1, for example 2.10." };
  if (st != null && !(Number.isFinite(st) && st > 0)) return { error: "Stake must be a number above 0." };
  if (st != null && od == null) return { error: "Add the odds too: a stake needs a price." };
  if (my != null && !(Number.isFinite(my) && my > 0 && my < 100)) return { error: "Your probability must be between 0 and 100." };
  return { patch: { odds: od, stake: st, myProb: my == null ? null : my / 100, mktProb: od === (p.odds ?? null) ? (p.mktProb ?? null) : null } };
}

// A saved pick plus the newest evidence about its match. `phase` comes from phaseOf (live feed, finals, change feed, schedule).
// A result from the data sync (p.won already set by loadPicks) is authoritative and is never overridden.
// Result: the pick, with one of: settled (score, won, profit, fin: "FT"), live (live: row), or a waiting state (wait: kind).
export function pickWithLive(p, phase) {
  if (p.won != null || p.v !== 3 || !p.matchId || !phase) return p;
  if (phase.kind === "finished" && phase.hg != null && phase.ag != null) return { ...p, score: `${phase.hg}–${phase.ag}`, ...settle(p, phase.hg, phase.ag), from: phase.src };
  if (phase.kind === "live") return { ...p, live: phase.row, liveStale: phase.stale };
  if (["overdue", "left", "postponed", "cancelled", "disrupted"].includes(phase.kind)) return { ...p, wait: phase.kind, raw: phase.raw };
  return p;
}
