import { Card } from "react-bootstrap";
import { CompareRow } from "./ui";

// s = [HS,AS, HST,AST, HC,AC, HF,AF, HY,AY, HR,AR, HP,AP, HXG,AXG] (home/away pairs; null when the match did not report it)
const ROWS = [["Possession", 12, (x) => x + "%"], ["Expected goals (xG)", 14, (x) => x.toFixed(2)], ["Shots", 0], ["Shots on target", 2], ["Corners", 4], ["Fouls", 6], ["Yellow cards", 8], ["Red cards", 10]];
export default function MatchStatsView({ s, h, a, bare }) {
  const rows = ROWS.filter(([, i]) => s[i] != null && s[i + 1] != null);
  if (!rows.length) return null;
  const list = rows.map(([l, i, f]) => <CompareRow key={l} label={l} a={s[i]} b={s[i + 1]} fmt={f ?? ((x) => String(x))} />);
  if (bare) return <>{list}</>;
  return (
    <Card><Card.Body>
      <div className="d-flex align-items-center mb-3"><h2 className="h5 mb-0 me-auto"><i className="bi bi-bar-chart-line me-2 text-primary" />Match statistics</h2><span className="small"><strong>{h}</strong> vs <strong>{a}</strong></span></div>
      {list}
    </Card.Body></Card>
  );
}
