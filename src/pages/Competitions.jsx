import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { TOP } from "../lib/board";
import { stagger } from "../lib/motion";
import { LeagueLogo, Pager, SearchBox, hit, usePaged } from "../components/ui";

// Browse every competition the data source covers. Competitions that have been synced open; the rest are listed as "loading".
export default function Competitions({ d, nav }) {
  const [q, setQ] = useState(""), [all, setAll] = useState(false), [kind, setKind] = useState("all");
  const list = useMemo(() => d.catalog.filter((l) => (all || l.s?.at) && (kind === "all" || l.kind === kind) && (!q.trim() || hit(q, `${l.name} ${l.country}`)))
    .sort((a, b) => (a.country || "~").localeCompare(b.country || "~") || a.name.localeCompare(b.name)), [d.catalog, q, all, kind]);
  const pg = usePaged(list, 24, q + all + kind);
  const synced = d.entries.length, popular = TOP.map((id) => d.entries.find((l) => l.id === id)).filter(Boolean).slice(0, 8);
  return (
    <div className="d-flex flex-column gap-3">
      <p className="text-body-secondary mb-0">Choose a competition to see its matches, table, teams, squads, players and transfers. {synced} of {d.catalog.length} are loaded.</p>
      {popular.length > 0 && !q.trim() && <div className="d-flex flex-wrap gap-2" aria-label="Popular competitions">{popular.map((l) => <Button key={l.code} size="sm" variant="outline-secondary" className="d-inline-flex align-items-center gap-2" onClick={() => nav.comp(l.code)}><LeagueLogo lg={l} size={18} />{l.name}</Button>)}</div>}
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <SearchBox value={q} onChange={setQ} placeholder="Search competition or country" style={{ maxWidth: 340 }} />
        <Form.Select style={{ maxWidth: 190 }} aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All types</option><option value="league">Leagues</option><option value="comp">Cups &amp; international</option></Form.Select>
        <Form.Check type="switch" id="all-comps" label="Include not yet loaded" checked={all} onChange={(e) => setAll(e.target.checked)} />
      </div>
      {!list.length && <Alert variant="info" className="mb-0">{synced ? "No competition matches your filters." : "No competition has been loaded yet. Run the data sync (see README)."}</Alert>}
      <Row className="g-3">
        {pg.slice.map((l, n) => {
          const ready = !!l.s?.at && (l.s.results || l.s.fixtures);
          return (
            <Col xs={12} sm={6} xl={4} key={l.code}>
              <Card className={"h-100 comp-card rise" + (ready ? "" : " disabled")} style={stagger(n, 12)} role={ready ? "button" : undefined} tabIndex={ready ? 0 : undefined} onClick={ready ? () => nav.comp(l.code) : undefined}
                onKeyDown={ready ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); nav.comp(l.code); } } : undefined}>
                <Card.Body className="d-flex align-items-center gap-3">
                  <LeagueLogo lg={l} size={48} />
                  <div className="flex-fill" style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate">{l.name}</div>
                    <div className="small text-body-secondary text-truncate">{l.country || "International"}{l.women && " · women"}</div>
                    <div className="tiny text-body-secondary">{ready ? `${l.s.teams ?? 0} teams · ${l.s.results ?? 0} results · ${l.s.fixtures ?? 0} fixtures` : l.s?.err ? "Could not load, will retry" : "Loading soon"}</div>
                  </div>
                  {l.kind === "comp" && <Badge bg="dark" className="border">cup</Badge>}
                </Card.Body>
              </Card>
            </Col>);
        })}
      </Row>
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </div>
  );
}
