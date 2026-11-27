// Route helpers, pure (no DOM, no React): unit-tested in scripts/dev/test-route.mjs.
// A "route" is the navigation state of App.jsx: { tab, mode, comp, compTab, team, player, ent, view, pre }.
// The browser history (phone back / forward buttons, swipe gestures, Alt+Left) is mirrored onto it, one history entry per page.

// where the app starts, and where an entry from an earlier page load (which cannot be restored) falls back to
export const HOME = { tab: "explore", mode: "browse", comp: null, compTab: "overview", team: null, player: null, ent: null, view: null, pre: null };

// What makes two routes "the same page". compTab is left out on purpose: switching tabs inside a competition replaces the entry instead of adding one,
// so the back button leaves the competition rather than stepping through its tabs.
export const routeKey = (s) => [
  s.tab, s.mode, s.comp ?? "",
  s.team ? `${s.team.id}-${s.team.code}` : "",
  s.player?.id ?? "",
  s.ent ? `${s.ent.kind}-${s.ent.id}` : "",
  s.view?.id ?? "",
  s.pre ? `${s.pre.h}-${s.pre.a}-${s.pre.league}` : "",
].join("|");

// One step back, in the order the pages are stacked: match > manager/referee/venue > player > team > competition. null = nothing to go back to.
export function parentOf(s) {
  if (s.view) return { ...s, view: null };
  if (s.ent) return { ...s, ent: null };
  if (s.player) return { ...s, player: null };
  if (s.team) return { ...s, team: null };
  if (s.tab === "explore" && s.mode === "browse" && s.comp) return { ...s, comp: null };
  return null;
}

// The entries this page load has made, by id. `at` is the entry the browser is on (null = an entry this page load did not make).
// `prev` is the entry that was current when an entry was pushed, which is the entry right before it in the browser's history.
export class Trail {
  constructor() { this.n = 0; this.items = new Map(); this.at = null; this.key = null; }
  start(route) { const id = this.n++; this.items.set(id, { route, prev: null }); this.at = id; this.key = routeKey(route); return id; }
  push(route) { const id = this.n++; this.items.set(id, { route, prev: this.at }); this.at = id; this.key = routeKey(route); return id; }
  update(route) { const it = this.items.get(this.at); if (it) it.route = route; }          // same page, other competition tab
  go(id) {                                                                                  // the browser moved to entry `id`; returns its route (null: not one of ours)
    const it = this.items.get(id);
    this.at = it ? id : null;
    return it ? it.route : null;
  }
  prev() { const it = this.items.get(this.at), p = it && it.prev != null ? this.items.get(it.prev) : null; return p ? p.route : null; }
  // Does the browser's back button lead exactly to `route`? Then going back through the history is the same as going back in the app.
  backIs(route) { const p = this.prev(); return !!p && !!route && routeKey(p) === routeKey(route); }
}
