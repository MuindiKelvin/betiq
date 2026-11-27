// Route helpers (src/lib/route.js): which navigation states are one history entry, what "back" means, and how the entries are tracked.
import assert from "node:assert/strict";
import { HOME, Trail, parentOf, routeKey } from "../../src/lib/route.js";

const r = (o = {}) => ({ ...HOME, ...o });

// routeKey: every page-level field counts, compTab does not
assert.equal(routeKey(r()), routeKey(r()));
assert.equal(routeKey(r({ compTab: "table" })), routeKey(r({ compTab: "matches" })), "competition tab is not a page");
assert.notEqual(routeKey(r({ tab: "live" })), routeKey(r()));
assert.notEqual(routeKey(r({ mode: "analyze" })), routeKey(r()));
assert.notEqual(routeKey(r({ comp: "PL" })), routeKey(r({ comp: "LL" })));
assert.notEqual(routeKey(r({ team: { id: 1, code: "PL" } })), routeKey(r({ team: { id: 2, code: "PL" } })));
assert.notEqual(routeKey(r({ team: { id: 1, code: "PL" } })), routeKey(r({ team: { id: 1, code: "LL" } })));
assert.notEqual(routeKey(r({ player: { id: 5 } })), routeKey(r()));
assert.notEqual(routeKey(r({ ent: { kind: "referee", id: 3 } })), routeKey(r({ ent: { kind: "manager", id: 3 } })));
assert.notEqual(routeKey(r({ view: { id: 9 } })), routeKey(r({ view: { id: 10 } })));
assert.notEqual(routeKey(r({ pre: { h: 1, a: 2, league: "PL" } })), routeKey(r({ pre: { h: 2, a: 1, league: "PL" } })));
assert.equal(routeKey(r({ view: { id: 0 } })).split("|")[6], "0", "match id 0 is still a match");
assert.equal(routeKey(r({ player: { id: 0 } })).split("|")[4], "0", "player id 0 is still a player");

// parentOf: same order as the stacked pages; nothing to go back to at the top
const full = r({ comp: "PL", team: { id: 1, code: "PL" }, player: { id: 5 }, ent: { kind: "venue", id: 7 }, view: { id: 9 } });
const p1 = parentOf(full); assert.equal(p1.view, null); assert.deepEqual(p1.ent, full.ent);
const p2 = parentOf(p1); assert.equal(p2.ent, null); assert.deepEqual(p2.player, full.player);
const p3 = parentOf(p2); assert.equal(p3.player, null); assert.deepEqual(p3.team, full.team);
const p4 = parentOf(p3); assert.equal(p4.team, null); assert.equal(p4.comp, "PL");
const p5 = parentOf(p4); assert.equal(p5.comp, null);
assert.equal(parentOf(p5), null, "Explore start: nothing to go back to");
assert.equal(parentOf(r({ tab: "live" })), null);
assert.equal(parentOf(r({ tab: "live", comp: "PL" })), null, "a leftover competition does not count outside Explore");
assert.equal(parentOf(r({ mode: "analyze", comp: "PL" })), null, "Analyze is not a stacked page");
assert.equal(parentOf(full).comp, "PL", "parentOf does not touch the route it is given"); assert.ok(full.view);

// Trail: entries, back / forward, replace
const t = new Trail();
const home = r(), comp = r({ comp: "PL" }), match = r({ comp: "PL", view: { id: 9 } });
assert.equal(t.start(home), 0); assert.equal(t.at, 0); assert.equal(t.prev(), null); assert.equal(t.backIs(home), false);
assert.equal(t.push(comp), 1); assert.equal(t.push(match), 2);
assert.equal(t.backIs(parentOf(match)), true, "back from the match leads to the competition");
assert.equal(t.backIs(parentOf(comp)), false, "the match's parent is not the home page");
assert.equal(t.backIs(null), false);
assert.equal(t.go(1), comp); assert.equal(t.at, 1);
assert.equal(t.backIs(parentOf(comp)), true, "back from the competition leads home");
assert.equal(t.go(2), match, "forward button");

// replace: the competition tab changes the stored route of the current entry only
t.go(1); t.update(r({ comp: "PL", compTab: "table" }));
assert.equal(t.go(1).compTab, "table"); assert.equal(t.go(0).compTab, "overview");

// a new page after going back: the entry that was current is the one before it
t.go(0); const id = t.push(r({ tab: "live" }));
assert.equal(id, 3, "ids never repeat"); assert.equal(t.prev(), home);
assert.equal(t.backIs(home), true);

// an entry we did not make (an earlier page load): no route, and nothing before it that we know of
assert.equal(t.go(99), null); assert.equal(t.at, null); assert.equal(t.prev(), null); assert.equal(t.backIs(home), false);
t.update(home);                                                                        // must not throw or write anywhere
t.key = routeKey(home); const id2 = t.push(r({ tab: "daily" }));
assert.equal(t.prev(), null, "pushed from an unknown entry: back is not ours to decide");
assert.equal(id2, 4);

console.log("route: ok");
