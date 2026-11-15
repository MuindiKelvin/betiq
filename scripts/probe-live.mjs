// Prints the REAL shape of the live endpoints so nothing is assumed. Spends 2-3 of your daily calls.   npm run probe:live
import * as L from "./lib/live.mjs";
import * as B from "./lib/bsd.mjs";
const KEY = process.env.BSD_API_KEY, BASE = (process.env.BSD_BASE || "https://sports.bzzoiro.com/api/v2").replace(/\/$/, "");
if (!KEY) { console.error("BSD_API_KEY missing in .env"); process.exit(1); }
const get = async (p, params = {}, auth = true) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); const r = await fetch(u, { headers: auth ? { Authorization: `Token ${KEY}` } : {} }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, json, text, rl: r.headers.get("ratelimit") }; };
const keys = (o) => Object.keys(o ?? {}).join(", ");

console.log("1) GET /coverage/ (no token)");
const cov = await get("/coverage/", {}, false), fb = cov.json?.sports?.find((s) => s.sport === "football");
console.log(cov.status === 200 && fb ? `  PASS football: ${JSON.stringify(fb)}` : `  FAIL HTTP ${cov.status} ${cov.text.slice(0, 160)}`);

console.log("2) GET /events/live/");
const lv = await get("/events/live/");
if (lv.status !== 200) { console.log(`  FAIL HTTP ${lv.status} ${lv.text.slice(0, 200)}`); process.exit(1); }
const list = B.firstArray(lv.json, ["results"]);
console.log(`  top-level keys: ${keys(lv.json)} | paginated: ${!Array.isArray(lv.json) && "next" in (lv.json ?? {})} | records: ${list.length} | RateLimit: ${lv.rl}`);
if (!list.length) console.log("  (nothing is live right now: run this again while a match is in play to see the record shape)");
else {
  const e = list[0], row = L.liveRow(e);
  console.log("  first record, exactly as sent:\n" + JSON.stringify(e, null, 2).split("\n").map((x) => "    " + x).join("\n"));
  for (const k of ["id", "home_score", "away_score", "current_minute", "extra_time_score", "penalty_shootout", "live_websocket", "websocket_plus"]) console.log(`  ${k in e ? "present " : "ABSENT  "} ${k}`);
  console.log("  home/away team:", e.home_team !== undefined || e.home_team_id !== undefined ? "present" : "ABSENT", "| league:", e.league_id !== undefined || e.league !== undefined ? "present" : "ABSENT", "| event_date:", "event_date" in e ? "present" : "ABSENT");
  console.log("  parsed by liveRow:", JSON.stringify(row));
  console.log("  bad records (no id):", list.filter((x) => !L.liveRow(x)).length);
  const d = await get(`/events/${row.id}/`);
  console.log(`3) GET /events/${row.id}/ -> HTTP ${d.status}; status = ${JSON.stringify(d.json?.status)}; home_score = ${JSON.stringify(d.json?.home_score)}; keys: ${keys(d.json)}`);
}
console.log("4) GET /fixtures/changes/");
const ch = await get("/fixtures/changes/", { change: "kickoff,status", limit: 3 });
console.log(ch.status === 200 ? `  PASS keys: ${keys(ch.json)} | count: ${ch.json?.count} | first: ${JSON.stringify(ch.json?.changes?.[0])}` : `  FAIL HTTP ${ch.status} ${ch.text.slice(0, 200)}`);
