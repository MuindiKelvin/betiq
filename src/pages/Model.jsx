import { useState } from "react";
import { Alert, Button, Card, Table } from "react-bootstrap";
import { useLeague } from "../lib/data";
import { backtest } from "../lib/model";
import { pct } from "../lib/util";
import CompSelect from "../components/CompSelect";
import { Load, Spin } from "../components/ui";

const ROWS = [["base", "Baseline", "Always uses the league's overall home/draw/away frequencies"], ["strength", "Team strength only", "Poisson model: attack/defence, home/away, time-weighted"],
  ["form", "+ Recent form", "Adds the small form adjustment"], ["full", "+ Head-to-head (BetIQ)", "Adds the head-to-head adjustment: what the app uses"]];

function Report({ lg }) {
  const [res, setRes] = useState(undefined);
  const run = () => { setRes(null); setTimeout(() => setRes(backtest(lg.results, { limit: 150 }) ?? false), 30); };
  return (
    <Card><Card.Body>
      <p className="text-body-secondary">Replays the most recent matches: for each one, the model sees <strong>only the matches played before it</strong>, predicts the result, and is scored against what really happened. Lower log-loss / Brier is better.</p>
      <Button variant="primary" onClick={run} disabled={res === null}><i className="bi bi-play-fill me-1" />Run backtest</Button>
      {res === null && <Spin />}
      {res === false && <Alert variant="info" className="mt-3 mb-0">Not enough history for a backtest yet (needs about 20 matches where both teams already have 10+ games). Let the data sync load more seasons.</Alert>}
      {res && (<>
        <div className="table-responsive mt-3"><Table className="align-middle mb-2">
          <thead><tr><th>Model ({res.n} matches)</th><th className="text-end">Accuracy</th><th className="text-end">Log-loss</th><th className="text-end">Brier</th></tr></thead>
          <tbody>{ROWS.map(([k, l, sub]) => <tr key={k} className={k === "full" ? "table-active" : ""}><td>{l}<div className="tiny text-body-secondary">{sub}</div></td><td className="text-end">{pct(res[k].acc, 1)}</td><td className="text-end">{res[k].logloss.toFixed(3)}</td><td className="text-end">{res[k].brier.toFixed(3)}</td></tr>)}</tbody>
        </Table></div>
        <Alert variant={res.full.logloss < res.base.logloss ? "success" : "warning"} className="py-2 small">
          {res.full.logloss < res.base.logloss ? `BetIQ beats the naive baseline on log-loss (${res.full.logloss.toFixed(3)} vs ${res.base.logloss.toFixed(3)}).` : "BetIQ does not beat the naive baseline here. Treat predictions with extra caution."}
          {" "}{res.full.logloss > res.strength.logloss + 0.002 && "The form/head-to-head nudges are not helping on this data; you can set formK / h2hK to 0 in src/lib/model.js."}
        </Alert>
        <h2 className="h6 text-uppercase text-body-secondary ls mt-3">Calibration: when BetIQ says X%, how often is it right?</h2>
        <div className="table-responsive"><Table size="sm" className="mb-2"><thead><tr><th>Top probability</th><th className="text-end">Matches</th><th className="text-end">Predicted</th><th className="text-end">Actual</th></tr></thead>
          <tbody>{res.bins.map((b) => <tr key={b.lo}><td>{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</td><td className="text-end">{b.n}</td><td className="text-end">{b.avg != null ? pct(b.avg) : "–"}</td><td className="text-end">{b.hit != null ? pct(b.hit) : "–"}</td></tr>)}</tbody></Table></div>
        <p className="small text-body-secondary mb-0">Small samples are noisy: a few matches either way moves these numbers a lot. Football is high-variance; even good models are right about half the time on 1X2.</p>
      </>)}
    </Card.Body></Card>
  );
}

export default function Model({ d }) {
  const leagues = d.entries.filter((e) => e.kind === "league"), [code, setCode] = useState(leagues[0]?.code);
  const s = useLeague(code);
  return (
    <div className="d-flex flex-column gap-3">
      <div><h1 className="h3 mb-1">Model report card</h1><p className="text-body-secondary mb-0">Do not take our word for it: test how well the predictions would have performed on past matches.</p></div>
      <div style={{ maxWidth: 380 }}><CompSelect entries={leagues} value={code} onChange={setCode} /></div>
      {code ? <Load s={s}>{(lg) => <Report key={code} lg={lg} />}</Load> : <p className="text-body-secondary">No league has been loaded yet.</p>}
    </div>
  );
}
