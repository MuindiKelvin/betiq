import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Alert, Button, Card, Col, Row } from "react-bootstrap";
import { db } from "../lib/firebase";
import { fresh, loadResults, useComp } from "../lib/data";
import { analyze } from "../lib/analysis";
import { dayLabel } from "../lib/util";
import AnalysisView from "../components/AnalysisView";
import CompSelect from "../components/CompSelect";
import { Days, Load, Pager, SearchBox, Spin, TeamSelect, hit, usePaged } from "../components/ui";

const pairKey = (x, y) => `${Math.min(x, y)}_${Math.max(x, y)}`;

function Fixtures({ fixtures, byId, onOpen }) {
  const [q, setQ] = useState("");
  const list = fixtures.filter((f) => !q.trim() || hit(q, `${byId[f.h]?.name} ${byId[f.a]?.name} ${dayLabel(f.t)}`));
  const pg = usePaged(list, 10, q + (fixtures[0]?.league ?? ""));
  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <h2 className="h5 mb-0"><i className="bi bi-calendar3 me-2 text-primary" />Upcoming fixtures <span className="small text-body-secondary fw-normal">tap one to analyze it</span></h2>
        <SearchBox value={q} onChange={setQ} placeholder="Search team or date" style={{ maxWidth: 300 }} />
      </div>
      {pg.slice.length ? <Days list={pg.slice} byId={byId} onOpen={onOpen} /> : <Alert variant="secondary">No upcoming fixtures found.</Alert>}
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </div>
  );
}

export default function Analyze({ user, d, pre }) {
  const [code, setCode] = useState(pre?.league ?? d.compCode ?? d.entries[0]?.code);
  const [h, setH] = useState(pre?.h ?? null), [a, setA] = useState(pre?.a ?? null);
  const [out, setOut] = useState(null), [h2hInfo, setH2h] = useState(null), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const s = useComp(code), comp = d.byCode[code];
  const byId = useMemo(() => { const m = { ...d.byId }; for (const t of s.data?.teams ?? []) m[t.id] = { ...t, league: code }; return m; }, [d.byId, s.data, code]);
  const pool = (s.data?.teams ?? []).filter((t) => t.active).map((t) => ({ ...t, league: code }));
  const fixtures = (s.data?.fixtures ?? []).filter((f) => !["postponed", "cancelled", "canceled"].includes(f.s)).map((f) => ({ ...f, league: code }));

  useEffect(() => { if (pre?.h && pre?.a && s.data) run(pre.h, pre.a); /* eslint-disable-next-line */ }, [s.data]);

  async function run(hid, aid) {
    setMsg(null); setOut(null); setSaved(false); setH2h(null);
    const H = pool.find((t) => t.id === hid) ?? byId[hid], A = pool.find((t) => t.id === aid) ?? byId[aid];
    if (!H || !A || H.id === A.id) return setMsg({ type: "warning", text: "Pick two different teams." });
    setBusy(true);
    try {
      const lg = await loadResults(code);
      if (!lg.results.length) throw new Error("No results synced for this competition yet.");
      const fx = fixtures.find((f) => f.h === H.id && f.a === A.id) ?? null;
      const [hd, rq, det] = await Promise.all([fresh("h2h", pairKey(H.id, A.id)).catch(() => null), fresh("requests", "h2h_" + pairKey(H.id, A.id)).catch(() => null), fx ? fresh("details", fx.id).catch(() => null) : null]);
      setH2h({ doc: hd, queued: !!rq, canRequest: !!fx });
      setOut({ ...analyze({ results: lg.results, H, A, byId, code, comp, extraH2H: hd?.matches }), fx, details: det });
    } catch (e) { setMsg({ type: "danger", text: "Analysis failed: " + e.message }); }
    setBusy(false);
  }
  async function save(pick) {
    try {
      const { H, A, fx } = out;
      await addDoc(collection(db, "users", user.uid, "picks"), { v: 3, matchId: fx?.id ?? null, kickoff: fx?.t ?? null, league: code, homeId: H.id, awayId: A.id, home: H.name, away: A.name,
        market: pick.market, selection: pick.selection, prob: pick.prob, odds: pick.odds, stake: pick.stake, createdAt: serverTimestamp() });
      setSaved(true);
    } catch (e) { setMsg({ type: "danger", text: "Could not save: " + e.message }); }
  }
  async function requestH2H() {
    setH2h((x) => ({ ...x, busy: true }));
    try {
      const { H, A, fx } = out;
      await setDoc(doc(db, "requests", "h2h_" + pairKey(H.id, A.id)), { kind: "h2h", league: code, eid: fx.id, h: H.id, a: A.id, at: serverTimestamp() });
      setH2h((x) => ({ ...x, queued: true, busy: false }));
    } catch (e) { setH2h((x) => ({ ...x, busy: false })); setMsg({ type: "danger", text: "Could not queue the request: " + e.message }); }
  }
  const changeComp = (c) => { setCode(c); setH(null); setA(null); setOut(null); setMsg(null); };
  const openFx = (m) => { setH(m.h); setA(m.a); run(m.h, m.a); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div className="d-flex flex-column gap-3">
      <div><h1 className="h3 mb-1">Match analysis</h1><p className="text-body-secondary mb-0">Choose a competition and two teams. BetIQ reads their form, head-to-head history and statistics, then estimates the result.</p></div>
      <Card className="picker"><Card.Body className="d-flex flex-column gap-3">
        <Row className="g-2"><Col xs={12} md={6} lg={4}><CompSelect entries={d.entries} value={code} onChange={changeComp} /></Col></Row>
        {s.err ? <Alert variant="warning" className="mb-0">{s.err}</Alert> : !s.data ? <Spin /> : (
          <Row className="g-2 align-items-end">
            <Col xs={12} md><TeamSelect label="Home team" teams={pool} value={h} disabledId={a} onChange={setH} placeholder="Choose home team" /></Col>
            <Col xs="auto" className="d-none d-md-block pb-1"><Button variant="outline-secondary" aria-label="Swap teams" disabled={!h && !a} onClick={() => { setH(a); setA(h); }}><i className="bi bi-arrow-left-right" /></Button></Col>
            <Col xs={12} md><TeamSelect label="Away team" teams={pool} value={a} disabledId={h} onChange={setA} placeholder="Choose away team" /></Col>
            <Col xs={12} md="auto" className="d-grid"><Button variant="primary" size="lg" disabled={busy || !h || !a} onClick={() => run(h, a)}>{busy ? "Analyzing…" : <><i className="bi bi-lightning-charge-fill me-1" />Analyze</>}</Button></Col>
          </Row>)}
      </Card.Body></Card>
      {msg && <Alert variant={msg.type} className="mb-0">{msg.text}</Alert>}
      {busy && <Spin />}
      {out && <AnalysisView out={out} fx={out.fx} byId={byId} onSave={save} saved={saved} h2hInfo={h2hInfo} onRequestH2H={requestH2H} details={out.details} />}
      {!out && !busy && s.data && (fixtures.length ? <Fixtures fixtures={fixtures} byId={byId} onOpen={openFx} /> : <Alert variant="info">No upcoming fixtures in this competition right now. You can still pick any two teams above.</Alert>)}
    </div>
  );
}
