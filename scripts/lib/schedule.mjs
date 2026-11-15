// Pure helpers for scripts/schedule.mjs: turn the stored fixtures/results of every competition into one compact document per UTC day (schedule/<YYYY-MM-DD>).
// Row: { id, c: "L3" (competition code), h, a (team ids), t (kick-off, unix s), s: notstarted|inprogress|postponed|cancelled|finished, hg?, ag? }. Team names come from the app's team index.
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const norm = (s) => (s === "canceled" ? "cancelled" : s ?? "notstarted");

export function rowsOf(code, fixtures, results) {
  const out = new Map();
  for (const f of fixtures ?? []) if (f?.id != null && f.t != null && f.h != null && f.a != null) out.set(f.id, { id: f.id, c: code, h: f.h, a: f.a, t: f.t, s: norm(f.s) });
  for (const r of results ?? []) if (r?.id != null && r.t != null && r.h != null && r.a != null && r.hg != null && r.ag != null) out.set(r.id, { id: r.id, c: code, h: r.h, a: r.a, t: r.t, s: "finished", hg: r.hg, ag: r.ag });   // a result always wins over an older fixture row
  return [...out.values()];
}

// rows -> Map(day -> rows) for every day from `back` days before to `ahead` days after nowMs (all days present, possibly empty), each day sorted by kick-off.
export function byDay(rows, nowMs, back, ahead, cap = 5000) {
  const days = new Map();
  for (let i = -back; i <= ahead; i++) days.set(utcDay(nowMs + i * 864e5), []);
  for (const r of rows) days.get(utcDay(r.t * 1000))?.push(r);
  for (const [d, list] of days) days.set(d, list.sort((x, y) => x.t - y.t || x.id - y.id).slice(0, cap));
  return days;
}
