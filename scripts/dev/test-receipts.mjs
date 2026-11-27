// Receipts: day/month/year dates and file names, and the accuracy numbers worked out from two real receipts (25 and 26 Nov 2026).  npm test
// The real picks are replayed through the app's own settle(), buildReceipts() and calibrate(), so a change to any of them that alters a result fails here.
import assert from "node:assert/strict";
import { byMarket, calibrate, wilson } from "../../src/lib/calibration.js";
import { buildReceipts, receiptFile, receiptPdf } from "../../src/lib/receipts.js";
import { dateTimeDMY, dayDMY, dmy, settle } from "../../src/lib/util.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const near = (a, b, e = 5e-4) => Math.abs(a - b) < e;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;   // local time, like the app's day keys

t("dmy: day/month/year, two digits for day and month, local calendar day", () => {
  assert.equal(dmy(at(2026, 11, 25)), "25/11/2026");
  assert.equal(dmy(at(2026, 1, 5)), "05/01/2026", "single digits are padded");
  assert.equal(dmy(at(2026, 12, 31, 23, 59)), "31/12/2026"); assert.equal(dmy(at(2027, 1, 1, 0, 0)), "01/01/2027");
  assert.equal(dmy(at(2026, 11, 25), "-"), "25-11-2026");
  assert.equal(dayDMY(at(2026, 11, 25)), "Wed 25/11/2026"); assert.equal(dayDMY(at(2026, 11, 26)), "Thu 26/11/2026");
  assert.match(dateTimeDMY(at(2026, 11, 27, 2, 17)), /^27\/11\/2026 · /);
});

t("receiptFile: day-month-year in the file name, no slash, daily picks keep their code", () => {
  assert.equal(receiptFile({ key: "2026-11-25" }), "betiq-receipt-25-11-2026.pdf");
  assert.equal(receiptFile({ key: "2026-11-26" }), "betiq-receipt-26-11-2026.pdf");
  assert.equal(receiptFile({ key: "2027-01-05" }), "betiq-receipt-05-01-2027.pdf");
  assert.equal(receiptFile({ key: "daily-2027-01-15-L1" }), "betiq-receipt-daily-15-01-2027-L1.pdf");
  assert.equal(receiptFile({ key: "daily-2027-01-15" }), "betiq-receipt-daily-15-01-2027.pdf");
  for (const k of ["2026-11-25", "daily-2027-01-15-L1"]) assert.ok(!/[\\/]/.test(receiptFile({ key: k })));
});

/* ---------- the two real receipts: [home, away, market, selection, probability %, home goals, away goals] (goals null = postponed) ---------- */
const O = "OU25", X = "1X2", B = "BTTS";
const R25 = [["Millonarios", "Atlético Bucaramanga", O, "U", 68, 4, 1], ["América de Cali", "Deportivo Cali", O, "U", 76, 2, 1], ["San Jose Earthquakes", "Houston Dynamo", B, "Y", 61, 2, 1],
  ["Mito Hollyhock", "Tokyo Verdy", O, "U", 66, 1, 0], ["Fagiano Okayama", "Shimizu S-Pulse", O, "U", 65, 2, 0], ["Urawa Red Diamonds", "Cerezo Osaka", O, "O", 67, 2, 2],
  ["Audace Cerignola", "Inter U23", X, "H", 52, 3, 0], ["Primeiro de Agosto", "Kabuscorp SCP", O, "U", 78, 1, 2], ["Sporting Lagos FC", "Enugu Rangers", O, "U", 61, null, null],
  ["Atlético Petróleos de Luanda", "FC Cabinda", B, "N", 80, 3, 1], ["SK Slavia Praha", "Villarreal", O, "O", 82, 0, 1], ["Sabah FK", "FC Barcelona", O, "O", 76, 1, 4],
  ["Cremonese", "US Avellino 1912", O, "U", 68, 0, 1], ["Pisa", "Modena", O, "O", 70, 1, 1], ["Padova", "Sampdoria", O, "U", 64, 1, 2], ["Boreham Wood", "Aldershot Town", X, "H", 71, 4, 1],
  ["Harrogate Town", "Kidderminster Harriers", X, "H", 60, 3, 1], ["Watford", "Blackburn Rovers", O, "U", 60, 0, 1], ["Burnley", "Birmingham City", O, "U", 66, 0, 2], ["Stoke City", "Millwall", X, "H", 52, 2, 1],
  ["Shakhtar Donetsk", "Fenerbahçe", X, "H", 55, 0, 1], ["LOSC Lille", "FC Bayern München", O, "O", 95, 2, 1], ["Sporting CP", "Manchester United", X, "H", 78, 2, 2], ["Club Brugge KV", "Liverpool FC", O, "O", 88, 0, 3]];
const R26 = [["FK Kauno Zalgiris", "Riga FC", X, "A", 65, 2, 0], ["Royale Union Saint-Gilloise", "Lech Poznan", X, "H", 75, 2, 2], ["Olympique de Marseille", "Levski Sofia", O, "U", 77, 1, 0],
  ["Olympiacos FC", "AC Milan", X, "H", 55, 2, 4], ["GNK Dinamo Zagreb", "Bayer 04 Leverkusen", X, "A", 92, 0, 2], ["FC Viktoria Plzen", "Benfica", X, "A", 61, 4, 0], ["Doncaster Rovers", "Huddersfield Town", X, "A", 53, 2, 3],
  ["Sporting Braga", "Kuopion Palloseura", B, "N", 76, 4, 0], ["FC Nordsjælland", "Panathinaikos FC", O, "O", 67, 3, 2], ["CSKA Sofia", "Trabzonspor", O, "O", 86, 1, 2], ["TSG Hoffenheim", "SK Sturm Graz", X, "H", 86, 3, 1],
  ["Juventus", "Omonia Nicosia", O, "O", 67, 4, 1], ["Ferencváros TC", "NK Celje", X, "H", 75, 0, 0], ["AC Sparta Praha", "AZ Alkmaar", X, "A", 73, 2, 4]];
// What each receipt printed, in the same order: W = won, L = lost, P = postponed
const P25 = "LLWWWWWLPLLWWLLWWWWWLWLW".split(""), P26 = "LLWLWLWWWWWWLW".split("");

const rows = (list, day) => list.map(([home, away, market, selection, p, hg, ag], i) => {
  const pick = { v: 3, matchId: day * 100 + i, league: "x", home, away, market, selection, prob: p / 100, odds: null, stake: null, t: at(2026, 11, day, 10) + i * 60 };
  if (hg == null) return { ...pick, wait: "postponed" };
  return { ...pick, score: `${hg}–${ag}`, ...settle(pick, hg, ag) };
});

t("settle() reproduces every Won/Lost printed on the two receipts (37 settled picks, 1 postponed)", () => {
  for (const [list, flags, day] of [[R25, P25, 25], [R26, P26, 26]]) {
    assert.equal(list.length, flags.length);
    rows(list, day).forEach((p, i) => assert.equal(p.wait ? "P" : p.won ? "W" : "L", flags[i], `${day} Nov, pick ${i + 1}: ${p.home} vs ${p.away}`));
  }
});

t("buildReceipts: one receipt per match day, with the totals the PDFs print (Won 14/23 and 9/14)", () => {
  const [r26, r25] = buildReceipts([...rows(R25, 25), ...rows(R26, 26)]);
  assert.equal(r25.key, "2026-11-25"); assert.equal(r25.id, "BIQ-20261125"); assert.equal(r26.key, "2026-11-26"); assert.equal(r26.id, "BIQ-20261126");
  assert.deepEqual([r25.picks.length, r25.settled, r25.won, r25.open, r25.openCount], [24, 23, 14, true, 1]);
  assert.deepEqual([r26.picks.length, r26.settled, r26.won, r26.open, r26.openCount], [14, 14, 9, false, 0]);
  const pdf = receiptPdf(r25, { who: "Kevin Muindi", now: at(2026, 11, 27, 2, 17) });
  assert.ok(pdf.includes("(Wed 25/11/2026)"), "match day as day/month/year");
  assert.ok(pdf.includes("(27/11/2026 ") && pdf.includes("Printed"), "printed date as day/month/year");
  assert.ok(!pdf.includes("Nov 25") && !pdf.includes("Nov 27"), "no month-name dates left");
  assert.ok(pdf.includes("(14/23)") && pdf.includes("ONGOING") && pdf.includes("1 PENDING") && pdf.includes("BIQ-20261125"));
  assert.ok(receiptPdf(r26, { now: at(2026, 11, 27, 1, 16) }).includes("(Thu 26/11/2026)") && receiptPdf(r26).includes("FINISHED"));
  const xref = +/startxref\n(\d+)/.exec(pdf)[1]; assert.equal(pdf.slice(xref, xref + 4), "xref"); assert.ok(pdf.startsWith("%PDF-1.4") && pdf.endsWith("%%EOF"));
});

t("accuracy of the model's probabilities on the 37 settled picks (both receipts together)", () => {
  const all = [...rows(R25, 25), ...rows(R26, 26)].filter((p) => p.won != null), c = calibrate(all, "prob");
  assert.equal(c.n, 37); assert.equal(c.won, 23);
  assert.ok(near(c.hit, 23 / 37), "hit rate 62.2%"); assert.ok(near(c.avg, 0.7043), "average stated probability 70.4%");
  assert.ok(near(c.gap, 0.0827), "overconfident by 8.3 points"); assert.ok(near(c.brier, 0.2518), "Brier 0.252, barely better than always saying 50% (0.250)");
  assert.ok(near(c.ci[0], 0.461) && near(c.ci[1], 0.759), "95% range 46%–76%: too wide to tell the model from a coin flip");
  const exp = all.reduce((s, p) => s + p.prob, 0), sd = Math.sqrt(all.reduce((s, p) => s + p.prob * (1 - p.prob), 0));
  assert.ok(near(exp, 26.06, 0.01) && near(sd, 2.69, 0.01) && Math.abs((23 - exp) / sd) < 1.96, "23 wins vs 26.1 expected: within normal luck");
  const m = Object.fromEntries(byMarket(all, "prob").map((x) => [x.key, x]));
  assert.deepEqual([m[O].n, m[O].won, m[X].n, m[X].won, m[B].n, m[B].won], [19, 13, 15, 8, 3, 2]);
  const day = (rs) => calibrate(rs.filter((p) => p.won != null), "prob");
  assert.deepEqual([day(rows(R25, 25)).won, day(rows(R25, 25)).n, day(rows(R26, 26)).won, day(rows(R26, 26)).n], [14, 23, 9, 14]);
});

t("wilson interval: bounds stay inside 0..1 and shrink as picks grow", () => {
  assert.equal(wilson(0, 0), null); const [a, b] = wilson(5, 5); assert.ok(a > 0.4 && b <= 1); const [c, d] = wilson(0, 5); assert.ok(c === 0 && d < 0.6);
  const w = (k, m) => { const [x, y] = wilson(k, m); return y - x; }; assert.ok(w(50, 100) < w(5, 10) && w(500, 1000) < w(50, 100));
});
console.log(`\nALL RECEIPT TESTS PASSED (${n})`);
