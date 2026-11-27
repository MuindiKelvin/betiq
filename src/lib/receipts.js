import { MARKETS, dateTimeDMY, dayDMY, pct, pickLabel, pickMarket } from "./util.js";

export const money = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2);
const two = (n) => String(n).padStart(2, "0");
// local calendar day of a unix time -> "2026-11-16"
export const dayKey = (t) => { const x = new Date(t * 1000); return `${x.getFullYear()}-${two(x.getMonth() + 1)}-${two(x.getDate())}`; };
const tracked = (p) => p.v === 3 && !!p.matchId;

// A pick is open until its match is settled; picks that can never settle (old app versions, no fixture) don't keep a receipt open.
export const isOpen = (p) => p.won == null && tracked(p);

// One receipt per match day (the day the picks' matches are played), newest first.
export function buildReceipts(rows) {
  const g = new Map();
  for (const p of rows) { const k = dayKey(p.t); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
  return [...g].map(([key, picks]) => {
    picks.sort((a, b) => a.t - b.t);
    const done = picks.filter((p) => p.won != null), pl = done.filter((p) => p.profit != null), openCount = picks.filter(isOpen).length;
    return { key, id: "BIQ-" + key.replace(/-/g, ""), t: picks[0].t, picks, open: openCount > 0, openCount, settled: done.length, won: done.filter((p) => p.won).length,
      stake: picks.reduce((s, p) => s + (p.stake || 0), 0), ret: picks.reduce((s, p) => s + (p.stake && p.odds ? p.stake * p.odds : 0), 0), profit: pl.length ? pl.reduce((s, p) => s + p.profit, 0) : null };
  }).sort((a, b) => b.key.localeCompare(a.key));
}

export const statusOf = (p) => p.won != null ? `${p.score} FT · ${p.won ? "Won" : "Lost"}${p.profit != null ? ` (${money(p.profit)})` : ""}`
  : p.live ? `Live ${p.live.hg ?? "–"}–${p.live.ag ?? "–"}`
  : p.wait === "postponed" ? "Postponed" : p.wait === "cancelled" ? "Cancelled" : p.wait ? "Awaiting result"
  : tracked(p) ? "Pending" : p.v !== 3 ? "Not tracked" : "No fixture";

/* ---------- branded PDF receipt (no dependencies: one page, built-in Courier fonts, height fits the content) ---------- */
const SPECIAL = { "€": 128, "…": 133, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151 };   // WinAnsi codes above Latin-1
const FOLD = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i", "İ": "I", "Ħ": "H", "ħ": "h" };   // letters with no accent decomposition
const clean = (v) => [...String(v ?? "").normalize("NFC")].map((c) => {
  const n = c.charCodeAt(0);
  if (c === "−") return "-";
  if (FOLD[c]) return FOLD[c];
  if (SPECIAL[c] || (n >= 32 && n <= 255 && n !== 127)) return c;
  const b = c.normalize("NFD")[0];
  return b && b.charCodeAt(0) >= 32 && b.charCodeAt(0) < 127 ? b : n < 32 ? " " : "?";
}).join("");
const esc = (s) => [...s].map((c) => { const n = SPECIAL[c] ?? c.charCodeAt(0); return c === "(" || c === ")" || c === "\\" ? "\\" + c : n < 32 || n > 126 ? "\\" + n.toString(8).padStart(3, "0") : c; }).join("");
const wrap = (s, n, max = 2) => {
  const out = []; let cur = "";
  for (const w of clean(s).split(/\s+/).filter(Boolean)) {
    const word = w.length > n ? w.slice(0, n - 1) + "…" : w;
    if ((cur + " " + word).trim().length > n) { out.push(cur); cur = word; } else cur = (cur + " " + word).trim();
  }
  if (cur) out.push(cur);
  if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].slice(0, n - 1) + "…"; }
  return out;
};

const C = { dark: "0.04 0.15 0.09", gold: "1 0.82 0.25", ink: "0.1 0.1 0.1", grey: "0.45 0.45 0.45", green: "0.08 0.55 0.28", red: "0.8 0.15 0.2", amber: "0.75 0.5 0", white: "1 1 1" };

// The receipt as drawing instructions, in top-down coordinates (y grows downwards): { W, H, items }. The PDF and the on-screen preview are both drawn from this
// one list, so the preview shows exactly what the downloaded file contains.
//   { k: "rect", col, x, top, w, h } | { k: "text", t, size, bold, col, left, base } | { k: "rule", dash, at, x1, x2 }     (col: PDF colour, "r g b" in 0..1)
// title / badge: optional header texts (daily picks use "DAILY PICKS" and "MODEL PICKS · n"); a pick's `note` replaces its status line.
export function layoutReceipt(r, { leagueName = () => null, who = "", now = Date.now() / 1000, title = "PICK RECEIPT", badge = null } = {}) {
  const W = 300, M = 18, items = [];
  let y = 0;
  const rect = (col, x, top, w, h) => items.push({ k: "rect", col, x, top, w, h });
  const text = (s, { x = M, size = 8, bold = false, col = C.ink, align = "left" } = {}) => {
    const t = clean(s), w = t.length * 0.6 * size, left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    items.push({ k: "text", t, size, bold, col, left, base: y });
  };
  const rule = (dash) => items.push({ k: "rule", dash, at: y, x1: M, x2: W - M });
  const row = (l, v, o = {}) => { text(l, { size: 8.5, col: C.grey }); text(v, { x: W - M, size: 8.5, bold: true, align: "right", ...o }); y += 12; };

  // header band
  rect(C.dark, 0, 0, W, 74);
  y = 38; text("Bet", { size: 24, bold: true, col: C.white }); text("IQ", { x: M + 3 * 0.6 * 24, size: 24, bold: true, col: C.gold });
  y = 56; text("ANALYZE · PREDICT · BET SMART", { size: 6.5, col: "0.7 0.78 0.72" });
  y = 98; text(title, { x: W / 2, size: 13, bold: true, align: "center" });
  y += 13; text("No. " + r.id, { x: W / 2, size: 8.5, col: C.grey, align: "center" });
  y += 12; text(dayDMY(r.t), { x: W / 2, size: 9, align: "center" });
  y += 12; rect(r.open || badge ? C.amber : C.green, W / 2 - 62, y, 124, 18);
  y += 12.5; text(badge ?? (r.open ? `ONGOING · ${r.openCount} PENDING` : "FINISHED"), { x: W / 2, size: 8, bold: true, col: C.white, align: "center" });
  y += 17;
  if (r.open && !badge) { text("Picks settle automatically when matches end.", { x: W / 2, size: 6.5, col: C.grey, align: "center" }); y += 8; text("Download again later for the final result.", { x: W / 2, size: 6.5, col: C.grey, align: "center" }); y += 12; }
  if (who) { text("Player", { size: 8, col: C.grey }); text(wrap(who, 36, 1)[0], { x: W - M, size: 8, align: "right" }); y += 11; }
  text("Printed", { size: 8, col: C.grey }); text(dateTimeDMY(now), { x: W - M, size: 8, align: "right" });
  y += 10; rule(true); y += 15;

  // picks
  r.picks.forEach((p, i) => {
    wrap(`${i + 1}. ${p.home} vs ${p.away}`, 48).forEach((ln) => { text(ln, { size: 9, bold: true }); y += 11; });
    const lg = leagueName(p.league); if (lg) { text(wrap(lg, 60, 1)[0], { size: 7.5, col: C.grey }); y += 10; }
    wrap(`${MARKETS[pickMarket(p)]?.label ?? ""}: ${pickLabel(p)}${p.prob != null ? ` (${pct(p.prob)})` : ""}`, 55).forEach((ln) => { text(ln, { size: 8 }); y += 10; });
    const odds = p.odds ? `Odds ${p.odds.toFixed(2)}${p.stake ? ` · Stake ${p.stake}` : ""}` : "";
    if (odds) text(odds, { size: 8, col: C.grey });
    text(p.note ?? statusOf(p), { x: W - M, size: 8, bold: true, align: "right", col: p.won != null ? (p.won ? C.green : C.red) : p.live ? C.red : C.amber });
    y += 16;
  });

  // totals
  rule(true); y += 15;
  row("Picks", String(r.picks.length));
  if (r.settled) row("Won", `${r.won}/${r.settled}`);
  if (r.stake) row("Total stake", r.stake.toFixed(2));
  if (r.ret) row("Potential return", r.ret.toFixed(2));
  if (r.profit != null) row("Profit (settled)", money(r.profit), { col: r.profit >= 0 ? C.green : C.red });
  y += 2; rule(false); y += 16;

  // barcode drawn from the receipt number, then footer
  const top = y; let bx = 0; const bars = [];
  for (const c of r.id) for (let b = 6; b >= 0; b--) { if ((c.charCodeAt(0) >> b) & 1) bars.push(bx); bx += 1.9; }
  const x0 = (W - bx) / 2;
  bars.forEach((b) => rect(C.ink, x0 + b, top, 1.3, 24));
  y = top + 34; text(r.id, { x: W / 2, size: 7, col: C.grey, align: "center" });
  y += 16; text("Estimates only. 18+, bet responsibly.", { x: W / 2, size: 6.5, col: C.grey, align: "center" });
  y += 9; text("Data: Bzzoiro Sports Data", { x: W / 2, size: 6.5, col: C.grey, align: "center" });
  y += 18;
  return { W, H: Math.ceil(y), items };
}

// PDF page content for one drawing item (PDF y grows upwards, so every y is turned round with the page height H)
const pdfOp = (it, H, f2) => it.k === "rect" ? `${it.col} rg ${f2(it.x)} ${f2(H - it.top - it.h)} ${f2(it.w)} ${f2(it.h)} re f`
  : it.k === "text" ? `BT /${it.bold ? "F2" : "F1"} ${it.size} Tf ${it.col} rg ${f2(it.left)} ${f2(H - it.base)} Td (${esc(it.t)}) Tj ET`
  : `${it.dash ? "[2 2] 0 d" : "[] 0 d"} 0.5 w 0.6 G ${it.x1} ${f2(H - it.at)} m ${it.x2} ${f2(H - it.at)} l S [] 0 d`;

export function receiptPdf(r, opts = {}) {
  const { W, H, items } = layoutReceipt(r, opts), f2 = (v) => +v.toFixed(2), body = items.map((it) => pdfOp(it, H, f2)).join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;   // ASCII only, so string length equals byte length
}

// The same drawing as SVG elements for the on-screen preview: [{ tag: "rect" | "text" | "line", props, text? }] inside viewBox "0 0 W H" (y downwards, as laid out).
const rgb = (col) => "rgb(" + col.split(" ").map((v) => Math.round(parseFloat(v) * 255)).join(",") + ")";
export function receiptSvgParts({ items }) {
  return items.map((it) => it.k === "rect" ? { tag: "rect", props: { x: it.x, y: it.top, width: it.w, height: it.h, fill: rgb(it.col) } }
    : it.k === "text" ? { tag: "text", text: it.t, props: { x: it.left, y: it.base, fontSize: it.size, fontWeight: it.bold ? 700 : 400, fill: rgb(it.col), textLength: it.t.length ? +(it.t.length * 0.6 * it.size).toFixed(2) : undefined, lengthAdjust: "spacing" } }
    : { tag: "line", props: { x1: it.x1, x2: it.x2, y1: it.at, y2: it.at, stroke: "rgb(153,153,153)", strokeWidth: 0.5, strokeDasharray: it.dash ? "2 2" : undefined } });
}

// File name with the match day as day-month-year: "betiq-receipt-25-11-2026.pdf" (daily picks: "betiq-receipt-daily-25-11-2026-L1.pdf").
// "/" cannot be used in a file name, so the parts are joined with "-". The receipt key itself stays year-month-day so it sorts and groups correctly.
export const receiptFile = (r) => `betiq-receipt-${r.key.replace(/(\d{4})-(\d{2})-(\d{2})/, "$3-$2-$1")}.pdf`;

export function downloadReceipt(r, opts) {
  const url = URL.createObjectURL(new Blob([receiptPdf(r, opts)], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: receiptFile(r) });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
