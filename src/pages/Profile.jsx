import { Button, Card, Col, ListGroup, Row } from "react-bootstrap";
import { dateTimeLabel } from "../lib/util";

export default function Profile({ user, d, onSignOut }) {
  return (
    <div className="d-flex flex-column gap-3">
      <h1 className="h3 mb-0">Profile</h1>
      <Card className="pitch"><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
        {user.photoURL ? <img src={user.photoURL} alt="" width="72" height="72" className="rounded-circle" referrerPolicy="no-referrer" /> : <span className="avatar-fallback" style={{ width: 72, height: 72, fontSize: 28 }}>{(user.displayName ?? "?")[0]}</span>}
        <div className="me-auto min-w-0"><div className="h4 mb-0 text-break">{user.displayName ?? "Account"}</div><div className="text-body-secondary text-break">{user.email}</div></div>
        <Button variant="outline-secondary" onClick={onSignOut}><i className="bi bi-box-arrow-left me-2" />Sign out</Button>
      </Card.Body></Card>
      <Card><Card.Header>Data loaded in your app</Card.Header>
        <ListGroup variant="flush" style={{ maxHeight: 360, overflow: "auto" }}>{d.entries.map((c) => (
          <ListGroup.Item key={c.code} className="d-flex align-items-center gap-3"><i className="bi bi-trophy text-primary" /><span className="flex-fill">{c.name}<span className="text-body-secondary small"> · {c.country || "International"}</span></span><span className="small text-body-secondary">{c.s?.teams ?? 0} teams · {c.s?.results ?? 0} results · {c.s?.fixtures ?? 0} fixtures</span></ListGroup.Item>))}</ListGroup>
        <Card.Footer className="small text-body-secondary">{d.entries.length} of {d.catalog.length} competitions loaded. Catalog updated {d.updated ? dateTimeLabel(Date.parse(d.updated) / 1000) : "never"}.</Card.Footer>
      </Card>
      <Row><Col><p className="small text-body-secondary mb-0">Your picks are private to your account. Sign out to switch accounts.</p></Col></Row>
    </div>
  );
}
