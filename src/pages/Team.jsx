import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Nav, Row, Table } from "react-bootstrap";
import { loadSquad, loadTransfers, useComp, useDoc, useLeague } from "../lib/data";
import { teamForm } from "../lib/model";
import { ageOf, first, fmtVal } from "../lib/util";
import DataTable from "../components/DataTable";
import { Crest, FormChips, Load, MatchList, PlayerPhoto, SearchBox, Spin, Stat, hit } from "../components/ui";

const GROUPS = [["G", "Goalkeepers"], ["D", "Defenders"], ["M", "Midfielders"], ["F", "Forwards"]];
const posOf = (p) => { const x = String(first(p, "position", "pos", "position_code") ?? "").trim().toUpperCase().slice(0, 1); return { G: "G", D: "D", M: "M", F: "F", A: "F" }[x] ?? "?"; };
const nameOf = (p) => first(p, "name", "player_name", "short_name") ?? "Unknown";
const numOf = (p) => first(p, "shirt_number", "jersey_number", "number", "jersey");
const availBadge = (p) => {
  const a = String(first(p, "availability", "status") ?? ""), inj = first(p, "injury_type");
  if (!a && !inj) return null;
  if (/^(available|fit|active|ok)$/i.test(a) && !inj) return null;
  const bad = /inj|out|susp|ban/i.test(a + " " + (inj ?? ""));
  return <Badge bg={bad ? "danger" : "warning"} text={bad ? undefined : "dark"} title={`${inj ?? ""}${p.injury_expected_return ? " · back " + fmtVal("date", p.injury_expected_return) : ""}`}>{inj || a}</Badge>;
};

function Squad({ players, code, nav }) {
  const [q, setQ] = useState("");
  const list = players.filter((p) => !q.trim() || hit(q, `${nameOf(p)} ${first(p, "nationality", "nationality_code", "country") ?? ""}`));
  if (!players.length) return <Alert variant="info" className="mb-0">The squad has not been loaded yet. It is refreshed by the data sync.</Alert>;
  return (
    <div className="d-flex flex-column gap-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search player" style={{ maxWidth: 300 }} />
      {[...GROUPS, ["?", "Others"]].map(([k, label]) => {
        const g = list.filter((p) => posOf(p) === k);
        return g.length ? (
          <Card key={k}><Card.Header>{label} <span className="text-body-secondary">({g.length})</span></Card.Header>
            <div className="table-responsive"><Table hover className="align-middle mb-0">
              <thead><tr><th style={{ width: 44 }}>#</th><th>Player</th><th className="d-none d-sm-table-cell">Nation</th><th className="d-none d-md-table-cell">Age</th><th className="d-none d-md-table-cell">Value</th><th>Status</th></tr></thead>
              <tbody>{g.map((p) => (
                <tr key={p.id} role="button" onClick={() => nav.player({ id: +p.id, code, name: nameOf(p), row: p })}>
                  <td className="text-body-secondary">{numOf(p) ?? "–"}</td>
                  <td><span className="d-flex align-items-center gap-2"><PlayerPhoto id={p.id} name={nameOf(p)} size={30} />{nameOf(p)}</span></td>
                  <td className="d-none d-sm-table-cell">{fmtVal("n", first(p, "nationality", "nationality_code", "country", "country_code"))}</td>
                  <td className="d-none d-md-table-cell">{ageOf(first(p, "date_of_birth", "birth_date", "dob")) ?? first(p, "age") ?? "–"}</td>
                  <td className="d-none d-md-table-cell">{fmtVal("market_value", first(p, "market_value", "market_value_eur"))}</td>
                  <td>{availBadge(p)}</td>
                </tr>))}</tbody>
            </Table></div></Card>) : null;
      })}
    </div>
  );
}

const AVG = [["ball_possession", "Possession", (x) => x + "%"], ["expected_goals", "xG", (x) => x.toFixed(2)], ["total_shots", "Shots"], ["shots_on_target", "On target"], ["corner_kicks", "Corners"], ["fouls", "Fouls"], ["yellow_cards", "Yellow"], ["red_cards", "Red"], ["offsides", "Offsides"]];

export default function Team({ team, d, nav, onBack }) {
  const { id, code } = team, [tab, setTab] = useState("overview");
  const c = useComp(code), sq = useDoc(() => loadSquad(id), id), lg = useLeague(code), tr = useDoc(() => loadTransfers(code), code);
  const entry = c.data?.teams.find((t) => t.id === id) ?? d.byId[id] ?? { id, name: `Team ${id}` };
  const comp = d.byCode[code], st = entry.st;
  const byId = useMemo(() => { const m = { ...d.byId }; for (const t of c.data?.teams ?? []) m[t.id] = { ...t, league: code }; return m; }, [d.byId, c.data, code]);
  const prof = sq.data?.profile ?? {}, facts = [["Venue", first(prof, "venue", "stadium", "venue_name")], ["Coach", first(prof, "coach", "manager", "coach_name")], ["Country", first(prof, "country") ?? entry.country], ["City", first(prof, "city")], ["Founded", first(prof, "founded", "founded_year")]].filter(([, v]) => v != null && v !== "");
  const formRes = lg.data ? teamForm(lg.data.results, id) : null;
  const tRows = (tr.data?.list ?? []).filter((r) => [r.from_team_id, r.to_team_id, r.team_id].includes(id) || [r.from_team, r.to_team].includes(entry.name));
  const tabs = [["overview", "Overview"], ["squad", `Squad${sq.data?.players?.length ? ` (${sq.data.players.length})` : ""}`], ["matches", "Matches"], ["transfers", "Transfers"]];
  return (
    <div className="d-flex flex-column gap-3">
      <div><Button size="sm" variant="outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-1" />Back</Button></div>
      <Card className="pitch"><Card.Body className="d-flex align-items-center gap-3 flex-wrap">
        <Crest team={entry} size={72} />
        <div className="me-auto"><h1 className="h3 mb-1">{entry.name}</h1><div className="text-body-secondary small">{comp?.name}{comp?.country ? ` · ${comp.country}` : ""}</div>
          {facts.length > 0 && <div className="d-flex flex-wrap gap-3 mt-2 small">{facts.map(([k, v]) => <span key={k}><span className="text-body-secondary">{k}: </span>{fmtVal(k, v)}</span>)}</div>}</div>
        <FormChips r={(formRes?.form ?? String(st?.form ?? "").slice(-5).split("").filter((x) => "WDL".includes(x)))} />
      </Card.Body></Card>
      <Nav className="nav-underline flex-nowrap overflow-auto comp-tabs" activeKey={tab} onSelect={setTab}>{tabs.map(([k, l]) => <Nav.Item key={k}><Nav.Link eventKey={k} className="text-nowrap">{l}</Nav.Link></Nav.Item>)}</Nav>
      {tab === "overview" && (st ? (<>
        <Row className="g-3">{[["Played", st.n], ["W-D-L", `${st.w}-${st.d}-${st.l}`], ["Goals", `${st.gf}:${st.ga}`], ["Pts / game", st.ppm]].map(([l, v]) => <Col xs={6} md={3} key={l}><Card className="h-100"><Card.Body><Stat value={v ?? "–"} label={l} /></Card.Body></Card></Col>)}</Row>
        <Card><Card.Body><h2 className="h6 text-uppercase text-body-secondary ls mb-3">Per game, last {st.n} matches</h2>
          <Row className="g-3 text-center">{AVG.filter(([k]) => st.avg?.[k] != null).map(([k, l, f]) => <Col xs={4} md={3} lg={2} key={k}><Stat value={f ? f(st.avg[k]) : st.avg[k]} label={l} /></Col>)}</Row></Card.Body></Card>
      </>) : <Alert variant="info" className="mb-0">Statistics for this team have not been loaded yet. The data sync refreshes a few hundred teams per run.</Alert>)}
      {tab === "squad" && (sq.err ? <Alert variant="danger">{sq.err}</Alert> : sq.data === undefined ? <Spin /> : <Squad players={sq.data?.players ?? []} code={code} nav={nav} />)}
      {tab === "matches" && <Load s={lg}>{(r) => <MatchList key={id} fixtures={(c.data?.fixtures ?? []).filter((f) => f.h === id || f.a === id).map((f) => ({ ...f, league: code }))} results={r.results.filter((x) => (comp?.kind === "comp" || x.s === 0) && (x.h === id || x.a === id)).map((x) => ({ ...x, league: code }))} byId={byId} onOpen={nav.open} />}</Load>}
      {tab === "transfers" && <Card><Card.Body>{tr.data === undefined ? <Spin /> : <DataTable rows={tRows} pref={[["player_name", "player", "name"], ["from_team", "from_team_name"], ["to_team", "to_team_name"], ["date", "transfer_date"], ["fee", "fee_eur", "amount"], ["type", "transfer_type"]]} max={6} nameKeys={["player_name", "player", "name"]} onRow={(r) => r.player_id != null && nav.player({ id: +r.player_id, code, name: first(r, "player_name", "player", "name") })} empty="No recent transfers involving this team in this competition." />}</Card.Body></Card>}
    </div>
  );
}
