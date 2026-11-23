import { useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Accordion, Alert, Button, Card, Col, Nav, Row } from "react-bootstrap";
import { auth, db } from "../lib/firebase";
import { fresh } from "../lib/data";
import { ageOf, first, fmtVal, humanize } from "../lib/util";
import DataTable from "../components/DataTable";
import { Crest, PlayerPhoto, Spin } from "../components/ui";
import { useEffect } from "react";

const FACTS = [["Nationality", ["nationality", "nationality_code", "country", "country_code"]], ["Position", ["position", "pos"]], ["Shirt number", ["shirt_number", "jersey_number", "number"]], ["Height", ["height"]], ["Weight", ["weight"]],
  ["Preferred foot", ["preferred_foot", "foot"]], ["Market value", ["market_value", "market_value_eur"]], ["Contract until", ["contract_until", "contract_expires", "contract_end"]]];

export default function Player({ player, d, nav, onBack }) {
  const { id, code } = player, [st, setSt] = useState({ loading: true }), [tab, setTab] = useState("career");
  useEffect(() => {
    let on = true;
    setSt({ loading: true });
    (async () => {
      try { const pack = await fresh("players", id); on && setSt(pack ? { pack } : { queued: !!(await fresh("requests", "p_" + id)) }); }
      catch (e) { on && setSt({ err: e.message }); }
    })();
    return () => { on = false; };
  }, [id]);
  async function request() {
    setSt((s) => ({ ...s, busy: true }));
    try { await setDoc(doc(db, "requests", "p_" + id), { kind: "player", league: code, pid: id, at: serverTimestamp(), uid: auth.currentUser?.uid }); setSt({ queued: true }); }
    catch (e) { setSt({ err: "Could not queue the request: " + e.message }); }
  }
  const pack = st.pack, prof = { ...(player.row ?? {}), ...(pack?.profile ?? {}) };
  const name = first(prof, "name", "player_name") ?? player.name ?? `Player ${id}`;
  const teamId = Number(first(prof, "team_id", "current_team_id")) || player.teamId, teamName = first(prof, "team", "team_name");
  const dob = first(prof, "date_of_birth", "birth_date", "dob"), age = ageOf(dob);
  const shown = new Set(FACTS.flatMap(([, keys]) => keys).concat(["name", "player_name", "id", "team", "team_name", "team_id", "date_of_birth", "birth_date", "dob"]));
  const rest = Object.entries(prof).filter(([k, v]) => !shown.has(k) && !/_id$/.test(k) && typeof v !== "object");
  return (
    <div className="d-flex flex-column gap-3">
      <div><Button size="sm" variant="outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-1" />Back</Button></div>
      <Card className="pitch"><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
        <PlayerPhoto id={id} name={name} size={88} />
        <div className="me-auto"><h1 className="h3 mb-1">{name}</h1>
          {(teamId || teamName) && <Button variant="link" className="p-0 d-inline-flex align-items-center gap-2" onClick={() => teamId && nav.team(teamId, d.byId[teamId]?.league ?? code)}><Crest team={{ id: teamId, name: teamName }} size={22} />{teamName ?? d.byId[teamId]?.name}</Button>}
          <div className="small text-body-secondary mt-1">{[first(prof, "position"), age != null ? `${age} years` : null, dob ? fmtVal("date", dob) : null].filter(Boolean).join(" · ")}</div></div>
      </Card.Body></Card>
      {st.err && <Alert variant="danger">{st.err}</Alert>}
      {st.loading && <Spin />}
      <Row className="g-3">{FACTS.map(([l, keys]) => { const v = first(prof, ...keys); return v == null ? null : <Col xs={6} md={4} lg={3} key={l}><Card className="h-100"><Card.Body className="py-3"><div className="tiny text-uppercase text-body-secondary ls">{l}</div><div className="fw-semibold">{fmtVal(keys[0], v)}</div></Card.Body></Card></Col>; })}</Row>
      {!st.loading && !pack && !st.err && (
        <Card><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
          <i className="bi bi-person-vcard fs-3 text-primary" />
          <div className="flex-fill" style={{ minWidth: 220 }}><div className="fw-semibold">Full profile, career, transfers and recent matches</div><div className="small text-body-secondary">{st.queued ? "Requested. It appears after the next data sync (usually within 30 minutes)." : "Not loaded yet. Request it and the next data sync fetches this player."}</div></div>
          <Button variant="primary" disabled={st.queued || st.busy} onClick={request}>{st.queued ? "Requested" : "Load full profile"}</Button>
        </Card.Body></Card>)}
      {pack && (<>
        <Nav className="nav-underline flex-nowrap overflow-auto comp-tabs" activeKey={tab} onSelect={setTab}>{[["career", `Career (${pack.career.length})`], ["transfers", `Transfers (${pack.transfers.length})`], ["log", `Recent matches (${pack.log.length})`]].map(([k, l]) => <Nav.Item key={k}><Nav.Link eventKey={k}>{l}</Nav.Link></Nav.Item>)}</Nav>
        <Card><Card.Body>
          {tab === "career" && <DataTable rows={pack.career} pref={[["season", "season_name", "year"], ["team", "team_name"], ["league", "league_name", "competition"], "matches", "goals", "assists"]} max={8} empty="No career data." />}
          {tab === "transfers" && <DataTable rows={pack.transfers} pref={[["date", "transfer_date"], ["from_team", "from_team_name"], ["to_team", "to_team_name"], ["fee", "fee_eur", "amount"], ["type", "transfer_type"]]} max={6} empty="No transfers recorded." />}
          {tab === "log" && <DataTable rows={pack.log} pref={[["date", "event_date"], ["opponent", "opponent_name", "against"], ["minutes_played", "minutes"], "goals", "assists", "rating"]} max={8} empty="No recent match data." />}
        </Card.Body></Card>
        {rest.length > 0 && <Accordion><Accordion.Item eventKey="0"><Accordion.Header>All profile details</Accordion.Header><Accordion.Body><Row className="g-2">{rest.map(([k, v]) => <Col xs={6} md={4} key={k}><div className="tiny text-body-secondary">{humanize(k)}</div><div className="small">{fmtVal(k, v)}</div></Col>)}</Row></Accordion.Body></Accordion.Item></Accordion>}
        <div className="tiny text-body-secondary">Updated {fmtVal("date", pack.updated)}.</div>
      </>)}
    </div>
  );
}
