import { Alert, Badge, Button, Card, Col, Row, Table } from "react-bootstrap";
import { loadManagers, loadReferees, useDoc } from "../lib/data";
import { byIdMap, cardsOf, profileRec, useEntity } from "../lib/people";
import { first, fmtVal, humanize } from "../lib/util";
import { Crest, ManagerPhoto, Spin, Stat, VenuePhoto } from "../components/ui";

const Back = ({ onBack }) => <div><Button size="sm" variant="outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-1" />Back</Button></div>;

// every scalar field of a profile (field names vary), the ones matching `lead` first
function Facts({ prof, lead = [] }) {
  const keys = Object.keys(prof).filter((k) => !/(^id$|_id$|^name$|^updated)/i.test(k) && typeof prof[k] !== "object" && prof[k] !== "");
  const rank = (k) => { const i = lead.findIndex((re) => re.test(k)); return i < 0 ? 99 : i; };
  keys.sort((a, b) => rank(a) - rank(b));
  if (!keys.length) return null;
  return <Row className="g-2">{keys.slice(0, 24).map((k) => <Col xs={6} md={4} lg={3} key={k}><Card className="h-100"><Card.Body className="py-2"><div className="tiny text-uppercase text-body-secondary ls">{humanize(k)}</div><div className="fw-semibold">{fmtVal(k, prof[k])}</div></Card.Body></Card></Col>)}</Row>;
}
function Pending({ st, request, what }) {
  if (st.loading) return <Spin />;
  if (st.err) return <Alert variant="danger">{st.err}</Alert>;
  if (st.pack) return null;
  return (
    <Card><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
      <i className="bi bi-person-vcard fs-3 text-primary" />
      <div className="flex-fill" style={{ minWidth: 220 }}><div className="fw-semibold">{what}</div><div className="small text-body-secondary">{st.queued ? "Requested. It appears after the next data sync (usually within 30 minutes)." : "Not loaded yet. Request it and the next data sync fetches it."}</div></div>
      <Button variant="primary" disabled={st.queued || st.busy} onClick={request}>{st.queued ? "Requested" : "Load profile"}</Button>
    </Card.Body></Card>
  );
}
const ppm = (v) => (v == null ? "–" : Number(v).toFixed(2));
const rec = (r) => (r && r.matches ? `${r.wins ?? "–"}-${r.draws ?? "–"}-${r.losses ?? "–"}` : "–");

export function Manager({ ent, d, nav, onBack }) {
  const { id, code } = ent, { st, request } = useEntity("manager", id, code), list = useDoc(() => (code ? loadManagers(code) : null), code);
  const row = list.data?.list?.find((r) => Number(r.id) === id) ?? ent.row ?? {}, prof = { ...row, ...(st.pack?.profile ?? {}) };
  const name = first(prof, "name") ?? ent.name ?? `Manager ${id}`, teamId = Number(first(prof, "team_id", "current_team_id", "club_id")) || null, teamName = first(prof, "team", "team_name", "club");
  const career = st.pack?.career ?? [], r = st.pack?.rec ?? profileRec(prof);
  return (
    <div className="d-flex flex-column gap-3">
      <Back onBack={onBack} />
      <Card className="pitch"><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
        <ManagerPhoto id={id} name={name} size={88} />
        <div className="me-auto"><h1 className="h3 mb-1">{name}</h1>
          {(teamId || teamName) && <Button variant="link" className="p-0 d-inline-flex align-items-center gap-2" onClick={() => teamId && nav.team(teamId, d.byId[teamId]?.league ?? code)}><Crest team={{ id: teamId, name: teamName }} size={22} />{teamName ?? d.byId[teamId]?.name}</Button>}
          <div className="small text-body-secondary mt-1">{[first(prof, "nationality", "nationality_code"), first(prof, "preferred_formation") && `Prefers ${first(prof, "preferred_formation")}`, first(prof, "tactical_profile"), first(prof, "team_style")].filter(Boolean).join(" · ")}</div></div>
        {r && r.matches ? <div className="d-flex gap-4"><Stat value={r.matches} label="Matches" /><Stat value={rec(r)} label="W-D-L" /><Stat value={ppm(r.ppm)} label="Pts / match" /></div> : null}
      </Card.Body></Card>
      <Pending st={st} request={request} what="Career by club and the effect of his appointments" />
      <Facts prof={prof} lead={[/formation/i, /tactical|style/i, /match|win|ppm/i]} />
      {career.length > 0 && (
        <Card><Card.Body>
          <h2 className="h5 mb-3">Career by spell</h2>
          <div className="table-responsive"><Table size="sm" hover className="align-middle mb-2">
            <thead><tr><th>Club</th><th>Period</th><th className="text-center">P</th><th className="text-center">W-D-L</th><th className="text-center d-none d-md-table-cell">GF:GA</th><th className="text-center">Pts/m</th><th className="text-center d-none d-md-table-cell">Home</th><th className="text-center d-none d-md-table-cell">Away</th><th>Appointment effect</th></tr></thead>
            <tbody>{career.map((s, i) => {
              const start = first(s, "date_from", "start_date", "from", "start"), end = first(s, "date_to", "end_date", "to", "end"), club = first(s, "team", "team_name", "club", "club_name"), cid = Number(first(s, "team_id", "club_id")) || null;
              return (
                <tr key={i} role={cid ? "button" : undefined} onClick={cid ? () => nav.team(cid, d.byId[cid]?.league ?? code) : undefined}>
                  <td className="fw-medium">{club ?? "–"}</td><td className="text-nowrap small">{start ? `${fmtVal("date", start)} – ${end ? fmtVal("date", end) : "now"}` : "–"}</td>
                  <td className="text-center">{s.rec?.matches ?? "–"}</td><td className="text-center">{rec(s.rec)}</td><td className="text-center d-none d-md-table-cell">{s.rec?.goals_for != null ? `${s.rec.goals_for}:${s.rec.goals_against}` : "–"}</td>
                  <td className="text-center fw-bold">{ppm(s.rec?.ppm)}</td><td className="text-center d-none d-md-table-cell">{ppm(s.home?.ppm)}</td><td className="text-center d-none d-md-table-cell">{ppm(s.away?.ppm)}</td>
                  <td className="small">{s.ae ? <span title={`Club points per match in the ${s.ae.window ?? ""} matches before his appointment vs the same number from it`}>{ppm(s.ae.before.ppm)} → {ppm(s.ae.after.ppm)} <Badge bg={s.ae.ppm_change >= 0 ? "success" : "danger"}>{s.ae.ppm_change > 0 ? "+" : ""}{s.ae.ppm_change == null ? "" : ppm(s.ae.ppm_change)}</Badge></span> : <span className="text-body-secondary">n/a</span>}</td>
                </tr>);
            })}</tbody>
          </Table></div>
          <p className="tiny text-body-secondary mb-0">Appointment effect compares the club's points per match before he arrived with the same number of matches after (ending with his tenure). It is "n/a" when the spell has no start date or one side has no matches; nothing is guessed.</p>
        </Card.Body></Card>)}
      {st.pack && <div className="tiny text-body-secondary">Updated {fmtVal("date", st.pack.updated)}.</div>}
    </div>
  );
}

export function Referee({ ent, onBack }) {
  const { id, code } = ent, { st, request } = useEntity("referee", id, code), list = useDoc(() => (code ? loadReferees(code) : null), code);
  const row = ent.row ?? byIdMap(list.data)[id], prof = { ...(row ?? {}), ...(st.pack?.profile ?? {}) }, c = cardsOf(prof);
  const name = first(prof, "name") ?? ent.name ?? `Referee ${id}`;
  return (
    <div className="d-flex flex-column gap-3">
      <Back onBack={onBack} />
      <Card className="pitch"><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
        <i className="bi bi-person-badge fs-1 text-primary" />
        <div className="me-auto"><h1 className="h3 mb-1">{name}</h1><div className="small text-body-secondary">{[first(prof, "country", "country_code"), c.n != null && `${c.n} matches`].filter(Boolean).join(" · ")}</div></div>
        {(c.y != null || c.r != null) && <div className="d-flex gap-4">{c.y != null && <Stat value={c.y.toFixed(2)} label="Yellow / match" />}{c.r != null && <Stat value={c.r.toFixed(2)} label="Red / match" />}</div>}
      </Card.Body></Card>
      {!row && <Pending st={st} request={request} what="Per-match aggregates: cards, fouls and goals" />}
      <Facts prof={prof} lead={[/^matches$/i, /avg_yellow/i, /avg_red/i, /avg_foul/i, /avg_goals/i, /total_/i]} />
      <p className="small text-body-secondary mb-0">Cards markets are not quoted in the odds feed, so these averages are a research input, not something to price against.</p>
    </div>
  );
}

export function Venue({ ent, d, nav, onBack }) {
  const { id, code } = ent, { st, request } = useEntity("venue", id, code), prof = { ...(ent.row ?? {}), ...(st.pack?.profile ?? {}) };
  const name = first(prof, "name") ?? ent.name ?? `Venue ${id}`, home = Number(first(prof, "home_team_id", "team_id")) || null;
  return (
    <div className="d-flex flex-column gap-3">
      <Back onBack={onBack} />
      <Card className="pitch"><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
        <VenuePhoto id={id} name={name} size={88} />
        <div className="me-auto"><h1 className="h3 mb-1">{name}</h1><div className="small text-body-secondary">{[first(prof, "city"), first(prof, "country"), first(prof, "capacity") != null && `${Number(first(prof, "capacity")).toLocaleString()} seats`].filter(Boolean).join(" · ")}</div>
          {home && <Button variant="link" className="p-0 d-inline-flex align-items-center gap-2 mt-1" onClick={() => nav.team(home, d.byId[home]?.league ?? code)}><Crest team={{ id: home, name: first(prof, "home_team") }} size={22} />{first(prof, "home_team") ?? d.byId[home]?.name}</Button>}</div>
      </Card.Body></Card>
      <Pending st={st} request={request} what="Capacity, location and the competitions played here" />
      <Facts prof={prof} lead={[/capacity/i, /city/i, /country/i, /lat|lng|lon/i]} />
      {st.pack?.competitions?.length > 0 && <Card><Card.Body><h2 className="h5 mb-2">Competitions hosted</h2><div className="d-flex flex-wrap gap-2">{st.pack.competitions.map((c, i) => <Badge key={i} bg="secondary">{first(c, "name", "league_name") ?? `#${c.id}`}</Badge>)}</div></Card.Body></Card>}
    </div>
  );
}
