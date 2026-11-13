import { useEffect, useState } from "react";

// Pitch views: starting XI by formation (schematic), average positions and shot map (real data from the match statistics).
// On narrow screens the pitch is drawn upright (portrait) so shirt numbers and names stay readable.
function useNarrow(max = 767) {
  const q = `(max-width: ${max}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q), f = () => setNarrow(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [q]);
  return narrow;
}
const RANK = { G: 0, D: 1, M: 2, F: 3 };

// One side in "own half" coordinates: x 0 = own goal line .. 1 = halfway, y 0..1 across the pitch.
export function layoutSide(sheet) {
  const xi = (sheet?.players ?? []).filter((p) => !p.sub);
  if (!xi.length) return [];
  const sorted = xi.map((p, i) => ({ p, i })).sort((a, b) => (RANK[a.p.pos] ?? 2) - (RANK[b.p.pos] ?? 2) || a.i - b.i).map((x) => x.p);
  const gk = sorted[0]?.pos === "G" ? [sorted.shift()] : [];
  let lines = (sheet.formation ?? "").split("-").map(Number);
  const total = (l) => l.reduce((a, b) => a + b, 0);
  if (!lines.length || lines.some((n) => !n) || total(lines) !== sorted.length) {
    lines = [1, 2, 3].map((r) => sorted.filter((p) => (RANK[p.pos] ?? 2) === r).length).filter(Boolean);   // fall back to listed positions
    if (total(lines) !== sorted.length) lines = [sorted.length];
  }
  const out = gk.map((p) => ({ p, x: 0.08, y: 0.5 }));
  let k = 0;
  lines.forEach((n, li) => {
    for (let j = 0; j < n; j++) out.push({ p: sorted[k++], x: lines.length === 1 ? 0.6 : 0.3 + (0.62 * li) / (lines.length - 1), y: (j + 1) / (n + 1) });
  });
  return out;
}

const surname = (n = "") => { const w = n.trim().split(/\s+/); return (w.length > 1 && w[0].length <= 3 && /\.$/.test(w[0]) ? w.slice(1).join(" ") : w[w.length - 1] ?? "").slice(0, 9); };
const COL = { h: "#ef4444", a: "#3b82f6" };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Average positions: x,y are 0..100. Place each team so its goalkeeper (or, lacking one, its mean position) is on its own side:
// home on the left, away on the right. Works whether the feed uses an own-attack frame or absolute coordinates.
export function placeAvg(list, wantLeft) {
  const pts = (list ?? []).map((p) => ({ ...p, px: p.x * 1.05, py: p.y * 0.68 }));
  if (!pts.length) return [];
  const gk = pts.find((p) => p.pos === "G"), ref = gk ? gk.px : pts.reduce((a, p) => a + p.px, 0) / pts.length;
  return (ref < 52.5) === wantLeft ? pts : pts.map((p) => ({ ...p, px: 105 - p.px, py: 68 - p.py }));
}
// Shots: both teams attack opposite goals (home to the right). Orientation is detected per team from where its shots are.
export function placeShots(list, attackRight) {
  const pts = (list ?? []).map((s) => ({ ...s, px: s.x * 1.05, py: s.y * 0.68 }));
  if (!pts.length) return [];
  return (med(pts.map((p) => p.px)) > 52.5) === attackRight ? pts : pts.map((p) => ({ ...p, px: 105 - p.px, py: 68 - p.py }));
}

function PitchSvg({ tall, label, children }) {
  return (
    <svg viewBox={tall ? "0 0 68 105" : "0 0 105 68"} className={"pitch-svg" + (tall ? " pitch-tall" : "")} role="img" aria-label={label}>
      <g transform={tall ? "translate(68 0) rotate(90)" : undefined}>
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" fill={i % 2 ? "#2f7d32" : "#2a7230"} />)}
        <g fill="none" stroke="rgba(255,255,255,.85)" strokeWidth=".35">
          <rect x="1" y="1" width="103" height="66" /><line x1="52.5" y1="1" x2="52.5" y2="67" /><circle cx="52.5" cy="34" r="9.15" />
          <rect x="1" y="13.85" width="16.5" height="40.3" /><rect x="87.5" y="13.85" width="16.5" height="40.3" />
          <rect x="1" y="24.85" width="5.5" height="18.3" /><rect x="98.5" y="24.85" width="5.5" height="18.3" />
        </g>
      </g>
      {children}
    </svg>
  );
}
const Dot = ({ x, y, color, num, name, r = 3.1 }) => (
  <g><title>{name}</title><circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth=".3" />
    {num != null && <text x={x} y={y + 1.1} textAnchor="middle" fontSize="3" fontWeight="700" fill="#fff">{num}</text>}
    <text x={x} y={y + r + 3} textAnchor="middle" fontSize="2.3" fill="#fff" stroke="rgba(0,0,0,.55)" strokeWidth=".5" paintOrder="stroke">{surname(name)}</text></g>
);

export default function Pitch({ lineups, details, h, a }) {
  const tall = useNarrow();
  const avg = details?.avgpos, shots = details?.shots?.length ? details.shots : null;
  const views = [lineups && ["form", "Formation"], avg && ["avg", "Average positions"], shots && ["shots", "Shot map"]].filter(Boolean);
  const [pick, setPick] = useState(null), view = views.find((v) => v[0] === pick) ? pick : views[0]?.[0];
  const turn = ([x, y]) => (tall ? [68 - y, x] : [x, y]);          // landscape coordinates -> upright (rotated 90° clockwise)
  const T = (px, py) => turn([px, py]);
  if (!views.length) return null;
  const note = { form: "Schematic: starting XI by formation, not real player positions.", avg: "Average positions during the match (from match tracking data).", shots: "Shots: size = expected goals (xG), ringed = goal." }[view];
  return (
    <div>
      {views.length > 1 && <div className="btn-group btn-group-sm mb-2 flex-wrap" role="group">{views.map(([k, l]) => <button key={k} type="button" className={"btn " + (view === k ? "btn-primary" : "btn-outline-secondary")} onClick={() => setPick(k)}>{l}</button>)}</div>}
      <PitchSvg tall={tall} label={note}>
        {view === "form" && [["h", lineups?.h, (x, y) => [2 + x * 50, y * 68]], ["a", lineups?.a, (x, y) => [103 - x * 50, (1 - y) * 68]]].map(([k, sheet, map]) => layoutSide(sheet).map(({ p, x, y }, i) => {
          const [px, py] = T(...map(x, y)); return <Dot key={k + i} x={px} y={py} color={COL[k]} num={p.num} name={p.n ?? ""} />;
        }))}
        {view === "avg" && [["h", placeAvg(avg?.h, true)], ["a", placeAvg(avg?.a, false)]].map(([k, list]) => list.map((p, i) => { const [px, py] = T(p.px, p.py); return <Dot key={k + i} x={px} y={py} color={COL[k]} name={p.n ?? ""} />; }))}
        {view === "shots" && [["h", placeShots(shots.filter((x) => x.h), true)], ["a", placeShots(shots.filter((x) => !x.h), false)]].map(([k, list]) => list.map((sh, i) => {
          const [px, py] = T(sh.px, sh.py), goal = sh.k === "goal", r = Math.min(3.8, Math.max(1.2, 1.2 + (sh.xg ?? 0.08) * 7));
          return <g key={k + i}><title>{`${sh.m ?? "?"}' ${sh.k ?? "shot"}${sh.xg != null ? ` · xG ${sh.xg}` : ""}`}</title><circle cx={px} cy={py} r={r} fill={COL[k]} fillOpacity={goal ? 0.95 : 0.55} stroke={goal ? "#fff" : COL[k]} strokeWidth={goal ? 0.6 : 0.25} /></g>;
        }))}
      </PitchSvg>
      <div className="d-flex justify-content-between small mt-2">
        <span><i className="legend-dot" style={{ background: COL.h }} />{h}{view === "form" && lineups?.h?.formation && <span className="text-body-secondary"> · {lineups.h.formation}</span>}</span>
        <span>{view === "form" && lineups?.a?.formation && <span className="text-body-secondary">{lineups.a.formation} · </span>}{a}<i className="legend-dot ms-2" style={{ background: COL.a }} /></span>
      </div>
      <div className="tiny text-body-secondary mt-1">{note}</div>
    </div>
  );
}
