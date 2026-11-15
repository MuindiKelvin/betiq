// Where a match stands right now, from evidence only. Pure functions (no Firebase, no DOM), unit-tested.
// Everything compares absolute instants (unix seconds / epoch ms), so the user's time zone never changes the answer;
// the time zone only affects how times are DISPLAYED (toLocale* in the UI).
const DISRUPTED = new Set(["postponed", "cancelled"]);
export const preMatchLock = (p) => (p && ["live", "overdue", "left"].includes(p.kind) ? "Kick-off has passed, so a pre-match pick can't be saved for this match." : null);

// Is the live runner's heartbeat recent? `mode` is "live" while it polls /events/live/, "idle" while it has checked that nothing is live.
export function feedState(doc, nowMs) {
  const upd = doc ? Date.parse(doc.updated) : NaN;
  if (!Number.isFinite(upd)) return { state: "none", ageS: null };
  const ageS = (nowMs - upd) / 1000, limit = doc.mode === "live" ? Math.max(120, 4 * (doc.pollS ?? 30)) : Math.max(600, (doc.revisitS ?? 0) + 300);
  if (doc.halt) return { state: "halted", ageS, halt: doc.halt };
  return { state: ageS <= limit ? doc.mode : "stale", ageS };
}

// fx: a synced fixture/result { id, t, s, hg, ag }. doc: the live document (or null). nowMs: Date.now().
// kind: live | left | finished | postponed | cancelled | disrupted | overdue | upcoming
// finals: the runner's durable map of finished matches (live/finals -> `m`), id -> { hg, ag, et, pen }. Final results outlive the 6-hour `left` list.
export function phaseOf(fx, doc, nowMs, finals) {
  const id = fx.id, feed = feedState(doc, nowMs), ch = doc?.changes?.[id], kick = ch?.kickoff, st = ch?.status;
  const t = kick?.t ?? fx.t ?? null, base = { t, moved: kick?.t != null && kick.t !== fx.t, feed: feed.state, ageS: feed.ageS };
  const row = doc?.events?.[id];
  if (row) return { ...base, kind: "live", row, stale: feed.state === "stale" };
  const fin = finals?.[id];                                   // the API reported it finished: stronger than any older postponement note
  if (fin && fin.hg != null && fin.ag != null) return { ...base, kind: "finished", hg: fin.hg, ag: fin.ag, et: fin.et, pen: fin.pen, src: "final" };
  if (st && (DISRUPTED.has(st.s) || st.s === null)) return { ...base, kind: st.s ?? "disrupted", raw: st.raw };
  const left = doc?.left?.[id];
  if (left) {
    if (left.s === "finished") return { ...base, kind: "finished", hg: left.hg, ag: left.ag, et: left.et, pen: left.pen, src: "live", fromLive: left.fromLive };
    if (DISRUPTED.has(left.s)) return { ...base, kind: left.s, raw: left.raw };
    return { ...base, kind: "left", left };
  }
  if (fx.hg != null || fx.s === "finished") return { ...base, kind: "finished", hg: fx.hg, ag: fx.ag, src: "sync" };
  if (fx.s === "postponed") return { ...base, kind: "postponed" };
  if (fx.s === "cancelled" || fx.s === "canceled") return { ...base, kind: "cancelled" };
  if (t === null) return { ...base, kind: "upcoming", inS: null };
  const sinceS = nowMs / 1000 - t;
  return sinceS >= 0 ? { ...base, kind: "overdue", sinceS, syncedLive: fx.s === "inprogress" } : { ...base, kind: "upcoming", inS: -sinceS };
}

export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
export const minuteLabel = (m) => (m === null || m === undefined ? null : typeof m === "number" || /^\d+(\+\d+)?$/.test(m) ? `${m}'` : String(m));
// A score object/number as sent by the API ({home, away} or a bare number)
export const scoreText = (v) => (v === null || v === undefined ? null : typeof v === "number" ? String(v) : v.home != null && v.away != null ? `${v.home}–${v.away}` : Object.entries(v).map(([k, x]) => `${k} ${x}`).join(", "));

// One plain sentence about the state. fmt(t) formats a kickoff instant for display in the viewer's time zone.
export function describe(p, fmt) {
  const feedNote = p.feed === "none" ? "The live feed is not connected." : p.feed === "stale" ? `The live feed is delayed (last update ${fmtDur(p.ageS)} ago).` : p.feed === "halted" ? "The live feed is paused." : "";
  switch (p.kind) {
    case "live": return `Updated ${fmtDur(p.ageS)} ago.${p.stale ? " The live feed is delayed, so this may be out of date." : ""}`;
    case "overdue": return [`Kick-off was ${fmtDur(p.sinceS)} ago (${fmt(p.t)}).`, p.syncedLive ? "The last data sync listed it as in play, but the live feed does not carry it." : "It has not been reported live yet, so the score is unknown.", feedNote].filter(Boolean).join(" ");
    case "left": return p.left.pending ? "It left the live feed. Its status is being confirmed." : `It left the live feed. The API now lists it as "${p.left.raw}".`;
    case "upcoming": return p.inS !== null && p.inS < 86400 ? `Kicks off in ${fmtDur(p.inS)} (${fmt(p.t)}).` : "";
    case "disrupted": return `Status reported by the API: ${p.raw}.`;
    default: return "";
  }
}
