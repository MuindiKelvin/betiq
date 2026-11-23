import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Alert, Badge, Button, Card, Nav, Table } from "react-bootstrap";
import { auth, db } from "../lib/firebase";
import { fresh, loadGoals, loadInfo, loadManagers, loadMatchStats, loadReferees, useComp, useLeague } from "../lib/data";
import { byIdMap, cardsOf } from "../lib/people";
import { analyze } from "../lib/analysis";
import { dateTimeLabel, shortDate, timeLabel, tzAt } from "../lib/util";
import { describe, minuteLabel, preMatchLock, scoreText } from "../lib/phase";
import { usePhase } from "../lib/useLive";
import AnalysisView from "../components/AnalysisView";
import EventsFeed from "../components/EventsFeed";
import MatchStatsView from "../components/MatchStatsView";
import DetailsView from "../components/DetailsView";
import Scorers from "../components/Scorers";
import Pitch from "../components/Pitch";
import { Crest, LeagueLogo, Load, ProbBar } from "../components/ui";

const pairKey = (x, y) => `${Math.min(x, y)}_${Math.max(x, y)}`;
const TABS = [["overview", "Overview", "grid"], ["lineups", "Lineups", "people"], ["stats", "Stats", "bar-chart-line"], ["h2h", "Head-to-head", "arrow-left-right"], ["analysis", "Analysis", "graph-up-arrow"]];
const STATE = { inprogress: ["danger", "Live"], postponed: ["warning", "Postponed"], cancelled: ["warning", "Cancelled"], canceled: ["warning", "Cancelled"] };

// per-match statistics row from a details document (same order as the mstats arrays)
const rowOf = (st) => { const h = st?.h, a = st?.a; if (!h || !a) return null; const r = [h.total_shots, a.total_shots, h.shots_on_target, a.shots_on_target, h.corner_kicks, a.corner_kicks, h.fouls, a.fouls, h.yellow_cards, a.yellow_cards, h.red_cards, a.red_cards, h.ball_possession, a.ball_possession, h.xg, a.xg]; return r.every((v) => v == null) ? null : r; };

const InfoLink = ({ icon, onClick, children }) => (onClick
  ? <Button variant="link" size="sm" className="p-0 text-body-secondary text-decoration-none" onClick={onClick}><i className={`bi bi-${icon} me-1`} />{children}</Button>
  : <span><i className={`bi bi-${icon} me-1`} />{children}</span>);
function InfoStrip({ info, code, nav }) {
  if (!info || !(info.vn || info.rf || info.hc || info.ac)) return null;
  const go = (kind, e) => (e?.id != null && nav ? () => nav.person({ kind, id: e.id, code, name: e.n }) : null);
  return (
    <div className="d-flex flex-wrap justify-content-center gap-x-3 gap-3 small text-body-secondary mt-3">
      {info.vn && <InfoLink icon="geo-alt" onClick={go("venue", info.vn)}>{info.vn.n ?? "Venue"}{info.vn.city ? `, ${info.vn.city}` : ""}{info.vn.cap ? ` · ${info.vn.cap.toLocaleString()} seats` : ""}</InfoLink>}
      {info.rf && <InfoLink icon="person-badge" onClick={go("referee", info.rf)}>Referee: {info.rf.n ?? `#${info.rf.id}`}</InfoLink>}
      {info.hc && <InfoLink icon="clipboard2-data" onClick={go("manager", info.hc)}>Home manager: {info.hc.n ?? `#${info.hc.id}`}</InfoLink>}
      {info.ac && <InfoLink icon="clipboard2-data" onClick={go("manager", info.ac)}>Away manager: {info.ac.n ?? `#${info.ac.id}`}</InfoLink>}
      {info.att ? <span><i className="bi bi-people me-1" />{info.att.toLocaleString()} attended</span> : null}
    </div>);
}

function Header({ r, H, A, entry, finished, info, code, nav }) {
  const st = STATE[r.s], p = usePhase(r), live = p?.kind === "live", fmt = (t) => `${timeLabel(t)} ${tzAt(t)}`.trim();
  const score = live ? [p.row.hg, p.row.ag] : finished ? [r.hg, r.ag] : p?.kind === "finished" ? [p.hg, p.ag] : null;
  const extra = live ? [p.row.et != null && `Extra time ${scoreText(p.row.et)}`, p.row.pen != null && `Penalties ${scoreText(p.row.pen)}`].filter(Boolean) : [];
  const badge = live ? <Badge bg="danger" className={p.stale ? "opacity-50" : ""}>{minuteLabel(p.row.min) ?? "Live"}</Badge>
    : p?.kind === "overdue" ? <Badge bg="warning" text="dark">Kick-off passed</Badge>
    : p?.kind === "left" ? <Badge bg="secondary">Left live feed</Badge>
    : p?.kind === "postponed" || p?.kind === "cancelled" || p?.kind === "disrupted" ? <Badge bg="warning" text="dark">{p.kind === "disrupted" ? p.raw : p.kind === "postponed" ? "Postponed" : "Cancelled"}</Badge>
    : st ? <Badge bg={st[0]} text={st[0] === "warning" ? "dark" : undefined}>{st[1]}</Badge> : finished || p?.kind === "finished" ? <Badge bg="secondary" title="Full time">FT</Badge> : <Badge bg="info" text="dark">Upcoming</Badge>;
  const note = [p && describe(p, fmt), extra.length ? `The score shown is after 90 minutes. ${extra.join(". ")}.` : ""].filter(Boolean).join(" ");
  const t = p?.t ?? r.t;
  return (
    <Card><Card.Body>
      <div className="d-flex align-items-center gap-2 small text-body-secondary mb-3">
        <LeagueLogo lg={entry} size={22} /><span>{entry?.name ?? r.league}{r.rn ? ` · ${r.rn}` : r.r ? ` · Round ${r.r}` : ""}{r.g ? ` · ${r.g}` : ""}</span>
        <span className="ms-auto text-end">{t != null && <>{dateTimeLabel(t)} <span className="tiny">({tzAt(t)})</span></>}{p?.moved && <Badge bg="warning" text="dark" className="ms-2" title="The kick-off time was changed (fixture change feed)">Rescheduled</Badge>}</span>
      </div>
      <div className="d-flex align-items-center justify-content-center gap-3 gap-md-5 text-center">
        <div className="flex-fill d-flex flex-column align-items-center gap-2" style={{ minWidth: 0 }}><Crest team={H} size={64} /><div className="fw-semibold text-break">{H.name}</div></div>
        <div style={{ minWidth: 110 }}>
          {score ? <div className="display-5 fw-bold">{score[0] ?? "–"}–{score[1] ?? "–"}</div> : <div className="display-6 fw-bold">{t != null ? timeLabel(t) : ""}</div>}
          <div className="mt-1">{badge}</div>
        </div>
        <div className="flex-fill d-flex flex-column align-items-center gap-2" style={{ minWidth: 0 }}><Crest team={A} size={64} /><div className="fw-semibold text-break">{A.name}</div></div>
      </div>
      {note && <div className="small text-body-secondary text-center mt-3">{note}</div>}
      <InfoStrip info={info} code={code} nav={nav} />
    </Card.Body></Card>
  );
}

function H2HTab({ out, H, A }) {
  const [all, setAll] = useState(false), { rows, rec } = out.h2h, list = all ? rows : rows.slice(0, 10);
  if (!rows.length) return <Alert variant="secondary" className="mb-0">No previous meetings found in the synced data.</Alert>;
  return (
    <Card><Card.Body>
      <div className="d-flex justify-content-around text-center mb-3">
        <div><div className="fs-2 fw-bold text-success">{rec.w}</div><div className="tiny text-body-secondary">{H.name} wins</div></div>
        <div><div className="fs-2 fw-bold">{rec.d}</div><div className="tiny text-body-secondary">Draws</div></div>
        <div><div className="fs-2 fw-bold text-info">{rec.l}</div><div className="tiny text-body-secondary">{A.name} wins</div></div>
      </div>
      <div className="table-responsive"><Table hover size="sm" className="align-middle mb-0">
        <thead><tr><th>Date</th><th className="text-end">Home</th><th className="text-center">Score</th><th>Away</th></tr></thead>
        <tbody>{list.map((m, i) => (
          <tr key={(m.id ?? i) + "-" + i}>
            <td className="text-body-secondary">{shortDate(m.t)}</td>
            <td className="text-end">{m.hHome ? H.name : A.name}</td>
            <td className="text-center fw-bold">{m.hHome ? `${m.f}–${m.a}` : `${m.a}–${m.f}`}</td>
            <td>{m.hHome ? A.name : H.name}</td>
          </tr>))}</tbody>
      </Table></div>
      {rows.length > 10 && <Button size="sm" variant="link" className="mt-2 px-0" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button>}
    </Card.Body></Card>
  );
}

function Inner({ lg, m, byId, code, comp, entry, user, nav }) {
  const H = byId[m.h], A = byId[m.a], played = lg.results.find((x) => x.id === m.id);
  const r = { ...m, ...(played ?? {}) }, finished = r.hg != null, phase = usePhase(r);
  const [tab, setTab] = useState("overview"), [x, setX] = useState({ loading: true }), [mstats, setStats] = useState(null);
  const [goalsMap, setGoalsMap] = useState(null), [infoMap, setInfoMap] = useState(null), [refPack, setRefPack] = useState(null), [people, setPeople] = useState({}), [venue, setVenue] = useState(null);
  const [h2hDoc, setH2hDoc] = useState(null), [h2hQ, setH2hQ] = useState({ queued: false, busy: false }), [saved, setSaved] = useState(false), [msg, setMsg] = useState(null);

  // lineups, events, shot map, average positions and the full head-to-head history are stored by the data sync; users can queue a request for them
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const d = await fresh("details", r.id);
        if (d) on && setX({ details: d }); else on && setX({ queued: !!(await fresh("requests", "d_" + r.id).catch(() => null)) });
      } catch (e) { on && setX({ err: e.message }); }
      try {
        const k = pairKey(m.h, m.a), [doc1, req] = await Promise.all([fresh("h2h", k).catch(() => null), fresh("requests", "h2h_" + k).catch(() => null)]);
        if (on) { setH2hDoc(doc1); setH2hQ({ queued: !!req, busy: false }); }
      } catch { /* optional */ }
    })();
    loadMatchStats(code).then((s) => on && setStats(Array.isArray(s[r.id]) ? s[r.id] : null)).catch(() => {});
    loadGoals(code).then((g) => on && setGoalsMap(g)).catch(() => {});
    loadInfo(code).then((i) => on && setInfoMap(i)).catch(() => {});
    loadManagers(code).then((x) => on && setPeople((p) => ({ ...p, m: byIdMap(x) }))).catch(() => {});
    loadReferees(code).then((x) => on && setPeople((p) => ({ ...p, r: byIdMap(x) }))).catch(() => {});
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, code]);

  const out = useMemo(() => {
    if (!H || !A) return null;
    try {
      const results = finished ? lg.results.filter((y) => y.t < r.t) : lg.results;
      if (!results.length) return null;
      return analyze({ results, H, A, byId, code, comp, extraH2H: h2hDoc?.matches?.filter((y) => !finished || y.t < r.t) });
    } catch { return null; }
  }, [lg, r.t, finished, H, A, byId, code, comp, h2hDoc]);

  async function request() {
    setX((s) => ({ ...s, busy: true }));
    try { await setDoc(doc(db, "requests", "d_" + r.id), { kind: "details", league: code, eid: r.id, at: serverTimestamp(), uid: auth.currentUser?.uid }); setX({ queued: true }); }
    catch (e) { setX({ err: "Could not queue the request: " + e.message }); }
  }
  async function requestH2H() {
    setH2hQ((s) => ({ ...s, busy: true }));
    try { await setDoc(doc(db, "requests", "h2h_" + pairKey(m.h, m.a)), { kind: "h2h", league: code, eid: r.id, h: m.h, a: m.a, at: serverTimestamp(), uid: auth.currentUser?.uid }); setH2hQ({ queued: true, busy: false }); }
    catch (e) { setH2hQ((s) => ({ ...s, busy: false })); setMsg("Could not queue the request: " + e.message); }
  }
  async function save(pick) {
    const lock = finished ? null : preMatchLock(phase);
    if (lock) { setMsg(lock); return; }
    try {
      await addDoc(collection(db, "users", user.uid, "picks"), { v: 3, matchId: r.id ?? null, kickoff: phase?.t ?? r.t ?? null, league: code, homeId: H.id, awayId: A.id, home: H.name, away: A.name, market: pick.market, selection: pick.selection, prob: pick.prob, odds: pick.odds, stake: pick.stake, myProb: pick.myProb ?? null, mktProb: pick.mktProb ?? null, createdAt: serverTimestamp() });
      setSaved(true);
    } catch (e) { setMsg("Could not save: " + e.message); }
  }

  const d = x.details, st = mstats ?? rowOf(d?.stats);
  // the match feed carries ids only: names come from the synced managers / referees lists and the venue document
  const raw = { ...(infoMap?.[r.id] ?? {}), ...(d?.info ?? {}) }, rfId = raw.rf?.id, vnId = raw.vn?.id, refRow = people.r?.[rfId];
  useEffect(() => { let on = true; setRefPack(null); if (rfId != null) fresh("officials", rfId).then((p) => on && setRefPack(p)).catch(() => {}); return () => { on = false; }; }, [rfId]);
  useEffect(() => { let on = true; setVenue(null); if (vnId != null) fresh("venues", vnId).then((p) => on && setVenue(p?.profile ?? null)).catch(() => {}); return () => { on = false; }; }, [vnId]);
  const nm = (e, row) => (e ? { ...e, n: e.n ?? row?.name } : e);
  const info = { ...raw, rf: nm(raw.rf, refRow), hc: nm(raw.hc, people.m?.[raw.hc?.id]), ac: nm(raw.ac, people.m?.[raw.ac?.id]), vn: raw.vn && { ...raw.vn, n: raw.vn.n ?? venue?.name, city: raw.vn.city ?? venue?.city, cap: raw.vn.cap ?? venue?.capacity } };
  const goalEntry = goalsMap?.[r.id], showScorers = finished && !(d?.goals && d.goals.length >= (r.hg ?? 0) + (r.ag ?? 0) && (r.hg ?? 0) + (r.ag ?? 0) > 0), refCards = refRow || refPack ? cardsOf(refRow ?? refPack.profile) : null;
  const slot = x.loading ? <p className="text-body-secondary mb-0">Loading…</p> : x.err ? <Alert variant="danger" className="mb-0">{x.err}</Alert> : !d && (
    <div>
      <p className="small text-body-secondary">{x.queued ? "Requested. Lineups, events, shot map and positions appear after the next data sync (usually within 30 minutes)." : "Not loaded yet. Request them and the next data sync fetches this match."}</p>
      <Button variant="primary" size="sm" disabled={x.queued || x.busy} onClick={request}>{x.queued ? "Requested" : "Request match details"}</Button>
    </div>);
  const hasSheet = d && (d.lineups || d.avgpos || d.shots?.length);
  const box = (children) => <Card><Card.Body>{children}</Card.Body></Card>;

  const body = {
    overview: (
      <div className="d-flex flex-column gap-3">
        {showScorers && box(<><h2 className="h5 mb-3"><i className="bi bi-record-circle me-2 text-primary" />Scorers and assists</h2><Scorers entry={goalEntry} hg={r.hg} ag={r.ag} h={H.name} a={A.name} /></>)}
        {d?.goals ? box(<><h2 className="h5 mb-3"><i className="bi bi-list-ul me-2 text-primary" />Match events</h2><div className="events-scroll"><EventsFeed details={d} h={H.name} a={A.name} /></div></>)
          : !finished && r.s !== "inprogress" ? null : box(<>{<h2 className="h5 mb-3"><i className="bi bi-list-ul me-2 text-primary" />Match events</h2>}{slot}</>)}
        {info.rf && box(<>
          <h2 className="h5 mb-2"><i className="bi bi-person-badge me-2 text-primary" />Referee</h2>
          <div><strong>{info.rf.n ?? `#${info.rf.id}`}</strong>{refCards && (refCards.y != null || refCards.r != null) ? <span className="text-body-secondary"> · {refCards.y != null ? `${refCards.y.toFixed(2)} yellow` : ""}{refCards.y != null && refCards.r != null ? ", " : ""}{refCards.r != null ? `${refCards.r.toFixed(2)} red` : ""} per match{refCards.n != null ? ` over ${refCards.n} matches` : ""}</span> : null}</div>
          {(H.st?.avg?.yellow_cards != null || A.st?.avg?.yellow_cards != null) && <div className="small text-body-secondary mt-1">Yellow cards per game, recent form: {H.name} {H.st?.avg?.yellow_cards ?? "n/a"} · {A.name} {A.st?.avg?.yellow_cards ?? "n/a"}</div>}
          <div className="tiny text-body-secondary mt-1">Cards markets are not quoted in the odds feed: a research input only.</div>
        </>)}
        {st && <MatchStatsView s={st} h={H.name} a={A.name} />}
        {out && !finished && box(<>
          <h2 className="h5 mb-3"><i className="bi bi-graph-up-arrow me-2 text-primary" />Match preview</h2>
          <ProbBar p={out.p} h={H.name} a={A.name} />
          <div className="small text-body-secondary mt-2">Model: {H.name} {Math.round(out.p.home * 100)}% · Draw {Math.round(out.p.draw * 100)}% · {A.name} {Math.round(out.p.away * 100)}%. Open the Analysis tab for markets, odds check and saving a pick.</div>
          {out.insights?.length > 0 && <ul className="insights list-unstyled mt-3 mb-0">{out.insights.slice(0, 4).map((i, n) => <li key={n}><i className={`bi bi-${i.ok ? "check-circle-fill ok" : "exclamation-circle-fill warn"}`} /><span>{i.text}</span></li>)}</ul>}
        </>)}
      </div>),
    lineups: hasSheet ? (
      <div className="d-flex flex-column gap-3">
        {box(<Pitch lineups={d.lineups} details={d} h={H.name} a={A.name} />)}
        {d.lineups && <DetailsView details={d} h={H.name} a={A.name} finished={finished} timeline={false} />}
      </div>) : box(slot || <p className="text-body-secondary mb-0">Teamsheets are published about an hour before kickoff.</p>),
    stats: st ? <MatchStatsView s={st} h={H.name} a={A.name} /> : box(<p className="text-body-secondary mb-0">{finished ? "Per-match statistics are not available for this match." : "Statistics appear once the match has been played."}</p>),
    h2h: out ? <H2HTab out={out} H={H} A={A} /> : <Alert variant="secondary" className="mb-0">Not enough synced results for these teams yet.</Alert>,
    analysis: out ? <AnalysisView out={out} fx={finished ? null : r} byId={byId} onSave={finished ? () => setMsg("Picks can only be saved for upcoming matches.") : save} saved={saved} ended={finished ? { hg: r.hg, ag: r.ag, t: r.t } : undefined} locked={finished ? null : preMatchLock(phase)} details={d}
      mstats={st} detailsSlot={slot || null} h2hInfo={finished ? undefined : { doc: h2hDoc, queued: h2hQ.queued, busy: h2hQ.busy, canRequest: true }} onRequestH2H={requestH2H} />
      : <Alert variant="warning" className="mb-0">No results synced for this competition yet, so there is nothing to base an analysis on.</Alert>,
  }[tab];

  return (
    <>
      <Header r={r} H={H} A={A} entry={entry} finished={finished} info={info} code={code} nav={nav} />
      <Nav className="nav-underline flex-nowrap overflow-auto comp-tabs" activeKey={tab} onSelect={setTab}>
        {TABS.map(([k, l, i]) => <Nav.Item key={k}><Nav.Link eventKey={k} className="text-nowrap"><i className={`bi bi-${i} me-1`} />{l}</Nav.Link></Nav.Item>)}
      </Nav>
      {msg && <Alert variant="danger" className="mb-0">{msg}</Alert>}
      {body}
    </>
  );
}

export default function MatchView({ m: m0, d, user, onBack, nav }) {
  const code = m0.league, s = useLeague(code), c = useComp(code), comp = d.byCode[code];
  const m = useMemo(() => (m0.t != null ? m0 : { ...(c.data?.fixtures?.find((f) => f.id === m0.id) ?? {}), ...m0, t: m0.t ?? c.data?.fixtures?.find((f) => f.id === m0.id)?.t }), [m0, c.data]);
  const byId = useMemo(() => { const o = { ...d.byId }; for (const t of c.data?.teams ?? []) o[t.id] = { ...t, league: code }; return o; }, [d.byId, c.data, code]);
  if (c.data && (!byId[m.h] || !byId[m.a])) return <Alert variant="warning">Match teams not found.</Alert>;
  return (
    <div className="d-flex flex-column gap-3">
      <div><Button size="sm" variant="outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-1" />Back</Button></div>
      <Load s={{ err: s.err ?? c.err, data: s.data && c.data ? s.data : null }}>{(lg) => <Inner lg={lg} m={m} byId={byId} code={code} comp={comp} entry={comp} user={user} nav={nav} />}</Load>
    </div>
  );
}
