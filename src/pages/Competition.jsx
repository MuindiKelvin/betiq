import { useMemo } from "react";
import { Alert, Button, Nav } from "react-bootstrap";
import { useComp } from "../lib/data";
import { dateTimeLabel } from "../lib/util";
import { LeagueLogo, Load } from "../components/ui";
import { ManagersTab, MatchesTab, OverviewTab, PlayersTab, RefereesTab, TableTab, TeamsTab, TransfersTab } from "./CompTabs";

const TABS = [["overview", "Overview", "grid"], ["matches", "Matches", "calendar3"], ["table", "Table", "list-ol"], ["teams", "Teams", "shield"], ["players", "Players", "person-lines-fill"], ["managers", "Managers", "clipboard2-data"], ["referees", "Referees", "person-badge"], ["transfers", "Transfers", "arrow-left-right"]];

export default function Competition({ d, code, tab, setTab, nav, onBack }) {
  const c = useComp(code), entry = d.byCode[code];
  const byId = useMemo(() => { const m = { ...d.byId }; for (const t of c.data?.teams ?? []) m[t.id] = { ...t, league: code }; return m; }, [d.byId, c.data, code]);
  const season = c.data?.meta?.seasons?.find((s) => s.id === c.data.meta.current);
  return (
    <div className="d-flex flex-column gap-3">
      <div><Button size="sm" variant="outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-1" />All competitions</Button></div>
      <div className="d-flex align-items-center gap-3 flex-wrap">
        <LeagueLogo lg={entry} size={56} />
        <div className="me-auto"><h1 className="h3 mb-0">{entry?.name ?? code}</h1><div className="text-body-secondary small">{entry?.country || "International"}{season ? ` · ${season.name ?? season.year}` : ""}{c.data?.meta?.updated ? ` · updated ${dateTimeLabel(Date.parse(c.data.meta.updated) / 1000)}` : ""}</div></div>
        <Button variant="primary" onClick={() => nav.analyze({ league: code })}><i className="bi bi-lightning-charge-fill me-1" />Analyze a match</Button>
      </div>
      <Nav className="nav-underline flex-nowrap overflow-auto comp-tabs" activeKey={tab} onSelect={setTab}>
        {TABS.map(([k, l, i]) => <Nav.Item key={k}><Nav.Link eventKey={k} className="text-nowrap"><i className={`bi bi-${i} me-1`} />{l}</Nav.Link></Nav.Item>)}
      </Nav>
      <Load s={c}>{(comp) => {
        const p = { code, comp: { ...comp, kind: entry?.kind ?? "league" }, byId, nav };
        // Matches/Table tabs read comp.kind through comp.meta; keep both shapes consistent
        p.comp.meta = { ...comp.meta, kind: entry?.kind ?? comp.meta.kind };
        return { overview: <OverviewTab {...p} setTab={setTab} />, matches: <MatchesTab {...p} />, table: <TableTab {...p} />, teams: <TeamsTab {...p} />, players: <PlayersTab {...p} />, managers: <ManagersTab {...p} />, referees: <RefereesTab {...p} />, transfers: <TransfersTab {...p} /> }[tab] ?? <Alert variant="warning">Unknown tab.</Alert>;
      }}</Load>
    </div>
  );
}
