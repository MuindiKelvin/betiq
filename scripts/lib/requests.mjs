// Decides which queued user requests (match details, player profiles, ...) the sync may serve in this run. Pure functions: no Firestore, no network.
//
// Why: any signed-in Google account can queue requests, and each one costs BSD API calls from a shared daily quota. Without limits one user could
// queue thousands of ids and use up the quota that live scores and the data sync depend on.
//   * Fair: one request per user per round, oldest first, so a flood from one user cannot fill a run and starve everyone else.
//   * Per-user daily cap (UTC day): over the cap -> DROPPED (the app shows the request button again; nothing is retried forever).
//   * Global daily cap: over it -> DEFERRED (stays queued, served after 00:00 UTC), unless it is older than maxAgeMs, then dropped.
//   * Requests without a uid (queued by an older app version) share one "legacy" bucket and the same caps.
export const LEGACY = "legacy";
export const DEFAULTS = { perRun: 60, perUserDay: 100, totalDay: 1000, maxAgeMs: 48 * 3600e3 };
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Time of a request in ms from whatever the store returns: Firestore Timestamp (toMillis / seconds), Date, ISO string or number. 0 = unknown (treated as oldest).
export function atMs(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return v.getTime() || 0;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (typeof v.toMillis === "function") { const t = v.toMillis(); return Number.isFinite(t) ? t : 0; }
  const s = v.seconds ?? v._seconds; if (typeof s === "number") return s * 1000 + Math.floor((v.nanoseconds ?? v._nanoseconds ?? 0) / 1e6);
  return 0;
}

// reqs: [{ id, data }]; usage: the stored { day, byUid, total } or null. Returns { serve: [id], drop: [id], defer: [id], usage } and never mutates its inputs.
export function planRequests(reqs, usage, { now = Date.now(), ...opt } = {}) {
  const o = { ...DEFAULTS, ...opt }, day = utcDay(now);
  const same = usage && usage.day === day, byUid = new Map(same ? Object.entries(usage.byUid ?? {}) : []), n = (uid) => byUid.get(uid) ?? 0;   // Map: no prototype-key surprises
  let total = same ? usage.total ?? 0 : 0;
  const serve = [], drop = [], defer = [], queues = new Map();

  const sorted = [...reqs].sort((a, b) => atMs(a.data?.at) - atMs(b.data?.at) || String(a.id).localeCompare(String(b.id)));
  for (const r of sorted) {
    const t = atMs(r.data?.at);
    if (t && now - t > o.maxAgeMs) { drop.push(r.id); continue; }                       // stale: bounds the queue
    const uid = typeof r.data?.uid === "string" && r.data.uid ? r.data.uid : LEGACY;
    (queues.get(uid) ?? queues.set(uid, []).get(uid)).push(r.id);
  }
  // round-robin over users in the order of their oldest request
  const order = [...queues.keys()];
  for (let round = 0; ; round++) {
    let any = false;
    for (const uid of order) {
      const id = queues.get(uid)[round]; if (id === undefined) continue;
      any = true;
      if (n(uid) >= o.perUserDay) { drop.push(id); continue; }                          // this user is over their daily cap
      if (total >= o.totalDay || serve.length >= o.perRun) { defer.push(id); continue; }
      serve.push(id); byUid.set(uid, n(uid) + 1); total++;
    }
    if (!any) break;
  }
  return { serve, drop, defer, usage: { day, byUid: Object.fromEntries(byUid), total } };
}
