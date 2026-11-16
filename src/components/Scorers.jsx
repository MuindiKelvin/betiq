import { Alert, Badge } from "react-bootstrap";

const min = (e) => (e.m == null ? "" : `${e.m}${e.x ? "+" + e.x : ""}'`);
// Scorers and assists of a finished match from the synced goals document ({ g, ok, n }). Never shows "No goals" unless the score is 0-0.
export default function Scorers({ entry, hg, ag, h, a }) {
  const total = (hg ?? 0) + (ag ?? 0);
  if (!entry) return <p className="small text-body-secondary mb-0">Scorers and assists are loaded by the data sync after full time (usually within hours).</p>;
  if (!entry.g.length) return entry.ok === 1 ? <p className="text-body-secondary mb-0">No goals.</p> : <Alert variant="warning" className="mb-0 small">The data source lists no scorers for this match ({total} goal{total === 1 ? "" : "s"} were scored). It is checked again for a few days.</Alert>;
  const g = [...entry.g].sort((x, y) => (x.et ? 1 : 0) - (y.et ? 1 : 0) || (x.m ?? 0) - (y.m ?? 0) || (x.x ?? 0) - (y.x ?? 0));
  return (
    <>
      <div className="tl-head"><span className="text-end">{h}</span><span /><span>{a}</span></div>
      {g.map((e, i) => {
        const text = (
          <span><i className="bi bi-circle-fill me-1 goal-dot" /><strong>{e.p ?? "Unknown"}</strong>{e.k === "pen" && <Badge bg="secondary" className="ms-1">pen</Badge>}{e.k === "og" && <Badge bg="danger" className="ms-1">own goal</Badge>}{e.et && <Badge bg="dark" className="ms-1 border">extra time</Badge>}{e.a && <span className="d-block tiny text-body-secondary">assist {e.a}</span>}</span>);
        return <div key={i} className="tl-row"><div className="tl-side text-end">{e.s === "h" && text}</div><div className="tl-min">{min(e)}</div><div className="tl-side">{e.s === "a" && text}</div></div>;
      })}
      {entry.ok !== 1 && <p className="tiny text-warning mt-2 mb-0">Incomplete: the data source lists {entry.n} of the {total} goals scored in 90 minutes. It is checked again for a few days.</p>}
    </>
  );
}
