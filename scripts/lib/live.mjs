// Pure helpers for the live runner (scripts/live.mjs). No network, no Firestore: unit-tested (npm test).
// Field names follow https://sports.bzzoiro.com/docs/football/events/ . The docs name `current_minute`, `home_score`, `away_score`,
// `extra_time_score`, `penalty_shootout`, `live_websocket` and `websocket_plus` for /events/live/. Anything else the API sends is kept
// verbatim in `x` instead of being guessed at; `npm run probe:live` prints the real shape.
import { num, statusOf, teamIdOf, teamNameOf, ts } from "./bsd.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const USED = new Set(["id", "event_id", "home_team", "away_team", "home_team_id", "away_team_id", "league_id", "league", "league_name", "home_score", "away_score",
  "current_minute", "extra_time_score", "penalty_shootout", "live_websocket", "websocket_plus", "event_date"]);

// One level of scalars (strings cut to 200 chars; NaN/Infinity dropped; nulls dropped)
function scalars(o, max) {
  const out = {}; let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (n >= max) break;
    if (typeof v === "string" && v !== "") out[k] = v.slice(0, 200);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else continue;
    n++;
  }
  return out;
}
// Everything the API sent that has no dedicated field: scalars, plus plain objects one level deep. Arrays are dropped (Firestore forbids nested arrays).
function extras(e) {
  const x = {}; let n = 0;
  for (const [k, v] of Object.entries(e)) {
    if (USED.has(k) || n >= 40) continue;
    if (isObj(v)) { const o = scalars(v, 20); if (Object.keys(o).length) { x[k] = o; n++; } }
    else { const s = scalars({ [k]: v }, 1); if (k in s) { x[k] = s[k]; n++; } }
  }
  return x;
}
// Minute exactly as reported: a number, or a short string such as "45+2" when that is what the API sends
export function minuteOf(v) {
  const n = num(v);
  if (n !== null) return n;
  return typeof v === "string" && v.trim() !== "" && v.length <= 16 ? v.trim() : null;
}
// extra_time_score / penalty_shootout: null until they apply; a number or a small object is kept as sent
export function scoreOf(v) {
  if (v === null || v === undefined || v === "") return null;
  if (isObj(v)) { const o = scalars(v, 10); return Object.keys(o).length ? o : null; }
  return num(v);
}

// A record from /events/live/ -> compact row, or null when it has no usable id.
export function liveRow(e) {
  if (!isObj(e)) return null;
  const id = num(e.id ?? e.event_id);
  if (id === null) return null;
  const lg = isObj(e.league) ? e.league : null;
  return {
    id, h: teamIdOf(e, "home"), a: teamIdOf(e, "away"), hn: teamNameOf(e, "home"), an: teamNameOf(e, "away"),
    lg: num(e.league_id ?? lg?.id), ln: lg?.name ?? e.league_name ?? null, ko: ts(e.event_date),
    hg: num(e.home_score), ag: num(e.away_score), min: minuteOf(e.current_minute), et: scoreOf(e.extra_time_score), pen: scoreOf(e.penalty_shootout),
    ws: e.live_websocket === true, wsp: e.websocket_plus === true, x: extras(e),
  };
}

// Compare this poll with the previous one: events that were live and are no longer in the feed must be looked up (their real status is unknown until then).
export function reconcile(prevEvents, rows) {
  const events = {};
  for (const r of rows) events[r.id] = r;
  return { events, dropped: Object.keys(prevEvents ?? {}).filter((id) => !(id in events)).map(Number) };
}

const identity = (r) => (r ? { h: r.h ?? null, a: r.a ?? null, hn: r.hn ?? null, an: r.an ?? null, lg: r.lg ?? null, ln: r.ln ?? null, ko: r.ko ?? null } : {});
// What we know about a match that left the live feed. `detail` is the /events/{id}/ record (null if the lookup failed).
// Status is exactly what the API says; when the lookup failed nothing is claimed (`pending`) and the last live score is marked as such (`fromLive`).
export function leftEntry(detail, prev, atIso, tries = 1) {
  const base = identity(prev);
  if (!isObj(detail)) return { ...base, s: null, raw: null, hg: prev?.hg ?? null, ag: prev?.ag ?? null, et: prev?.et ?? null, pen: prev?.pen ?? null, fromLive: true, pending: true, tries, at: atIso };
  const raw = detail.status == null ? null : String(detail.status), hg = num(detail.home_score), ag = num(detail.away_score);
  return { ...base, s: statusOf(raw) ?? null, raw, hg: hg ?? prev?.hg ?? null, ag: ag ?? prev?.ag ?? null,
    et: scoreOf(detail.extra_time_score) ?? prev?.et ?? null, pen: scoreOf(detail.penalty_shootout) ?? prev?.pen ?? null,
    fromLive: hg === null && ag === null && prev?.hg != null, pending: false, tries, at: atIso };
}
// A left entry must be looked up again when it is still unresolved (lookup failed, or the API still says the match is in play)
export const needsRecheck = (l, nowMs, everyS = 120, maxTries = 8) => !!l && (l.pending || l.s === "inprogress" || l.s === null) && l.tries < maxTries && nowMs - Date.parse(l.at) >= everyS * 1000;
export function pruneLeft(left, nowMs, hours = 6) {
  const out = {};
  for (const [id, l] of Object.entries(left ?? {})) if (nowMs - Date.parse(l.at) < hours * 36e5) out[id] = l;
  return out;
}

/* ---------- fixture change feed: kickoff moves and disrupted statuses (GET /fixtures/changes/) ---------- */
export function parseChanges(resp) {
  const list = Array.isArray(resp?.changes) ? resp.changes : [], items = [];
  let maxAt = null;
  for (const c of list) {
    const id = num(c?.event_id), at = typeof c?.changed_at === "string" ? c.changed_at : null, when = at ? Date.parse(at) : NaN;
    if (id === null || !Number.isFinite(when)) continue;
    if (maxAt === null || when > Date.parse(maxAt)) maxAt = at;
    if (c.change === "kickoff") { const t = ts(c.new_value); if (t !== null) items.push({ id, kind: "kickoff", at, t }); }
    else if (c.change === "status") { const raw = c.new_value == null ? null : String(c.new_value); items.push({ id, kind: "status", at, raw, s: statusOf(raw) ?? null }); }
  }
  return { items, maxAt, until: typeof resp?.until === "string" ? resp.until : null, truncated: resp?.truncated === true };
}
// Where the next request starts, so no change is skipped: `until`, unless the limit cut the window short (then the last changed_at received)
export const nextCursor = (p, prev) => (p.truncated ? p.maxAt ?? prev ?? null : p.until ?? prev ?? null);
export function applyChanges(map, items) {
  const out = { ...(map ?? {}) };
  for (const it of items) {
    const cur = { ...(out[it.id] ?? {}) }, old = cur[it.kind];
    if (old && Date.parse(old.at) > Date.parse(it.at)) continue;      // keep the newest change of each kind
    cur[it.kind] = it.kind === "kickoff" ? { t: it.t, at: it.at } : { s: it.s, raw: it.raw, at: it.at };
    out[it.id] = cur;
  }
  return out;
}
export function pruneChanges(map, nowMs, days = 8) {
  const out = {};
  for (const [id, c] of Object.entries(map ?? {})) {
    const keep = Object.fromEntries(Object.entries(c).filter(([, v]) => nowMs - Date.parse(v.at) < days * 864e5));
    if (Object.keys(keep).length) out[id] = keep;
  }
  return out;
}

/* ---------- when to spend API calls ---------- */
// GET /coverage/ needs no token. Poll /events/live/ only when something is live, kicks off soon, or was live on the last check.
// Anything unexpected in the coverage answer fails OPEN (poll), so a missing field can never hide a live match.
export function gate({ cov, nowMs, leadMs, hadLive }) {
  if (hadLive) return { poll: true, why: "matches were live on the last check" };
  const f = Array.isArray(cov?.sports) ? cov.sports.find((s) => s?.sport === "football") : null;
  if (!f || num(f.live_now) === null) return { poll: true, why: "coverage answer unusable, polling to be safe" };
  if (f.live_now > 0) return { poll: true, why: `${f.live_now} live now` };
  const next = typeof f.next_event_at === "string" ? Date.parse(f.next_event_at) : NaN;
  if (Number.isFinite(next) && next - nowMs <= leadMs) return { poll: true, why: "a kick-off is due" };
  return { poll: false, why: "nothing live or due", nextAt: Number.isFinite(next) ? next : null };
}

/* ---------- durable final results (live/finals) ---------- */
// A match whose API status is "finished" with a score the API itself sent. A score that is only the last live score (`fromLive`) or a pending lookup is NOT final.
export function finalEntry(id, l, nowIso) {
  if (!l || l.s !== "finished" || l.pending || l.fromLive || l.hg == null || l.ag == null) return null;
  return { id: +id, lg: l.lg ?? null, ln: l.ln ?? null, h: l.h ?? null, a: l.a ?? null, hn: l.hn ?? null, an: l.an ?? null, ko: l.ko ?? null, hg: l.hg, ag: l.ag, et: l.et ?? null, pen: l.pen ?? null, at: nowIso };
}
export function pruneFinals(m, nowMs, days = 4) {
  const out = {};
  for (const [id, f] of Object.entries(m ?? {})) if (Number.isFinite(Date.parse(f?.at)) && nowMs - Date.parse(f.at) < days * 864e5) out[id] = f;
  return out;
}

/* ---------- sweep: matches that should be over but were never reported finished ---------- */
// entries: schedule rows { id, t (unix s), s }. A match is a candidate when it kicked off between `minAfterS` and `maxAgeS` seconds ago, is not live, not already final,
// not postponed/cancelled, and was not looked up in the last `everyS` seconds. Oldest first, at most `max`.
export function sweepCandidates({ entries, doc, finals, nowMs, tried = {}, minAfterS = 110 * 60, maxAgeS = 12 * 3600, everyS = 600, max = 10 }) {
  const out = [], now = nowMs / 1000;
  for (const e of entries ?? []) {
    const id = num(e?.id), t = num(e?.t);
    if (id === null || t === null) continue;
    const since = now - t;
    if (since < minAfterS || since > maxAgeS) continue;
    if (["finished", "postponed", "cancelled", "canceled"].includes(e.s)) continue;
    if (doc?.events?.[id] || finals?.[id] || doc?.left?.[id]?.s === "finished") continue;
    const st = doc?.changes?.[id]?.status?.s; if (st === "postponed" || st === "cancelled") continue;
    if (tried[id] !== undefined && nowMs - tried[id] < everyS * 1000) continue;
    out.push({ id, t });
  }
  return out.sort((a, b) => a.t - b.t).slice(0, max).map((x) => x.id);
}
