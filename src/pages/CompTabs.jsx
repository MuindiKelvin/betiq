import { useMemo, useState } from "react";
import { Alert, Badge, Button, ButtonGroup, Card, Col, Row, Table } from "react-bootstrap";
import { loadLeaders, loadManagers, loadReferees, loadStandings, loadTransfers, useDoc, useLeague } from "../lib/data";
import { first, fmtVal, standings, upcoming } from "../lib/util";
import DataTable from "../components/DataTable";
import { Crest, Days, FormChips, Load, MatchList, Pager, PlayerPhoto, SearchBox, Spin, Stat, hit, usePaged } from "../components/ui";

const tagged = (list, code) => list.map((x) => ({ ...x, league: code }));
const resultsOf = (lg, comp) => (comp.kind === "comp" ? lg.results : lg.results.filter((r) => r.s === 0));
const Card2 = ({ title, icon, children, right }) => <Card className="h-100"><Card.Body><div className="d-flex align-items-center mb-3"><h2 className="h5 mb-0 me-auto"><i className={`bi bi-${icon} me-2 text-primary`} />{title}</h2>{right}</div>{children}</Card.Body></Card>;

/* ---------- table ---------- */
const ZONE = { promotion: "#19d38a", qualification: "#19d38a", champions: "#ffd23f", relegation: "#ff5d73", playoff: "#4cc9f0" };
const zoneColor = (z) => (z ? ZONE[String(z.t ?? z.k ?? "").toLowerCase()] ?? (/relegat/i.test(z.l ?? "") ? ZONE.relegation : "#94a3b8") : "transparent");
function Rows({ rows, nav, code, byId, compact }) {
  const hide = "text-center d-none d-sm-table-cell";
  return (
    <div className="table-responsive"><Table hover className="align-middle mb-0 standings">
      <thead><tr><th>#</th><th>Team</th><th className="text-center">P</th><th className={hide}>W</th><th className={hide}>D</th><th className={hide}>L</th><th className={hide}>GD</th><th className="text-center">Pts</th>{!compact && <th className="d-none d-md-table-cell">Form</th>}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={(r.id ?? i) + "-" + i} role="button" onClick={() => r.id != null && nav.team(r.id, code)}>
          <td className="text-body-secondary" style={{ borderLeft: `4px solid ${zoneColor(r.z)}` }}>{r.p ?? i + 1}</td>
          <td><span className="d-flex align-items-center gap-2"><Crest team={{ id: r.id, name: r.n ?? byId[r.id]?.name }} />{r.n ?? byId[r.id]?.name}{r.live && <Badge bg="danger">live</Badge>}</span></td>
          <td className="text-center">{r.pl}</td><td className={hide}>{r.w}</td><td className={hide}>{r.d}</td><td className={hide}>{r.l}</td>
          <td className={hide}>{(r.gf ?? 0) - (r.ga ?? 0) > 0 ? "+" : ""}{(r.gf ?? 0) - (r.ga ?? 0)}</td><td className="text-center fw-bold">{r.pts}</td>
          {!compact && <td className="d-none d-md-table-cell"><FormChips r={String(r.f ?? "").slice(-5).split("").filter((c) => "WDL".includes(c))} size={22} /></td>}
        </tr>))}</tbody>
    </Table></div>
  );
}
export function TableTab({ code, comp, byId, nav }) {
  const st = useDoc(() => loadStandings(code), code), lg = useLeague(code), [venue, setVenue] = useState("total");
  const computed = useMemo(() => {
    if (!lg.data) return null;
    const teams = comp.teams.filter((t) => t.active);
    return standings(lg.data.results.filter((r) => r.s === 0), teams, venue).map((r, i) => ({ p: i + 1, id: r.t.id, n: r.t.name, pl: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts }));
  }, [lg.data, comp.teams, venue]);
  if (st.err) return <Alert variant="danger">{st.err}</Alert>;
  if (!st.data && !st.err && st.data !== null) return <Spin />;
  const doc = st.data, canSplit = comp.kind === "league" && lg.data;
  const rows = venue === "total" ? doc?.rows : computed;
  const zones = [...new Map([...(doc?.rows ?? [])].filter((r) => r.z?.l).map((r) => [r.z.l, r.z])).values()];
  return (
    <div className="d-flex flex-column gap-3">
      {canSplit && <ButtonGroup size="sm" className="align-self-start">{[["total", "Overall"], ["home", "Home"], ["away", "Away"]].map(([k, l]) => <Button key={k} variant={venue === k ? "primary" : "outline-secondary"} onClick={() => setVenue(k)}>{l}</Button>)}</ButtonGroup>}
      {venue === "total" && doc?.groups?.length ? doc.groups.map((g) => <Card key={g.name}><Card.Header>{g.name}</Card.Header><Rows rows={g.rows} nav={nav} code={code} byId={byId} compact /></Card>)
        : rows?.length ? <Card><Rows rows={rows} nav={nav} code={code} byId={byId} /></Card>
        : <Alert variant="info" className="mb-0">No table for this competition yet (cup competitions without a league phase have none).</Alert>}
      {venue === "total" && zones.length > 0 && <div className="d-flex flex-wrap gap-3 small text-body-secondary">{zones.map((z) => <span key={z.l}><i className="legend-dot" style={{ background: zoneColor(z) }} />{z.l}</span>)}</div>}
      <p className="small text-body-secondary mb-0">Tap a team for its squad and statistics.</p>
    </div>
  );
}

/* ---------- matches ---------- */
export function MatchesTab({ code, comp, byId, nav }) {
  const lg = useLeague(code);
  return <Load s={lg}>{(r) => <MatchList key={code} fixtures={tagged(upcoming(comp.fixtures), code)} results={tagged(resultsOf(r, comp.meta), code)} byId={byId} onOpen={nav.open} />}</Load>;
}

/* ---------- teams ---------- */
export function TeamsTab({ code, comp, nav }) {
  const [q, setQ] = useState("");
  const teams = comp.teams.filter((t) => t.active && (!q.trim() || hit(q, t.name))).sort((a, b) => a.name.localeCompare(b.name));
  const pg = usePaged(teams, 12, q + code);
  return (
    <div className="d-flex flex-column gap-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search team" style={{ maxWidth: 300 }} />
      {!teams.length && <Alert variant="info" className="mb-0">No teams found.</Alert>}
      <Row className="g-3">{pg.slice.map((t) => (
        <Col xs={12} sm={6} lg={4} key={t.id}>
          <Card className="h-100 comp-card" role="button" onClick={() => nav.team(t.id, code)}><Card.Body>
            <div className="d-flex align-items-center gap-3"><Crest team={t} size={44} /><div className="flex-fill" style={{ minWidth: 0 }}><div className="fw-semibold text-truncate">{t.name}</div><div className="small text-body-secondary">{t.country ?? ""}</div></div></div>
            {t.st ? <div className="d-flex justify-content-between align-items-center mt-3 small"><FormChips r={String(t.st.form ?? "").slice(-5).split("").filter((c) => "WDL".includes(c))} size={20} /><span className="text-body-secondary">{t.st.ppm != null ? `${t.st.ppm} pts/game` : ""}{t.st.avg?.ball_possession != null ? ` · ${t.st.avg.ball_possession}% poss.` : ""}</span></div>
              : <div className="tiny text-body-secondary mt-3">Statistics load soon</div>}
          </Card.Body></Card>
        </Col>))}</Row>
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </div>
  );
}

/* ---------- players: league leaders ---------- */
const STATS = [["scorers", "Top scorers", "Goals"], ["assists", "Assists", "Assists"], ["yellowcards", "Yellow cards", "Cards"], ["redcards", "Red cards", "Cards"]];
export function PlayersTab({ code, nav }) {
  const ld = useDoc(() => loadLeaders(code), code), [stat, setStat] = useState("scorers");
  if (ld.err) return <Alert variant="danger">{ld.err}</Alert>;
  if (ld.data === undefined) return <Spin />;
  const rows = ld.data?.[stat] ?? [], label = STATS.find((s) => s[0] === stat)[2];
  return (
    <div className="d-flex flex-column gap-3">
      <ButtonGroup size="sm" className="align-self-start flex-wrap">{STATS.map(([k, l]) => <Button key={k} variant={stat === k ? "primary" : "outline-secondary"} onClick={() => setStat(k)}>{l}</Button>)}</ButtonGroup>
      {rows.length ? <Card><div className="table-responsive"><Table hover className="align-middle mb-0">
        <thead><tr><th>#</th><th>Player</th><th className="d-none d-sm-table-cell">Pos</th><th>Team</th><th className="text-center">{label}</th><th className="text-center d-none d-sm-table-cell">Matches</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} role="button" onClick={() => nav.player({ id: r.id, code, name: r.n, teamId: r.tid })}>
            <td className="text-body-secondary">{r.rk}</td><td><span className="d-flex align-items-center gap-2"><PlayerPhoto id={r.id} name={r.n} size={32} />{r.n}</span></td>
            <td className="d-none d-sm-table-cell">{r.pos}</td><td><span className="d-flex align-items-center gap-2"><Crest team={{ id: r.tid, name: r.tn }} size={22} />{r.tn}</span></td>
            <td className="text-center fw-bold">{r.v}</td><td className="text-center d-none d-sm-table-cell">{r.m}</td>
          </tr>))}</tbody>
      </Table></div></Card> : <Alert variant="info" className="mb-0">No leaderboard for this competition yet.</Alert>}
      <p className="small text-body-secondary mb-0">For every player in a club, open the team and its Squad tab.</p>
    </div>
  );
}

/* ---------- transfers ---------- */
const NAME = ["player_name", "player", "name"], FROM = ["from_team", "from_team_name", "from"], TO = ["to_team", "to_team_name", "to"], DATE = ["date", "transfer_date"], FEE = ["fee", "fee_eur", "amount"], TYPE = ["type", "transfer_type"];
export function TransfersTab({ code, nav }) {
  const tr = useDoc(() => loadTransfers(code), code), [view, setView] = useState("list"), [q, setQ] = useState("");
  const rows = useMemo(() => {
    const list = tr.data?.list ?? [];
    const dk = DATE.find((k) => list.some((r) => r[k]));
    return [...list].sort((a, b) => String(b[dk] ?? "").localeCompare(String(a[dk] ?? ""))).filter((r) => !q.trim() || hit(q, Object.values(r).join(" ")));
  }, [tr.data, q]);
  if (tr.err) return <Alert variant="danger">{tr.err}</Alert>;
  if (tr.data === undefined) return <Spin />;
  if (!tr.data) return <Alert variant="info" className="mb-0">No transfer data for this competition yet.</Alert>;
  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <ButtonGroup size="sm">{[["list", "Latest transfers"], ["ledger", "Club spending"]].map(([k, l]) => <Button key={k} variant={view === k ? "primary" : "outline-secondary"} onClick={() => setView(k)}>{l}</Button>)}</ButtonGroup>
        {view === "list" && <SearchBox value={q} onChange={setQ} placeholder="Search player or club" style={{ maxWidth: 300 }} />}
        <span className="tiny text-body-secondary ms-auto">{tr.data.from} to {tr.data.to}</span>
      </div>
      <Card><Card.Body>
        {view === "list"
          ? <DataTable rows={rows} pref={[NAME, FROM, TO, DATE, FEE, TYPE]} max={6} nameKeys={NAME} onRow={(r) => r.player_id != null && nav.player({ id: +r.player_id, code, name: first(r, ...NAME) })} empty="No transfers match." />
          : <DataTable rows={tr.data.ledger.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && typeof v !== "object")))} pref={[["team_name", "club", "name"], "gross_spend_eur", "gross_income_eur", "net_spend_eur", "squad_size"]} max={6} nameKeys={["team_name", "club", "name"]} empty="No club spending data." />}
      </Card.Body></Card>
    </div>
  );
}

/* ---------- managers and referees active in the competition ---------- */
function PeopleTab({ code, nav, byId, load, kind, pref, nameKeys, empty, hint }) {
  const ld = useDoc(() => load(code), code), [q, setQ] = useState("");
  if (ld.err) return <Alert variant="danger">{ld.err}</Alert>;
  if (ld.data === undefined) return <Spin />;
  const rows = (ld.data?.list ?? []).map((r) => (r.current_team_id != null && byId?.[r.current_team_id] ? { team: byId[r.current_team_id].name, ...r } : r)).filter((r) => !q.trim() || hit(q, Object.values(r).join(" ")));
  if (!ld.data) return <Alert variant="info" className="mb-0">{empty}</Alert>;
  return (
    <div className="d-flex flex-column gap-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search" style={{ maxWidth: 300 }} />
      <Card><Card.Body><DataTable rows={rows} pref={pref} max={7} nameKeys={nameKeys} onRow={(r) => nav.person({ kind, id: +r.id, code, name: first(r, ...nameKeys), row: r })} empty="Nobody matches." /></Card.Body></Card>
      <p className="small text-body-secondary mb-0">{hint}</p>
    </div>
  );
}
export const ManagersTab = (p) => <PeopleTab {...p} load={loadManagers} kind="manager" nameKeys={["name"]} pref={[["name"], ["team"], ["country", "nationality"], ["tactical_profile"], ["preferred_formation"], ["matches_total", "matches"], ["win_pct"], ["avg_goals_scored"], ["avg_goals_conceded"]]} empty="No managers loaded for this competition yet." hint="Tap a manager for his career, record by club and what changed when he was appointed." />;
export const RefereesTab = (p) => <PeopleTab {...p} load={loadReferees} kind="referee" nameKeys={["name"]} pref={[["name"], ["country"], ["matches"], ["avg_yellow_per_match"], ["avg_red_per_match"], ["avg_fouls_per_match"], ["avg_goals_per_match"]]} empty="No referees loaded for this competition yet." hint="Averages are per match officiated. Cards markets are not quoted in the odds feed, so this is research only." />;

/* ---------- overview ---------- */
export function OverviewTab({ code, comp, byId, nav, setTab }) {
  const lg = useLeague(code), st = useDoc(() => loadStandings(code), code), ld = useDoc(() => loadLeaders(code), code);
  const next = tagged(upcoming(comp.fixtures).filter((f) => f.s === "notstarted" || f.s === "inprogress"), code).slice(0, 5);
  const tableRows = st.data?.rows?.length ? st.data.rows.slice(0, 6) : st.data?.groups?.[0]?.rows.slice(0, 4) ?? [];
  return (
    <Row className="g-3">
      <Col xs={12} lg={6}><Card2 title="Next fixtures" icon="calendar3" right={<Button variant="link" size="sm" onClick={() => setTab("matches")}>All matches</Button>}>{next.length ? <Days list={next} byId={byId} onOpen={nav.open} /> : <p className="text-body-secondary mb-0">No upcoming fixtures.</p>}</Card2></Col>
      <Col xs={12} lg={6}><Card2 title="Latest results" icon="flag" right={<Button variant="link" size="sm" onClick={() => setTab("matches")}>All matches</Button>}>
        {lg.data ? (() => { const r = tagged(resultsOf(lg.data, comp.meta), code).slice(0, 5); return r.length ? <Days list={r} byId={byId} onOpen={nav.open} /> : <p className="text-body-secondary mb-0">No results yet.</p>; })() : lg.err ? <Alert variant="danger" className="mb-0">{lg.err}</Alert> : <Spin />}
      </Card2></Col>
      <Col xs={12} lg={7}><Card2 title="Table" icon="list-ol" right={<Button variant="link" size="sm" onClick={() => setTab("table")}>Full table</Button>}>{tableRows.length ? <Rows rows={tableRows} nav={nav} code={code} byId={byId} compact /> : st.data === undefined ? <Spin /> : <p className="text-body-secondary mb-0">No table for this competition.</p>}</Card2></Col>
      <Col xs={12} lg={5}><Card2 title="Top scorers" icon="trophy" right={<Button variant="link" size="sm" onClick={() => setTab("players")}>More</Button>}>
        {ld.data?.scorers?.length ? <ul className="list-unstyled mb-0">{ld.data.scorers.slice(0, 5).map((r) => (
          <li key={r.id} role="button" className="d-flex align-items-center gap-2 py-2 border-bottom border-secondary-subtle" onClick={() => nav.player({ id: r.id, code, name: r.n, teamId: r.tid })}><span className="text-body-secondary" style={{ width: 18 }}>{r.rk}</span><PlayerPhoto id={r.id} name={r.n} size={30} /><span className="flex-fill text-truncate">{r.n}<span className="d-block tiny text-body-secondary">{r.tn}</span></span><strong>{r.v}</strong></li>))}</ul>
          : ld.data === undefined ? <Spin /> : <p className="text-body-secondary mb-0">No leaderboard yet.</p>}
      </Card2></Col>
    </Row>
  );
}
