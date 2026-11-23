// End-to-end: runs the REAL scripts/sync.mjs (--requests-only, DRY_RUN, no Firestore) against the mock BSD server with one flooding user and two
// honest users, and checks who is served, who is dropped, what stays queued and how many API calls were spent.  npm run test:requests-run
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname), PORT = 18800 + (process.pid % 500);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "betiq-req-")), out = (...p) => path.join(work, ".sync-out", ...p);
const ok = (name) => console.log("ok  " + name);

const kids = [];
const run = (script, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, script)], { cwd: work, env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d)); kids.push(p);
  p.on("close", (code) => resolve({ code, log }));
});
const calls = () => new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}/__calls`, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => res(JSON.parse(b).calls)); }).on("error", rej));
const seed = (id, uid, minAgo) => {
  fs.mkdirSync(out("requests"), { recursive: true });
  const d = { kind: "referee", league: "L1", oid: +id.split("_")[1], at: new Date(Date.now() - minAgo * 60e3).toISOString() }; if (uid) d.uid = uid;
  fs.writeFileSync(out("requests", id + ".json"), JSON.stringify(d));
};
const queued = () => (fs.existsSync(out("requests")) ? fs.readdirSync(out("requests")).map((f) => f.replace(".json", "")).sort() : []);
const officials = () => (fs.existsSync(out("officials")) ? fs.readdirSync(out("officials")).map((f) => f.replace(".json", "")).sort() : []);
const usage = () => JSON.parse(fs.readFileSync(out("system", "requestUsage.json"), "utf8"));

const mock = spawn(process.execPath, [path.join(ROOT, "scripts/dev/mock-bsd.mjs")], { env: { PATH: process.env.PATH, PORT: String(PORT) }, stdio: "ignore" }); kids.push(mock);
try {
  for (let i = 0; i < 50; i++) { try { await calls(); break; } catch { await new Promise((r) => setTimeout(r, 100)); if (i === 49) throw new Error("mock server did not start"); } }
  const base = { BSD_API_KEY: "testkey", BSD_BASE: `http://127.0.0.1:${PORT}/api/v2`, DRY_RUN: "1", REQUESTS_PER_RUN: "4", REQUESTS_PER_USER_DAY: "3", REQUESTS_TOTAL_DAY: "100" };

  // 1) nothing queued: no API calls and no usage document
  let r = await run("scripts/sync.mjs", { ...base, REQUESTS_ONLY: "1" });
  assert.equal(r.code, 0, r.log); assert.equal(await calls(), 0); assert.ok(!fs.existsSync(out("system", "requestUsage.json")));
  ok("idle: 0 API calls, nothing written");

  // 2) mallory floods with 8 requests (the oldest); alice and bob queue one each
  for (let i = 1; i <= 8; i++) seed("r_" + (100 + i), "mallory", 60 - i);
  seed("r_201", "alice", 5); seed("r_202", "bob", 4);
  r = await run("scripts/sync.mjs", { ...base, REQUESTS_ONLY: "1" });
  assert.equal(r.code, 0, r.log);
  assert.ok(officials().includes("201") && officials().includes("202"), "honest users are served although mallory queued first and queued 8");
  assert.deepEqual(officials(), ["101", "102", "201", "202"], "run limit 4: mallory 2 (one per round), alice 1, bob 1");
  assert.deepEqual(queued(), ["r_103", "r_104", "r_105", "r_106", "r_107", "r_108"], "the rest stays queued");
  assert.equal(await calls(), 4, "exactly one API call per served request");
  assert.deepEqual(usage().byUid, { mallory: 2, alice: 1, bob: 1 }); assert.equal(usage().total, 4);
  ok("flood: honest users served first, run limit respected, 4 calls for 4 requests");

  // 3) next run: mallory has 1 request left under her daily cap of 3; everything beyond is dropped (deleted, not served)
  r = await run("scripts/sync.mjs", { ...base, REQUESTS_ONLY: "1" });
  assert.equal(r.code, 0, r.log);
  assert.deepEqual(officials(), ["101", "102", "103", "201", "202"]); assert.deepEqual(queued(), []);
  assert.equal(await calls(), 5); assert.equal(usage().byUid.mallory, 3); assert.equal(usage().total, 5);
  assert.match(r.log, /dropped 5/);
  ok("daily cap: 1 more served, 5 dropped, queue empty, 1 more API call");

  // 4) requests from an older app version (no uid) are still served, under the shared legacy bucket
  seed("r_301", null, 3);
  r = await run("scripts/sync.mjs", { ...base, REQUESTS_ONLY: "1" });
  assert.equal(r.code, 0, r.log); assert.ok(officials().includes("301")); assert.equal(usage().byUid.legacy, 1);
  ok("legacy requests without a uid are served under one shared bucket");
  console.log("\nALL REQUEST QUEUE END-TO-END TESTS PASSED");
} finally { for (const k of kids) k.kill(); fs.rmSync(work, { recursive: true, force: true }); }
