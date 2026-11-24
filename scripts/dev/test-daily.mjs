// Tests for the market definitions (src/lib/util.js, analysis.js, value.js), daily picks (src/lib/daily.js, scripts/picks.mjs), the PDF header options and the verified badge.  npm test
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markets, predict, buildModel } from "../../src/lib/model.js";
import { selProb } from "../../src/lib/analysis.js";
import { MARKETS, isWin, settle } from "../../src/lib/util.js";
import { removeMargin } from "../../src/lib/value.js";
import { DAILY, bestPick, dailyReceipt, groupByComp, mergeDay, pickId, utcDay } from "../../src/lib/daily.js";
import { receiptPdf } from "../../src/lib/receipts.js";
import { isVerified } from "../../src/lib/verified.js";
import { EDITABLE, canEditPick, editPatch } from "../../src/lib/pickstate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

/* ---------- markets ---------- */
t("isWin settles every market from the 90-minute score", () => {
  const W = (m, s, h, a) => isWin(m, s, h, a);
  assert.ok(W("1X2", "H", 2, 1) && W("1X2", "D", 1, 1) && W("1X2", "A", 0, 3) && !W("1X2", "H", 1, 1));
  assert.ok(W("DC", "HD", 1, 1) && W("DC", "HD", 2, 0) && !W("DC", "HD", 0, 1));
  assert.ok(W("DC", "DA", 0, 0) && W("DC", "DA", 0, 2) && !W("DC", "DA", 1, 0));
  assert.ok(W("DC", "HA", 3, 0) && W("DC", "HA", 0, 1) && !W("DC", "HA", 2, 2));
  assert.ok(W("OU15", "U", 1, 0) && W("OU15", "O", 1, 1) && W("OU25", "U", 1, 1) && W("OU25", "O", 2, 1) && W("OU35", "U", 2, 1) && W("OU35", "O", 2, 2));
  assert.ok(W("BTTS", "Y", 1, 1) && W("BTTS", "N", 3, 0) && W("BTTS", "N", 0, 0));
  assert.ok(W("CSH", "Y", 2, 0) && W("CSH", "N", 2, 1) && W("CSA", "Y", 0, 2) && W("CSA", "N", 1, 2) && W("CSH", "Y", 0, 0) && W("CSA", "Y", 0, 0));
  assert.equal(W("NOPE", "H", 1, 0), false); assert.equal(W("DC", "XX", 1, 0), false);
});
t("settle: profit uses the stake and odds; old picks (no market) still mean 1X2", () => {
  assert.deepEqual(settle({ market: "DC", selection: "HD", odds: 1.5, stake: 10 }, 1, 1), { won: true, profit: 5 });
  assert.deepEqual(settle({ market: "CSA", selection: "Y", odds: 2, stake: 4 }, 1, 0), { won: false, profit: -4 });
  assert.deepEqual(settle({ predicted: "A" }, 0, 2), { won: true, profit: null });
});
t("saved market keys and selections fit firestore.rules (<= 20 characters)", () => {
  for (const [k, m] of Object.entries(MARKETS)) { assert.ok(k.length <= 20); for (const s of Object.keys(m.sel)) assert.ok(s.length <= 20); assert.ok(m.grp && m.label); }
});
const pmf = (l, k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.exp(-l) * l ** k / f; };
t("selProb: every market adds up to its total, and agrees with settling the scoreline grid", () => {
  for (const [lh, la] of [[1.6, 1.1], [0.8, 1.9], [2.4, 0.6]]) {
    const mk = markets(lh, la), p = { ...mk };
    for (const [key, m] of Object.entries(MARKETS)) {
      const sels = Object.keys(m.sel), sum = sels.reduce((s, k) => s + selProb(p, key, k), 0);
      assert.ok(near(sum, m.total ?? 1, 1e-6), `${key} adds up to ${sum}`);
      for (const k of sels) {
        let grid = 0; for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) if (isWin(key, k, i, j)) grid += pmf(lh, i) * pmf(la, j);   // independent Poisson grid, 21x21
        assert.ok(Math.abs(grid - selProb(p, key, k)) < 1e-4, `${key}/${k}: grid ${grid.toFixed(5)} vs ${selProb(p, key, k).toFixed(5)} at ${lh}-${la}`);
      }
    }
  }
  assert.equal(selProb({}, "NOPE", "H"), undefined); assert.equal(selProb(markets(1.5, 1.2), "1X2", "Z"), undefined);
});
t("removeMargin: double chance sums to 2, other markets unchanged", () => {
  const fairP = { HD: 0.8, DA: 0.5, HA: 0.7 }, odds = Object.fromEntries(Object.entries(fairP).map(([k, v]) => [k, 1 / v / 1.05]));
  const r = removeMargin(odds, ["HD", "DA", "HA"], 2);
  assert.ok(near(r.margin, 0.05, 1e-9)); assert.ok(near(Object.values(r.probs).reduce((a, b) => a + b), 2)); assert.ok(near(r.probs.HD, 0.8, 1e-9) && near(r.probs.DA, 0.5, 1e-9));
  const wrong = removeMargin(odds, ["HD", "DA", "HA"]); assert.ok(wrong.margin > 0.9, "without total=2 the margin would look like ~100%");
  const two = removeMargin({ O: 1.9, U: 1.9 }, ["O", "U"]); assert.ok(near(two.margin, 2 / 1.9 - 1) && near(two.probs.O, 0.5));
  assert.equal(removeMargin({ HD: 1.2 }, ["HD", "DA"], 2), null);
});

/* ---------- daily picks ---------- */
const P = (o = {}) => ({ home: 0.5, draw: 0.25, away: 0.25, over15: 0.75, over25: 0.5, over35: 0.25, btts: 0.5, homeCS: 0.3, awayCS: 0.3, ...o });
t("bestPick: highest probability that clears its market's minimum; headline markets only", () => {
  assert.deepEqual(bestPick(P({ home: 0.6, draw: 0.25, away: 0.15, over25: 0.7, btts: 0.4 })), { m: "OU25", s: "O", p: 0.7 });   // under 2.5 0.30, btts no 0.60 < 0.70
  assert.deepEqual(bestPick(P({ home: 0.62, over25: 0.5, btts: 0.5 })), { m: "1X2", s: "H", p: 0.62 });
  assert.equal(bestPick(P({ home: 0.45, draw: 0.3, away: 0.25, over25: 0.55, btts: 0.5 })), null);                                // nothing clears: 1X2 < 0.50, goals < 0.60
  assert.equal(bestPick(P({ home: 0.49 }))?.m ?? null, null);
  assert.equal(bestPick(P({ btts: 0.4 }))?.s, "N");                                                                              // exactly 0.60 qualifies
  assert.equal(bestPick(P({ home: 0.45, draw: 0.3, away: 0.25, over15: 0.95 })), null, "over 1.5 is not a headline market");
});
const row = (id, c, tt, p) => ({ c, id, h: id * 2, a: id * 2 + 1, hn: "H" + id, an: "A" + id, t: tt, m: "1X2", s: "H", p, x: [1.5, 1] });
t("mergeDay: frozen picks stay, the rest is recomputed best first, capped per competition", () => {
  const prev = [row(1, "L1", 900, 0.51), row(2, "L1", 2000, 0.9)];                                        // 1 has started (frozen); 2 has not (recomputed)
  const fresh = [row(3, "L1", 3000, 0.6), row(4, "L1", 3100, 0.7), row(5, "L2", 3200, 0.55), row(2, "L1", 2000, 0.52), row(6, "L1", 3300, 0.8), row(1, "L1", 5000, 0.99)];
  const out = mergeDay({ prev, fresh, nowSec: 1000, cap: 3 });
  assert.deepEqual(out.map((x) => x.id), [1, 4, 5, 6]);                                                    // L1: frozen 1 + best two (6, 4); 3 and 2 are over the cap; L2 has its own cap
  assert.deepEqual(out[0], prev[0], "a frozen pick is never changed, even by a fresh row for the same match");
  assert.deepEqual(mergeDay({ prev: undefined, fresh: [], nowSec: 1 }), []);
  assert.equal(mergeDay({ prev: [], fresh: Array.from({ length: 9 }, (_, i) => row(i + 1, "L1", 2000 + i, 0.5 + i / 100)), nowSec: 1 }).length, DAILY.cap);
  const f = [row(1, "L1", 2000, 0.6)]; mergeDay({ prev: [], fresh: f, nowSec: 1 }); assert.deepEqual(f, [row(1, "L1", 2000, 0.6)], "inputs are not mutated");
});
t("mergeDay: the cap may depend on the competition (leagues 5, cups more)", () => {
  const fresh = [...Array(12)].map((_, i) => row(i + 1, "L1", 2000 + i, 0.9 - i / 100)).concat([...Array(12)].map((_, i) => row(i + 1, "L2", 2000 + i, 0.9 - i / 100)));
  const out = mergeDay({ prev: [], fresh, nowSec: 1, cap: (c) => (c === "L2" ? DAILY.capCup : DAILY.cap) });
  assert.equal(out.filter((x) => x.c === "L1").length, DAILY.cap); assert.equal(out.filter((x) => x.c === "L2").length, DAILY.capCup);
  assert.ok(DAILY.capCup > DAILY.cap);
  assert.deepEqual(out.filter((x) => x.c === "L2").map((x) => x.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "the best ones are kept");
});
t("groupByComp: most used competitions first, then by name; picks by kick-off", () => {
  const byCode = { L1: { id: 1, name: "Premier League", country: "England" }, L9: { id: 9, name: "Zeta League", country: "X" }, L500: { id: 500, name: "Alpha Cup", country: "Y" } };
  const g = groupByComp([row(1, "L500", 5, 0.6), row(2, "L9", 5, 0.6), row(3, "L1", 9, 0.6), row(4, "L1", 4, 0.6), row(5, "L77", 1, 0.6)], byCode);
  assert.deepEqual(g.map((x) => x.code), ["L1", "L500", "L77", "L9"]);   // Premier League (top list), then Alpha Cup, L77 (no catalog entry: named by its code), Zeta League
  assert.deepEqual(g[0].picks.map((x) => x.id), [4, 3]); assert.equal(g[0].name, "Premier League"); assert.equal(g.find((x) => x.code === "L77").name, "L77");
});
t("pickId is fixed per match and market", () => { assert.equal(pickId({ id: 12, m: "OU25" }), "a_12_OU25"); assert.notEqual(pickId({ id: 12, m: "BTTS" }), pickId({ id: 12, m: "OU25" })); });

/* ---------- editing a saved pick ---------- */
const pk = (o = {}) => ({ v: 3, matchId: 7, kickoff: 2000, odds: null, stake: null, myProb: null, mktProb: null, ...o });
t("canEditPick: tracked, kick-off still ahead, nothing known about the match yet", () => {
  assert.equal(canEditPick(pk(), 1999 * 1000), true);
  assert.equal(canEditPick(pk(), 2000 * 1000), false, "at kick-off it is closed (the rule uses a strict less-than)");
  assert.equal(canEditPick(pk(), 2500 * 1000), false);
  assert.equal(canEditPick(pk({ kickoff: null }), 0), false); assert.equal(canEditPick(pk({ matchId: null }), 0), false); assert.equal(canEditPick(pk({ v: 2 }), 0), false);
  assert.equal(canEditPick(pk({ won: true }), 0), false); assert.equal(canEditPick(pk({ live: {} }), 0), false); assert.equal(canEditPick(pk({ wait: "postponed" }), 0), false);
  assert.deepEqual([...EDITABLE], ["odds", "stake", "myProb", "mktProb"]);
});
t("editPatch: validates odds, stake and own % and clears the stale market probability", () => {
  assert.deepEqual(editPatch(pk(), { odds: "2.10", stake: "10", mine: "55" }).patch, { odds: 2.1, stake: 10, myProb: 0.55, mktProb: null });
  assert.deepEqual(editPatch(pk(), { odds: "2,5", stake: "", mine: "" }).patch, { odds: 2.5, stake: null, myProb: null, mktProb: null }, "comma decimals work");
  assert.deepEqual(editPatch(pk(), { odds: "", stake: "", mine: "" }).patch, { odds: null, stake: null, myProb: null, mktProb: null }, "everything can be cleared");
  assert.equal(editPatch(pk({ odds: 2, mktProb: 0.4 }), { odds: "2", stake: "5", mine: "" }).patch.mktProb, 0.4, "same odds keep the market probability");
  assert.equal(editPatch(pk({ odds: 2, mktProb: 0.4 }), { odds: "2.2", stake: "", mine: "" }).patch.mktProb, null, "new odds clear it");
  for (const bad of [{ odds: "1" }, { odds: "0.9" }, { odds: "abc" }, { odds: "2.1abc" }, { odds: "Infinity" }, { odds: "2", stake: "0" }, { odds: "2", stake: "-3" }, { odds: "2", stake: "x" }, { odds: "", stake: "5" }, { odds: "2", mine: "0" }, { odds: "2", mine: "100" }, { odds: "2", mine: "abc" }])
    assert.ok(editPatch(pk(), { stake: "", mine: "", ...bad }).error, JSON.stringify(bad));
  for (const k of Object.keys(editPatch(pk(), { odds: "2", stake: "1", mine: "5" }).patch)) assert.ok(EDITABLE.includes(k));
});

/* ---------- PDF ---------- */
t("daily receipt PDF: own title and badge, kick-off notes, valid structure; normal receipts unchanged", () => {
  const rows = [row(1, "L1", 1800000000, 0.62), { ...row(2, "L1", 1800003600, 0.64), m: "OU25", s: "O" }];
  const r = dailyReceipt(rows, { day: "2027-01-15", code: "L1" });
  assert.equal(r.id, "BIQ-D20270115-L1"); assert.equal(r.key, "daily-2027-01-15-L1"); assert.equal(r.picks.length, 2); assert.equal(r.t, 1800000000);
  const pdf = receiptPdf(r, { title: "DAILY PICKS", badge: "MODEL PICKS · 2", leagueName: () => "Premier League", who: "A B" });
  assert.ok(pdf.startsWith("%PDF-1.4") && pdf.endsWith("%%EOF"));
  assert.ok(pdf.includes("(DAILY PICKS)") && pdf.includes("MODEL PICKS") && pdf.includes("Kick-off") && pdf.includes("Premier League") && pdf.includes("Over 2.5"));
  assert.ok(!pdf.includes("PICK RECEIPT") && !pdf.includes("ONGOING") && !pdf.includes("Picks settle"));
  const at = +/startxref\n(\d+)/.exec(pdf)[1]; assert.equal(pdf.slice(at, at + 4), "xref");
  const plain = receiptPdf({ ...r, open: true, openCount: 2, picks: r.picks.map(({ note, ...p }) => p) });
  assert.ok(plain.includes("PICK RECEIPT") && plain.includes("ONGOING") && plain.includes("Picks settle") && plain.includes("Pending") && !plain.includes("DAILY PICKS"));
});

/* ---------- verified badge ---------- */
t("isVerified needs a confirmed, well-formed email", () => {
  assert.equal(isVerified({ email: "a@b.co", emailVerified: true }), true);
  assert.equal(isVerified({ email: " a.b+c@mail.example.com ", emailVerified: true }), true);
  assert.equal(isVerified({ email: "a@b.co", emailVerified: false }), false);
  assert.equal(isVerified({ email: "a@b.co" }), false);
  for (const e of [null, undefined, "", "nope", "a@b", "a@@b.co", "a b@c.co", 5]) assert.equal(isVerified({ email: e, emailVerified: true }), false, String(e));
  assert.equal(isVerified(null), false); assert.equal(isVerified(undefined), false); assert.equal(isVerified({ emailVerified: true }), false);
});

/* ---------- scripts/picks.mjs against stored data (DRY_RUN: files, no Firestore) ---------- */
t("picks.mjs: writes daily/<day>, includes cups with raised minimums, caps per competition, freezes started matches", () => {
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pois = (l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const teams = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, name: "Team " + (i + 1), att: 0.4 + (i / 15) * 1.4, def: 1.5 - (i / 15) * 1.1 }));
  const nowS = Math.floor(Date.now() / 1000), day = 86400, results = []; let id = 1;
  for (let rep = 0; rep < 2; rep++) for (const h of teams) for (const a of teams) if (h !== a) results.push({ id: id++, h: h.id, a: a.id, hg: pois(1.5 * h.att * a.def), ag: pois(1.2 * a.att * h.def), t: nowS - (60 + rep * 120 + (id % 50)) * day, r: 1, s: 0 });
  const fixtures = []; for (let i = 0; i < 8; i++) fixtures.push({ id: 90000 + i, h: teams[15 - i].id, a: teams[i].id, t: nowS + day + 3600 * (i + 1), s: "notstarted" });
  fixtures.push({ id: 90100, h: 1, a: 2, t: nowS + day, s: "postponed" }, { id: 90101, h: 3, a: 4, t: nowS - 3600, s: "notstarted" }, { id: 90102, h: 5, a: 6, t: nowS + 40 * day, s: "notstarted" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betiq-picks-")), put = (p, d) => { fs.mkdirSync(path.dirname(path.join(dir, ".sync-out", p)), { recursive: true }); fs.writeFileSync(path.join(dir, ".sync-out", p + ".json"), JSON.stringify(d)); };
  const names = teams.map(({ id, name }) => ({ id, name }));
  put("catalog/main", { leagues: [{ code: "L1", id: 1, name: "Test League", kind: "league", s: { at: "x", results: results.length, fixtures: 8 } }, { code: "L2", id: 2, name: "Test Cup", kind: "comp", s: { at: "x", results: 1, fixtures: 1 } }, { code: "L3", id: 3, name: "Unsynced", kind: "league", s: {} }] });
  for (const c of ["L1", "L2"]) { put(`meta/${c}`, { seasons: [{ id: 10 }], current: 10 }); put(`teams/${c}`, { list: names }); put(`fixtures/${c}`, { list: fixtures }); put(`seasons/${c}_10`, { results }); }
  const run = (extra = {}) => { const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "picks.mjs")], { cwd: dir, env: { ...process.env, DRY_RUN: "1", ...extra }, encoding: "utf8" }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
  const read = (d) => JSON.parse(fs.readFileSync(path.join(dir, ".sync-out", "daily", d + ".json"), "utf8"));
  const out = run(), tomorrow = utcDay((nowS + day) * 1000), list = [...Array(4)].flatMap((_, i) => read(utcDay(Date.now() + i * 864e5)).list);
  assert.match(out, /picks: \d+ picks from 2 competitions in 4 days/);
  assert.ok(list.length >= 1, "the synthetic league has clear favourites, so some picks must be made");
  assert.ok(list.every((x) => x.c === "L1" || x.c === "L2"), "only synced competitions (L3 was never synced)");
  assert.ok(list.some((x) => x.c === "L1") && list.some((x) => x.c === "L2"), "the cup is included");
  for (const x of list.filter((y) => y.c === "L2")) assert.ok(x.p >= DAILY.min[x.m] + DAILY.roughPlus - 1e-9, "cup picks clear the raised minimum");
  assert.ok(list.every((x) => x.t > nowS && x.id >= 90000 && x.id < 90100), "no postponed, started or far-future matches");
  for (const x of list) { assert.ok(x.p >= DAILY.min[x.m] && x.p <= 1 && MARKETS[x.m].sel[x.s] && x.hn.startsWith("Team ") && x.x.length === 2); }
  for (const d of [...Array(4)].map((_, i) => utcDay(Date.now() + i * 864e5))) { const l = read(d).list; for (const c of ["L1", "L2"]) assert.ok(l.filter((x) => x.c === c).length <= (c === "L2" ? DAILY.capCup : DAILY.cap), "cap per competition per day (cups have their own)"); assert.ok(l.every((x) => utcDay(x.t * 1000) === d), "rows sit in their own UTC day"); }
  assert.equal(read(tomorrow).n, read(tomorrow).list.length);
  // frozen: pretend the first pick's match has started and its stored values changed; a re-run must keep it and not duplicate it
  const first = list[0], d1 = utcDay(first.t * 1000), doc = read(d1), idx = doc.list.findIndex((x) => x.c === first.c && x.id === first.id);
  doc.list[idx] = { ...doc.list[idx], t: nowS - 60, p: 0.999 }; put(`daily/${d1}`, doc);
  run();
  const after = read(d1).list.filter((x) => x.c === first.c && x.id === first.id); assert.equal(after.length, 1); assert.equal(after[0].p, 0.999); assert.equal(after[0].t, nowS - 60);
  // old days are removed
  put(`daily/${utcDay(Date.now() - 5 * 864e5)}`, { list: [] }); run(); assert.ok(!fs.existsSync(path.join(dir, ".sync-out", "daily", utcDay(Date.now() - 5 * 864e5) + ".json")));
  run({ DAILY_PER_COMP: "1", DAILY_PER_CUP: "1" }); for (const d of [...Array(4)].map((_, i) => utcDay(Date.now() + i * 864e5))) for (const c of ["L1", "L2"]) assert.ok(read(d).list.filter((x) => x.c === c && x.t > nowS).length <= 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
console.log(`\nALL DAILY PICKS TESTS PASSED (${n})`);
