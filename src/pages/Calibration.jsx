import { useEffect, useState } from "react";
import { Alert, Card, Col, Row, Table } from "react-bootstrap";
import { loadPicks } from "../lib/picks";
import { MIN_PICKS, byMarket, calibrate, compare } from "../lib/calibration";
import { pct } from "../lib/util";
import { Spin, Stat } from "../components/ui";

const SOURCES = [
  ["prob", "BetIQ model", "Its probability for each side you saved"],
  ["myProb", "You", "The probability you entered when saving a pick"],
  ["mktProb", "Bookmaker, margin removed", "From the odds you entered for every outcome"],
];
const pts = (x) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(1) + " pts";

// Reliability chart: dots on the diagonal mean "when I say X%, it happens X% of the time"
function Chart({ bins }) {
  const X = (v) => 36 + v * 212, Y = (v) => 224 - v * 212;
  return (
    <svg viewBox="0 0 260 260" style={{ width: "100%", maxWidth: 320 }} role="img" aria-label="Calibration chart: stated probability against actual hit rate">
      <rect x={X(0)} y={Y(1)} width={212} height={212} fill="none" stroke="currentColor" strokeOpacity=".25" />
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="currentColor" strokeOpacity=".4" strokeDasharray="4 4" />
      {[0, 0.5, 1].map((v) => <g key={v}><text x={X(v)} y={240} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity=".7">{v * 100}%</text><text x={30} y={Y(v) + 3} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity=".7">{v * 100}%</text></g>)}
      <text x={X(0.5)} y={256} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity=".7">Stated probability</text>
      <text transform={`rotate(-90 8 ${Y(0.5)})`} x={8} y={Y(0.5)} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity=".7">Actual hit rate</text>
      {bins.filter((b) => b.n).map((b, i) => <circle key={b.lo} className="cal-dot" style={{ animationDelay: `${i * 90}ms` }} cx={X(b.avg)} cy={Y(b.hit)} r={4 + Math.min(6, Math.sqrt(b.n))} fill="var(--bs-primary)" fillOpacity=".85"><title>{`${Math.round(b.avg * 100)}% stated, ${Math.round(b.hit * 100)}% won (${b.n} picks)`}</title></circle>)}
    </svg>
  );
}

// Hit rate per market: where the source is right more or less often than it says.
function Markets({ rows, field }) {
  const list = byMarket(rows, field);
  if (list.length < 2) return null;
  return (
    <div className="table-responsive mt-3"><Table size="sm" className="mb-0">
      <thead><tr><th>Market</th><th className="text-end">Picks</th><th className="text-end">Won</th><th className="text-end">Hit rate</th><th className="text-end">Avg stated</th></tr></thead>
      <tbody>{list.map((m) => <tr key={m.key}><td>{m.label}</td><td className="text-end">{m.n}</td><td className="text-end">{m.won}</td><td className="text-end">{pct(m.hit)}</td><td className="text-end">{pct(m.avg)}</td></tr>)}</tbody>
    </Table></div>
  );
}

function Source({ rows, field, title, sub }) {
  const c = calibrate(rows, field);
  if (!c) return null;
  const v = Math.abs(c.gap) < 0.03 ? ["success", "Well calibrated: the probabilities match what happened."]
    : c.gap > 0 ? ["warning", `Overconfident: probabilities averaged ${pct(c.avg, 1)}, but ${pct(c.hit, 1)} of picks won.`]
    : ["info", `Underconfident: probabilities averaged ${pct(c.avg, 1)}, yet ${pct(c.hit, 1)} of picks won.`];
  return (
    <Card><Card.Body>
      <div className="d-flex align-items-baseline flex-wrap column-gap-2 mb-2"><h2 className="h5 mb-0">{title}</h2><span className="small text-body-secondary">{sub}</span></div>
      {c.n < MIN_PICKS ? <Alert variant="info" className="mb-0 py-2 small">{c.n} of {MIN_PICKS} settled picks so far. Scores appear after {MIN_PICKS}, because fewer are mostly noise.</Alert> : (<>
        <Row className="g-3 mb-3">
          <Col xs={6} md><Stat value={c.n} label="Picks scored" sub={`${c.won} won`} /></Col>
          <Col xs={6} md><Stat value={pct(c.hit, 1)} label="Hit rate" sub={`95% range ${pct(c.ci[0])}–${pct(c.ci[1])}`} /></Col>
          <Col xs={6} md><Stat value={c.brier.toFixed(3)} label="Brier score" sub="0 perfect · 0.250 = always 50%" /></Col>
          <Col xs={6} md><Stat value={(c.ece * 100).toFixed(1)} label="Calibration error (pts)" sub="lower is better" /></Col>
          <Col xs={6} md><Stat value={pts(c.gap)} label="Confidence − hit rate" sub="+ means overconfident" /></Col>
        </Row>
        <Alert variant={v[0]} className="py-2 small">{v[1]}</Alert>
        <Row className="g-3 align-items-center">
          <Col xs={12} md={5}><Chart bins={c.bins} /></Col>
          <Col xs={12} md={7}><div className="table-responsive"><Table size="sm" className="mb-0">
            <thead><tr><th>Stated</th><th className="text-end">Picks</th><th className="text-end">Avg stated</th><th className="text-end">Won</th></tr></thead>
            <tbody>{c.bins.map((b) => <tr key={b.lo}><td>{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</td><td className="text-end">{b.n}</td><td className="text-end">{b.n ? pct(b.avg) : "–"}</td><td className="text-end">{b.n ? pct(b.hit) : "–"}</td></tr>)}</tbody>
          </Table></div></Col>
        </Row>
        {field === "prob" && <Markets rows={rows} field={field} />}
      </>)}
    </Card.Body></Card>
  );
}

function Versus({ rows }) {
  const list = [["prob", "myProb", "BetIQ model", "You"], ["prob", "mktProb", "BetIQ model", "Bookmaker"]]
    .map(([a, b, na, nb]) => ({ c: compare(rows, a, b), na, nb })).filter((x) => x.c && x.c.n >= MIN_PICKS);
  if (!list.length) return null;
  return (
    <Card><Card.Body>
      <h2 className="h5 mb-1">Head to head</h2>
      <p className="small text-body-secondary">The same picks scored for both sides (Brier score, lower wins).</p>
      {list.map(({ c, na, nb }) => {
        const diff = c.a - c.b, w = Math.abs(diff) < 0.002 ? "Level" : diff < 0 ? na : nb;
        return <div key={nb} className="d-flex flex-wrap gap-3 py-2 border-top border-secondary-subtle"><span className="me-auto">{na} <strong>{c.a.toFixed(3)}</strong> vs {nb} <strong>{c.b.toFixed(3)}</strong> <span className="small text-body-secondary">({c.n} picks)</span></span><strong className={w === "Level" ? "" : "text-primary"}>{w === "Level" ? "Level" : `${w} sharper`}</strong></div>;
      })}
    </Card.Body></Card>
  );
}

export default function Calibration({ user }) {
  const [rows, setRows] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { loadPicks(user.uid).then(setRows).catch((e) => setErr(e.message)); }, [user]);
  const settled = rows ? rows.filter((r) => r.won != null) : [], any = SOURCES.some(([f]) => calibrate(settled, f));
  return (
    <div className="d-flex flex-column gap-3">
      <div><h1 className="h3 mb-1">Calibration</h1><p className="text-body-secondary mb-0">When a probability of 60% is stated, do about 60% of those picks win? This scores your settled picks, not just whether you won.</p></div>
      {err && <Alert variant="danger" className="mb-0">{err}</Alert>}
      {!rows && !err && <Spin />}
      {rows && !any && <Alert variant="secondary" className="mb-0">No settled picks yet. Save picks from Match Analysis; they settle after the match is played and the next data sync has run.</Alert>}
      {rows && any && (<>
        <Versus rows={settled} />
        {SOURCES.map(([field, title, sub]) => <Source key={field} rows={settled} field={field} title={title} sub={sub} />)}
        {!calibrate(settled, "myProb") && <Alert variant="light" className="py-2 small mb-0"><i className="bi bi-lightbulb me-2" />Type your own probability (the “Your %” box) when saving a pick to see whether you beat the model.</Alert>}
        <p className="small text-body-secondary mb-0">Only picks you saved are scored, so this reflects your selection of bets, not every match. Small samples are noisy.</p>
      </>)}
    </div>
  );
}
