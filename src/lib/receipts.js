import { MARKETS, dateTimeLabel, dayLabel, pct, pickLabel, pickMarket } from "./util.js";

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

export function receiptPdf(r, { leagueName = () => null, who = "", now = Date.now() / 1000 } = {}) {
  const W = 300, M = 18, IN = W - 2 * M, ops = [], f2 = (v) => +v.toFixed(2);
  let y = 0;
  const rect = (col, x, top, w, h) => ops.push((H) => `${col} rg ${f2(x)} ${f2(H - top - h)} ${f2(w)} ${f2(h)} re f`);
  const text = (s, { x = M, size = 8, bold = false, col = C.ink, align = "left" } = {}) => {
    const t = clean(s), w = t.length * 0.6 * size, left = align === "right" ? x - w : align === "center" ? x - w / 2 : x, base = y;
    ops.push((H) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${col} rg ${f2(left)} ${f2(H - base)} Td (${esc(t)}) Tj ET`);
  };
  const rule = (dash) => { const at = y; ops.push((H) => `${dash ? "[2 2] 0 d" : "[] 0 d"} 0.5 w 0.6 G ${M} ${f2(H - at)} m ${W - M} ${f2(H - at)} l S [] 0 d`); };
  const row = (l, v, o = {}) => { text(l, { size: 8.5, col: C.grey }); text(v, { x: W - M, size: 8.5, bold: true, align: "right", ...o }); y += 12; };

  // header band
  rect(C.dark, 0, 0, W, 74);
  y = 38; text("Bet", { size: 24, bold: true, col: C.white }); text("IQ", { x: M + 3 * 0.6 * 24, size: 24, bold: true, col: C.gold });
  y = 56; text("ANALYZE · PREDICT · BET SMART", { size: 6.5, col: "0.7 0.78 0.72" });
  y = 98; text("PICK RECEIPT", { x: W / 2, size: 13, bold: true, align: "center" });
  y += 13; text("No. " + r.id, { x: W / 2, size: 8.5, col: C.grey, align: "center" });
  y += 12; text(dayLabel(r.t), { x: W / 2, size: 9, align: "center" });
  y += 12; rect(r.open ? C.amber : C.green, W / 2 - 62, y, 124, 18);
  y += 12.5; text(r.open ? `ONGOING · ${r.openCount} PENDING` : "FINISHED", { x: W / 2, size: 8, bold: true, col: C.white, align: "center" });
  y += 17;
  if (r.open) { text("Picks settle automatically when matches end.", { x: W / 2, size: 6.5, col: C.grey, align: "center" }); y += 8; text("Download again later for the final result.", { x: W / 2, size: 6.5, col: C.grey, align: "center" }); y += 12; }
  if (who) { text("Player", { size: 8, col: C.grey }); text(wrap(who, 36, 1)[0], { x: W - M, size: 8, align: "right" }); y += 11; }
  text("Printed", { size: 8, col: C.grey }); text(dateTimeLabel(now), { x: W - M, size: 8, align: "right" });
  y += 10; rule(true); y += 15;

  // picks
  r.picks.forEach((p, i) => {
    wrap(`${i + 1}. ${p.home} vs ${p.away}`, 48).forEach((ln) => { text(ln, { size: 9, bold: true }); y += 11; });
    const lg = leagueName(p.league); if (lg) { text(wrap(lg, 60, 1)[0], { size: 7.5, col: C.grey }); y += 10; }
    wrap(`${MARKETS[pickMarket(p)]?.label ?? ""}: ${pickLabel(p)}${p.prob != null ? ` (${pct(p.prob)})` : ""}`, 55).forEach((ln) => { text(ln, { size: 8 }); y += 10; });
    const odds = p.odds ? `Odds ${p.odds.toFixed(2)}${p.stake ? ` · Stake ${p.stake}` : ""}` : "";
    if (odds) text(odds, { size: 8, col: C.grey });
    text(statusOf(p), { x: W - M, size: 8, bold: true, align: "right", col: p.won != null ? (p.won ? C.green : C.red) : p.live ? C.red : C.amber });
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

  const H = Math.ceil(y), body = ops.map((o) => o(H)).join("\n");
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

export function downloadReceipt(r, opts) {
  const url = URL.createObjectURL(new Blob([receiptPdf(r, opts)], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `betiq-receipt-${r.key}.pdf` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
