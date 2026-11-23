// npm run test:requests  - the queue planner is fair, capped per user and per day, and never mutates its inputs.
import assert from "node:assert/strict";
import { LEGACY, atMs, planRequests, utcDay } from "../lib/requests.mjs";

const ok = (name, fn) => { fn(); console.log("ok  " + name); };
const NOW = Date.parse("2026-11-22T12:00:00Z"), MIN = 60e3;
const req = (id, uid, minAgo = 1) => ({ id, data: { uid, kind: "player", at: NOW - minAgo * MIN } });
const plan = (reqs, usage = null, opt = {}) => planRequests(reqs, usage, { now: NOW, ...opt });

ok("atMs reads Firestore Timestamps, Dates, ISO strings, numbers; unknown is 0", () => {
  assert.equal(atMs({ toMillis: () => 5000 }), 5000);
  assert.equal(atMs({ seconds: 2, nanoseconds: 500e6 }), 2500);
  assert.equal(atMs({ _seconds: 3, _nanoseconds: 0 }), 3000);
  assert.equal(atMs(new Date(7000)), 7000);
  assert.equal(atMs("2026-11-22T12:00:00Z"), NOW);
  assert.equal(atMs(1234), 1234);
  for (const bad of [null, undefined, "nope", {}, NaN, new Date("x")]) assert.equal(atMs(bad), 0);
});
ok("serves oldest first and no more than perRun; the rest is deferred, not lost", () => {
  const r = plan([req("c", "u", 1), req("a", "u", 30), req("b", "u", 10)], null, { perRun: 2 });
  assert.deepEqual(r.serve, ["a", "b"]); assert.deepEqual(r.defer, ["c"]); assert.deepEqual(r.drop, []);
});
ok("fair: a user who floods the queue cannot starve another user", () => {
  const flood = Array.from({ length: 50 }, (_, i) => req("f" + String(i).padStart(2, "0"), "mallory", 100 - i)), honest = [req("h1", "alice", 5), req("h2", "bob", 4)];
  const r = plan([...flood, ...honest], null, { perRun: 10 });
  assert.ok(r.serve.includes("h1") && r.serve.includes("h2"), "honest users are served in the first round");
  assert.equal(r.serve.length, 10);
});
ok("per-user daily cap drops the excess; other users are unaffected", () => {
  const r = plan([req("a1", "a", 5), req("a2", "a", 4), req("a3", "a", 3), req("b1", "b", 2)], null, { perUserDay: 2 });
  assert.deepEqual(r.serve.sort(), ["a1", "a2", "b1"]); assert.deepEqual(r.drop, ["a3"]);
  assert.equal(r.usage.byUid.a, 2); assert.equal(r.usage.byUid.b, 1); assert.equal(r.usage.total, 3);
});
ok("the cap counts across runs on the same UTC day", () => {
  const first = plan([req("a1", "a"), req("a2", "a")], null, { perUserDay: 3 });
  const second = plan([req("a3", "a"), req("a4", "a")], first.usage, { perUserDay: 3 });
  assert.deepEqual(second.serve, ["a3"]); assert.deepEqual(second.drop, ["a4"]); assert.equal(second.usage.byUid.a, 3);
});
ok("a new UTC day resets the usage", () => {
  const yesterday = { day: utcDay(NOW - 86400e3), byUid: { a: 999 }, total: 999 };
  const r = plan([req("a1", "a")], yesterday, { perUserDay: 2, totalDay: 5 });
  assert.deepEqual(r.serve, ["a1"]); assert.equal(r.usage.day, utcDay(NOW)); assert.equal(r.usage.total, 1);
});
ok("global daily cap defers (keeps queued) instead of dropping", () => {
  const r = plan([req("a", "u1"), req("b", "u2"), req("c", "u3")], null, { totalDay: 2 });
  assert.equal(r.serve.length, 2); assert.equal(r.defer.length, 1); assert.deepEqual(r.drop, []);
});
ok("requests older than maxAge are dropped; unknown age is kept", () => {
  const r = plan([req("old", "u", 60 * 49), { id: "noat", data: { uid: "u", kind: "player" } }]);
  assert.deepEqual(r.drop, ["old"]); assert.deepEqual(r.serve, ["noat"]);
});
ok("requests without a uid share one legacy bucket with the same caps", () => {
  const r = plan([{ id: "x1", data: { at: NOW - MIN } }, { id: "x2", data: { uid: "", at: NOW - MIN } }, { id: "x3", data: { uid: 7, at: NOW - MIN } }], null, { perUserDay: 2 });
  assert.equal(r.serve.length, 2); assert.equal(r.drop.length, 1); assert.equal(r.usage.byUid[LEGACY], 2);
});
ok("a uid called __proto__ is just a name", () => {
  const r = plan([req("p", "__proto__")]); assert.deepEqual(r.serve, ["p"]); assert.equal(Object.keys(r.usage.byUid)[0], "__proto__");
  assert.equal({}.polluted, undefined);
});
ok("does not mutate its inputs; empty input is fine", () => {
  const reqs = [req("a", "u", 2), req("b", "u", 1)], usage = { day: utcDay(NOW), byUid: { u: 1 }, total: 1 };
  const before = JSON.stringify([reqs, usage]); plan(reqs, usage); assert.equal(JSON.stringify([reqs, usage]), before);
  assert.deepEqual(plan([], null), { serve: [], drop: [], defer: [], usage: { day: utcDay(NOW), byUid: {}, total: 0 } });
});
console.log("\nALL REQUEST-PLANNER TESTS PASSED");
