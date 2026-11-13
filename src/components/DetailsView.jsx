import { Badge, Card, Col, Row } from "react-bootstrap";

const min = (e) => (e.m == null ? "" : `${e.m}${e.x ? "+" + e.x : ""}'`);
const POS = { G: "GK", D: "DF", M: "MF", F: "FW" };
const Head = ({ icon, children }) => <h2 className="h5 mb-3"><i className={`bi bi-${icon} me-2 text-primary`} />{children}</h2>;

// Events listed in time order; home events on the left, away on the right.
function Timeline({ rows, render }) {
  return rows.map((e, i) => (
    <div key={i} className="tl-row">
      <div className="tl-side text-end">{e.s === "h" && render(e)}</div>
      <div className="tl-min">{min(e)}</div>
      <div className="tl-side">{e.s === "a" && render(e)}</div>
    </div>
  ));
}
const goalText = (e) => (
  <span><i className="bi bi-circle-fill me-1 goal-dot" /><strong>{e.p ?? "Unknown"}</strong>{e.k === "pen" && <Badge bg="secondary" className="ms-1">pen</Badge>}{e.k === "og" && <Badge bg="danger" className="ms-1">own goal</Badge>}{e.a && <span className="d-block tiny text-body-secondary">assist {e.a}</span>}</span>
);
const cardText = (e) => (
  <span><span className={"card-icon " + (e.k === "y" ? "yellow" : "red")} />{e.p ?? "Unknown"}{e.k === "yr" && <span className="tiny text-body-secondary"> (2nd yellow)</span>}</span>
);

function Sheet({ name, sheet }) {
  if (!sheet) return null;
  const xi = sheet.players.filter((p) => !p.sub), subs = sheet.players.filter((p) => p.sub);
  const Line = ({ p }) => (
    <li className="d-flex align-items-center gap-2 py-1">
      <span className="num-badge">{p.num ?? "–"}</span><span className="flex-fill text-truncate">{p.n}{p.cap && <span className="text-primary ms-1">(C)</span>}</span>
      {p.pos && <span className="tiny text-body-secondary">{POS[p.pos] ?? p.pos}</span>}
    </li>
  );
  return (
    <>
      <div className="d-flex align-items-center mb-2"><strong className="me-auto">{name}</strong>{sheet.formation && <Badge bg="dark" className="border">{sheet.formation}</Badge>}</div>
      <div className="tiny text-uppercase text-body-secondary ls">Starting XI</div>
      <ul className="list-unstyled mb-2">{xi.map((p, i) => <Line key={i} p={p} />)}</ul>
      {subs.length > 0 && <><div className="tiny text-uppercase text-body-secondary ls">Substitutes</div><ul className="list-unstyled mb-2">{subs.map((p, i) => <Line key={i} p={p} />)}</ul></>}
      {sheet.missing.length > 0 && <><div className="tiny text-uppercase text-body-secondary ls">Unavailable</div><ul className="list-unstyled small mb-0">{sheet.missing.map((m, i) => <li key={i}>{m.n}</li>)}</ul></>}
    </>
  );
}

// details: the synced "details" document. h / a: team names. finished: match already played.
export default function DetailsView({ details, h, a, finished, timeline = true }) {
  const { goals, cards, lineups } = details;
  return (
    <Row className="g-3">
      {finished && goals && timeline && (
        <Col xs={12} lg={lineups ? 6 : 12}><Card className="h-100"><Card.Body>
          <Head icon="record-circle">Goals</Head>
          <div className="tl-head"><span className="text-end">{h}</span><span /><span>{a}</span></div>
          {goals.length ? <Timeline rows={goals} render={goalText} /> : <p className="text-body-secondary mb-0">No goals.</p>}
          {cards?.length > 0 && <><hr /><Head icon="file-earmark">Cards</Head><Timeline rows={cards} render={cardText} /></>}
        </Card.Body></Card></Col>
      )}
      {lineups ? (
        <Col xs={12} lg={finished && goals && timeline ? 6 : 12}><Card className="h-100"><Card.Body>
          <Head icon="people">Teamsheets</Head>
          {!lineups.confirmed && !finished && <p className="small text-body-secondary">Predicted lineups, not yet confirmed.</p>}
          <Row className="g-4"><Col xs={12} sm={6}><Sheet name={h} sheet={lineups.h} /></Col><Col xs={12} sm={6}><Sheet name={a} sheet={lineups.a} /></Col></Row>
        </Card.Body></Card></Col>
      ) : !finished && <Col xs={12}><Card><Card.Body className="text-body-secondary">Teamsheets are not published yet (usually about an hour before kickoff).</Card.Body></Card></Col>}
    </Row>
  );
}
