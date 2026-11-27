// The receipt preview is drawn from the same layout as the PDF: same texts, same boxes, same lines, same page size.
import assert from "node:assert/strict";
import { layoutReceipt, receiptPdf, receiptSvgParts } from "../../src/lib/receipts.js";
import { settle } from "../../src/lib/util.js";

const at = (d, h = 10) => new Date(2026, 10, d, h).getTime() / 1000;
const mk = (i, o = {}) => ({ v: 3, matchId: i, league: "L" + (i % 3), home: ["Atlético Bucaramanga", "Łódź ŁKS", "Fenerbahçe €", "Cerezo (Osaka)", "A very long club name FC International Reserves"][i % 5], away: ["Tokyo Verdy", "Đurđevac", "FC Bayern München", "Back\\slash", "B"][i % 5], market: ["1X2", "OU25", "BTTS", "DC"][i % 4], selection: ["H", "O", "Y", "HD"][i % 4], prob: 0.5 + (i % 40) / 100, odds: i % 3 ? 2.1 : null, stake: i % 3 ? 10 : null, t: at(25) + i * 60, ...o });
const picks = Array.from({ length: 10 }, (_, i) => { const p = mk(i); return i % 4 === 0 ? { ...p, score: "2–1", ...settle(p, 2, 1) } : i % 4 === 1 ? { ...p, live: { hg: 1, ag: 0 } } : p; });
const rc = (ps, o = {}) => ({ key: "2026-11-25", id: "BIQ-20261125", t: at(25), picks: ps, open: true, openCount: 3, settled: 3, won: 2, stake: 30, ret: 63, profit: 5.5, ...o });
const cases = [[rc(picks), { who: "Kevin Muindi", now: at(27, 2) }], [rc(picks.slice(0, 1), { open: false, openCount: 0, profit: -3 }), { now: 1.76e9 }],
  [rc(picks, { stake: 0, ret: 0, profit: null, settled: 0 }), { title: "DAILY PICKS", badge: "MODEL PICKS · 10", leagueName: (c) => "League " + c, now: 1e9 }], [rc([picks[0], { ...picks[1], note: "Kick-off 19:00 UTC" }]), { who: "X".repeat(60), now: 1.7e9 }]];

for (const [r, o] of cases) {
  const L = layoutReceipt(r, o), parts = receiptSvgParts(L), pdf = receiptPdf(r, o), n = (re) => (pdf.match(re) || []).length;
  assert.equal(parts.filter((x) => x.tag === "text").length, n(/ Tj ET/g), "one text per Tj");
  assert.equal(parts.filter((x) => x.tag === "rect").length, n(/ re f/g), "one rect per filled rectangle");
  assert.equal(parts.filter((x) => x.tag === "line").length, n(/ l S/g), "one line per rule");
  assert.ok(pdf.includes(`/MediaBox [0 0 ${L.W} ${L.H}]`), "page size = viewBox size");
  for (const p of parts) if (p.tag === "text") { if (/^[\x20-\x7e]*$/.test(p.text)) assert.ok(pdf.includes("(" + p.text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")"), "text in the PDF: " + p.text); assert.ok(p.props.y > 0 && p.props.y <= L.H, "baseline inside the page"); }
  for (const p of parts) if (p.tag === "rect") assert.ok(p.props.y >= 0 && p.props.y + p.props.height <= L.H + 0.01 && p.props.x >= 0 && p.props.x + p.props.width <= L.W + 0.01, "box inside the page");
  assert.ok(parts.every((p) => !p.props.fill || /^rgb\(\d+,\d+,\d+\)$/.test(p.props.fill)));
}
// same input, same output (a fixed `now` makes the preview and the download identical)
const [r0, o0] = cases[0];
assert.equal(receiptPdf(r0, o0), receiptPdf(r0, o0));
assert.deepEqual(receiptSvgParts(layoutReceipt(r0, o0)), receiptSvgParts(layoutReceipt(r0, o0)));
// the printed time is part of the drawing, so a different `now` changes it
assert.notEqual(receiptPdf(r0, { ...o0, now: o0.now + 3600 }), receiptPdf(r0, o0));
// colours: PDF "r g b" fractions -> CSS rgb()
const header = receiptSvgParts(layoutReceipt(r0, o0))[0];
assert.equal(header.tag, "rect"); assert.match(header.props.fill, /^rgb\(/);
console.log("receipt preview: ok (" + cases.length + " receipts)");
