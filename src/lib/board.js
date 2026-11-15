// The Live page's match board, FotMob style: pick a day, matches are grouped by competition (top competitions first), each group sorted by kick-off.
// Pure functions (no Firebase, no DOM): unit-tested. `tz` is an IANA zone for tests; in the app it is undefined = the viewer's own zone.
import { phaseOf } from "./phase.js";

// Most used competitions, in this order, before all others (same list the data sync refreshes first: scripts/sync.mjs TOP).
export const TOP = [1, 3, 4, 5, 6, 7, 8, 83, 64, 10, 2, 12, 18, 17];

export const dayKey = (tSec, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(tSec * 1000));
export const shiftDay = (key, n) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// A local day D only contains instants of UTC days D-1, D and D+1 (zones run from UTC-12 to UTC+14), so those are the schedule documents to read.
export const utcDaysFor = (key) => [shiftDay(key, -1), key, shiftDay(key, 1)];
// Label for a day chip / heading, relative to `today` (a day key)
export function dayName(key, today, opts = {}) {
  if (key === today) return "Today"; if (key === shiftDay(today, -1)) return "Yesterday"; if (key === shiftDay(today, 1)) return "Tomorrow";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", ...(opts.month ? { month: "short" } : {}) });
}

const codeOfLg = (lg) => (lg != null ? "L" + lg : null);
// Every match known for the board: stored schedule rows, plus anything the live runner reports that the schedule does not have (competition not synced yet, etc.)
export function boardItems({ rows, doc, finals, nowMs, tz }) {
  const map = new Map();
  for (const r of rows ?? []) map.set(r.id, { ...r });
  const add = (id, o) => { if (!map.has(id)) map.set(id, { id, ...o }); };
  for (const r of Object.values(doc?.events ?? {})) add(r.id, { c: codeOfLg(r.lg), h: r.h, a: r.a, hn: r.hn, an: r.an, ln: r.ln, t: r.ko ?? null, s: "inprogress" });
  for (const [id, l] of Object.entries(doc?.left ?? {})) add(+id, { c: codeOfLg(l.lg), h: l.h, a: l.a, hn: l.hn, an: l.an, ln: l.ln, t: l.ko ?? null, s: "inprogress" });
  for (const f of Object.values(finals ?? {})) add(f.id, { c: codeOfLg(f.lg), h: f.h, a: f.a, hn: f.hn, an: f.an, ln: f.ln, t: f.ko ?? null, s: "finished", hg: f.hg, ag: f.ag });
  const out = [];
  for (const r of map.values()) {
    const p = phaseOf({ id: r.id, t: r.t ?? undefined, s: r.s, hg: r.hg, ag: r.ag }, doc, nowMs, finals), t = p.t ?? (p.kind === "live" ? Math.floor(nowMs / 1000) : null);
    if (t === null) continue;                                         // no kick-off time anywhere: cannot be placed on a day
    out.push({ r, p, t, day: dayKey(t, tz) });
  }
  return out;
}

export const FILTERS = {
  all: () => true,
  live: (p) => p.kind === "live",
  finished: (p) => p.kind === "finished",
  upcoming: (p) => p.kind === "upcoming" || p.kind === "overdue",        // not started (or kick-off passed and not confirmed yet)
};

const rankOf = (id, country) => { const i = TOP.indexOf(id); return i >= 0 ? [0, i] : country ? [2, 0] : [1, 0]; };   // top competitions, then international, then by country
// filter "live": every match in play right now, whatever its date. Other filters: the matches of `day`.
export function boardView({ items, day, filter, byCode }) {
  const onDay = items.filter((x) => x.day === day);
  const counts = { all: onDay.length, live: items.filter((x) => FILTERS.live(x.p)).length, finished: onDay.filter((x) => FILTERS.finished(x.p)).length, upcoming: onDay.filter((x) => FILTERS.upcoming(x.p)).length };
  const shown = (filter === "live" ? items : onDay).filter((x) => (FILTERS[filter] ?? FILTERS.all)(x.p));
  const groups = new Map();
  for (const x of shown) {
    const code = x.r.c ?? null, key = code ?? "x:" + (x.r.ln ?? "?"), e = code ? byCode[code] : null;
    if (!groups.has(key)) groups.set(key, { key, code, id: e?.id ?? (code ? +code.slice(1) : null), name: e?.name ?? x.r.ln ?? "Other competitions", country: e?.country ?? "", rows: [] });
    groups.get(key).rows.push(x);
  }
  const list = [...groups.values()];
  for (const g of list) g.rows.sort((a, b) => a.t - b.t || a.r.id - b.r.id);
  list.sort((a, b) => { const x = rankOf(a.id, a.country), y = rankOf(b.id, b.country); return x[0] - y[0] || x[1] - y[1] || a.country.localeCompare(b.country) || a.name.localeCompare(b.name); });
  return { groups: list, counts, total: shown.length };
}
