// BetIQ daemon: ONE long-running process that keeps everything fresh by itself. Start it once (see README: pm2 / systemd / Docker) and leave it.
//   1. live runner   scripts/live.mjs, always on (LIVE_FOREVER=1: waits out the daily quota instead of exiting). Restarted with back-off if it ever crashes.
//   2. queued requests  `sync --requests-only` every REQUESTS_EVERY_SECONDS (120). 0 API calls when nothing is queued.
//   3. full data sync + schedule rebuild every SYNC_EVERY_HOURS (6): `sync`, then `schedule` (no API calls) so the Live page has the new fixtures/results.
// Jobs never overlap. Reads .env from the project folder when it exists, otherwise uses the environment (BSD_API_KEY, FIREBASE_SERVICE_ACCOUNT or serviceAccountKey.json).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); process.chdir(ROOT);
const env = process.env, int = (k, d) => (Number.isFinite(+env[k]) && env[k] !== undefined && env[k] !== "" ? +env[k] : d);
const SYNC_MS = int("SYNC_EVERY_HOURS", 6) * 36e5, REQ_MS = Math.max(1, int("REQUESTS_EVERY_SECONDS", 120)) * 1000, FIRST_MS = int("FIRST_SYNC_DELAY_SECONDS", 15) * 1000;
const NODE_ARGS = fs.existsSync(".env") ? ["--env-file=.env"] : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), "[daemon]", ...a);
let stopping = false; const kids = new Set();

function run(script, args = [], extra = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [...NODE_ARGS, path.join("scripts", script), ...args], { cwd: ROOT, env: { ...env, ...extra }, stdio: "inherit" });
    kids.add(p);
    p.on("error", (e) => { kids.delete(p); log(`${script} could not start: ${e.message}`); resolve(1); });
    p.on("close", (code) => { kids.delete(p); resolve(code ?? 1); });
  });
}
async function liveLoop() {
  let wait = 5000;
  while (!stopping) {
    const t0 = Date.now(), code = await run("live.mjs", [], { LIVE_FOREVER: "1" });
    if (stopping) return;
    if (Date.now() - t0 > 120e3) wait = 5000;                                   // it ran for a while: restart quickly
    log(`live runner exited (code ${code}); restarting in ${Math.round(wait / 1000)} s`);
    await sleep(wait); wait = Math.min(wait * 2, 300e3);                        // failing fast: 5 s, 10 s, 20 s ... up to 5 min
  }
}
async function jobsLoop() {
  await sleep(FIRST_MS);
  let lastFull = 0;
  while (!stopping) {
    if (Date.now() - lastFull >= SYNC_MS) {
      lastFull = Date.now();                                                    // set first: a failing run is retried at the next interval, not in a tight loop
      log("full data sync"); const a = await run("sync.mjs"); log(`sync finished (code ${a})`);
      if (stopping) return;
      log("rebuilding the schedule"); const b = await run("schedule.mjs"); log(`schedule finished (code ${b})`);
    } else { const c = await run("sync.mjs", ["--requests-only"]); if (c !== 0) log(`requests job exited with code ${c}`); }
    await sleep(REQ_MS);
  }
}
const stop = (sig) => { if (stopping) return; stopping = true; log(`${sig}: stopping`); for (const k of kids) k.kill("SIGTERM"); setTimeout(() => process.exit(0), 3000).unref(); };
process.on("SIGINT", () => stop("SIGINT")); process.on("SIGTERM", () => stop("SIGTERM"));
log(`started in ${ROOT}: live runner always on, requests every ${REQ_MS / 1000} s, full sync + schedule every ${SYNC_MS / 36e5} h${NODE_ARGS.length ? ", using .env" : ""}`);
await Promise.all([liveLoop(), jobsLoop()]);
process.exit(0);
