import { settle } from "./util.js";

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
