// End-to-end check of scripts/live.mjs against a scripted mock of the BSD endpoints (DRY_RUN: no Firestore). The mock follows the documented
// behaviour only; it proves the runner's logic, not the real API's response shape (use `npm run probe:live` for that).  npm run test:live-run
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
// Fixture times are relative to "now" (the runner keeps change records for 8 days, so fixed dates would make this test expire).
const BASE = Math.floor(Date.now() / 60e3) * 60e3, at = (min) => new Date(BASE + min * 60e3).toISOString().replace(".000Z", "Z");
const T = { c1: at(-60), c2: at(-30), u1: at(0), u2: at(5), oldK: at(585), newK: at(705) };   // oldK/newK: kick-off moved from +9h45 to +11h45
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function mock() {
  const log = [], st = { live: 0, changes: 0, cov: { live_now: 2, next_event_at: null } };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), auth = req.headers.authorization ?? null;
    log.push({ p: u.pathname, q: Object.fromEntries(u.searchParams), auth });
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json", ratelimit: `"football";r=${5000 - log.length};t=1000` }); res.end(JSON.stringify(body)); };
    if (u.pathname === "/api/v2/coverage/") return send(200, { sports: [{ sport: "football", status: "in_season", ...st.cov }] });
    if (auth !== "Token k") return send(401, { detail: "no token" });
    if (u.pathname === "/api/v2/events/live/") {
      if ([...u.searchParams].length) return send(400, { detail: "unknown parameter" });
      const n = ++st.live, A = { id: 1, home_team: "Colombia", away_team: "Chile", home_team_id: 1, away_team_id: 2, league_id: 31, home_score: 1, away_score: 0, current_minute: 67, extra_time_score: null, penalty_shootout: null, live_websocket: true, websocket_plus: true, period: 2 };
      const B = { id: 2, home_team: "Peru", away_team: "Bolivia", home_team_id: 3, away_team_id: 4, league_id: 31, home_score: 0, away_score: 0, current_minute: "45+2" };
      if (n === 1) return send(200, { count: 3, results: [A, B, { home_team: "no id" }] });
      return send(200, { count: 1, results: [B] });                                   // match 1 leaves the feed
    }
    if (u.pathname === "/api/v2/events/1/") return send(200, { id: 1, status: "finished", home_score: 2, away_score: 1 });
    if (u.pathname === "/api/v2/events/50/") return send(200, { id: 50, status: "finished", home_score: 1, away_score: 0 });
    if (u.pathname === "/api/v2/events/51/") return send(200, { id: 51, status: "postponed", home_score: null, away_score: null });
    if (u.pathname === "/api/v2/events/52/") return send(200, { id: 52, status: "inprogress", home_score: 1, away_score: 1 });
    if (u.pathname === "/api/v2/fixtures/changes/") {
      const n = ++st.changes;
      return send(200, n === 1 ? { since: "s0", until: `${T.u1}`, count: 2, truncated: false, changes: [
        { change: "kickoff", changed_at: `${T.c1}`, event_id: 9, new_value: `${T.newK.replace("Z","+00:00")}`, old_value: `${T.oldK.replace("Z","+00:00")}` },
        { change: "status", changed_at: `${T.c2}`, event_id: 8, new_value: "postponed", old_value: "notstarted" }] }
        : { since: u.searchParams.get("since"), until: `${T.u2}`, count: 0, truncated: false, changes: [] });
    }
    return send(404, { detail: "not found" });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, log, st, port: srv.address().port })));
}
const run = (port, extra, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, "scripts/live.mjs")], { cwd, env: { ...process.env, BSD_API_KEY: "k", BSD_BASE: `http://127.0.0.1:${port}/api/v2`, DRY_RUN: "1", LIVE_POLL_SECONDS: "1", CHANGES_EVERY_MINUTES: "0", ...extra } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => resolve({ code, out }));
});

const { srv, log, st, port } = await mock(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
try {
  // a stored schedule for today with matches that should be over: 50 finished, 51 postponed, 52 still "in progress" per the API, 53 only kicked off 30 min ago (must NOT be looked up)
  const day = new Date().toISOString().slice(0, 10), ago = (m) => Math.floor(Date.now() / 1000) - m * 60;
  fs.mkdirSync(path.join(cwd, ".sync-out/schedule"), { recursive: true });
  fs.writeFileSync(path.join(cwd, `.sync-out/schedule/${day}.json`), JSON.stringify({ day, list: [{ id: 50, c: "L31", h: 5, a: 6, t: ago(150), s: "notstarted" }, { id: 51, c: "L31", h: 7, a: 8, t: ago(150), s: "notstarted" }, { id: 52, c: "L31", h: 9, a: 10, t: ago(150), s: "notstarted" }, { id: 53, c: "L31", h: 11, a: 12, t: ago(30), s: "notstarted" }] }));
  const a = await run(port, { LIVE_RUN_MINUTES: "0.1" }, cwd);
  assert.equal(a.code, 0, a.out);
  const d = JSON.parse(fs.readFileSync(path.join(cwd, ".sync-out/live/main.json"), "utf8"));
  assert.deepEqual(Object.keys(d.events), ["2"], "only the match still in the feed is live");
  assert.deepEqual([d.events[2].min, d.events[2].hg, d.events[2].ag], ["45+2", 0, 0], "minute kept as sent; 0-0 stays 0-0");
  assert.match(a.out, /1 live record\(s\) had no readable id/, "the record without an id is reported loudly, not hidden"); assert.equal(d.bad, 0, "and the count describes the latest poll");
  assert.deepEqual([d.left[1].s, d.left[1].hg, d.left[1].ag, d.left[1].hn, d.left[1].pending], ["finished", 2, 1, "Colombia", false], "dropped match was looked up, not assumed finished");
  assert.deepEqual([d.mode, d.pollS, d.halt], ["live", 1, null]); assert.ok(Date.now() - Date.parse(d.updated) < 15e3);
  assert.equal(d.changes[9].kickoff.t, Math.floor(Date.parse(`${T.newK}`) / 1000)); assert.equal(d.changes[8].status.s, "postponed");
  assert.equal(d.changesUntil, `${T.u2}`, "cursor advanced to `until`");
  const ch = log.filter((x) => x.p.endsWith("/fixtures/changes/"));
  assert.equal(ch[0].q.since, undefined); assert.equal(ch[1].q.since, `${T.u1}`, "second request starts exactly where the first ended"); assert.equal(ch[0].q.change, "kickoff,status");
  for (const x of log.filter((x) => x.p.endsWith("/events/live/"))) assert.deepEqual(x.q, {}, "no query parameters on /events/live/ (unknown ones are rejected)");
  for (const x of log.filter((x) => x.p.endsWith("/coverage/"))) assert.equal(x.auth, null, "coverage is called without the token");
  assert.equal(log.filter((x) => x.p.endsWith("/events/1/")).length, 1, "one lookup for the one dropped match");
  const fin = JSON.parse(fs.readFileSync(path.join(cwd, ".sync-out/live/finals.json"), "utf8")).m;
  assert.deepEqual([fin[1].hg, fin[1].ag, fin[1].hn, fin[1].lg], [2, 1, "Colombia", 31], "a match that left the feed and was confirmed finished is kept in live/finals");
  assert.deepEqual([fin[50].hg, fin[50].ag, fin[50].h, fin[50].lg], [1, 0, 5, 31], "sweep: an overdue match the feed never reported is looked up and stored as final");
  assert.equal(d.changes[51].status.s, "postponed", "sweep: a postponed match is recorded as postponed"); assert.equal(fin[51], undefined); assert.equal(fin[52], undefined, "still in progress per the API: not final");
  assert.equal(fin[53], undefined); assert.equal(log.filter((x) => x.p.endsWith("/events/53/")).length, 0, "a match that kicked off 30 min ago is not looked up");
  assert.equal(log.filter((x) => x.p.endsWith("/events/50/")).length, 1, "each swept match is looked up once, not on every tick (10 min back-off)");
  console.log("ok  runner: finals persisted, sweep finds finished / postponed matches, leaves live and recent ones alone");
  console.log("ok  runner: poll, drop -> lookup, bad record counted, change cursor gapless, no token on coverage, no params on live");

  const b = await run(port, { LIVE_RUN_MINUTES: "1", LIVE_RESERVE: "9999" }, cwd);
  assert.equal(b.code, 0, b.out); assert.match(b.out, /stopping: only \d+ calls left today/);
  const e = JSON.parse(fs.readFileSync(path.join(cwd, ".sync-out/live/main.json"), "utf8"));
  assert.equal(e.halt, "quota"); assert.ok(Object.keys(e.events).length >= 0);
  console.log("ok  runner: stops at the quota reserve and says so in the document");
  // scheduled-CI mode: nothing live and nothing due -> exit at once, but say when the next run is expected
  const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), "live2-")), calls = log.length; st.cov = { live_now: 0, next_event_at: new Date(Date.now() + 5 * 36e5).toISOString() };
  const t1 = Date.now(), c = await run(port, { LIVE_RUN_MINUTES: "1", LIVE_EXIT_IDLE: "1", LIVE_REVISIT_MINUTES: "25" }, cwd2);
  assert.equal(c.code, 0, c.out); assert.ok(Date.now() - t1 < 8000, "exits straight away when idle"); assert.match(c.out, /idle: nothing live or due/);
  const f = JSON.parse(fs.readFileSync(path.join(cwd2, ".sync-out/live/main.json"), "utf8"));
  assert.deepEqual([f.mode, f.revisitS], ["idle", 1500]); assert.equal(log.slice(calls).filter((x) => x.p.endsWith("/events/live/")).length, 0, "no quota spent on /events/live/ while idle");
  // ...but it stays running when a kick-off falls before the next scheduled run
  st.cov = { live_now: 0, next_event_at: new Date(Date.now() + 10 * 60e3).toISOString() };
  const t2 = Date.now(), d2 = await run(port, { LIVE_RUN_MINUTES: "0.05", LIVE_EXIT_IDLE: "1", LIVE_REVISIT_MINUTES: "25" }, cwd2);
  assert.ok(Date.now() - t2 >= 2500, "keeps running while a kick-off is due before the next run"); assert.doesNotMatch(d2.out, /exiting/);
  fs.rmSync(cwd2, { recursive: true, force: true });
  console.log("ok  runner: idle exit for scheduled runs (no live calls, states when it will be back), stays up when a kick-off is near");
  console.log("\nLIVE RUNNER E2E PASSED");
} finally { srv.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
