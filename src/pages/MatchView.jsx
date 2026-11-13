import { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Alert, Button } from "react-bootstrap";
import { db } from "../lib/firebase";
import { fresh, loadMatchStats, useComp, useLeague } from "../lib/data";
import { analyze } from "../lib/analysis";
import AnalysisView from "../components/AnalysisView";
import { Load } from "../components/ui";

// per-match statistics row from a details document (same order as the mstats arrays)
const rowOf = (st) => { const h = st?.h, a = st?.a; if (!h || !a) return null; const r = [h.total_shots, a.total_shots, h.shots_on_target, a.shots_on_target, h.corner_kicks, a.corner_kicks, h.fouls, a.fouls, h.yellow_cards, a.yellow_cards, h.red_cards, a.red_cards, h.ball_possession, a.ball_possession, h.xg, a.xg]; return r.every((v) => v == null) ? null : r; };

function Inner({ lg, m, byId, code, comp }) {
  const H = byId[m.h], A = byId[m.a];
  const r = lg.results.find((x) => x.id === m.id) ?? m;
  const out = useMemo(() => analyze({ results: lg.results.filter((x) => x.t < r.t), H, A, byId, code, comp }), [lg, r.t, H, A, byId, code, comp]);
  const [x, setX] = useState({ loading: true }), [mstats, setStats] = useState(null);

  // lineups, events, shot map, average positions: stored by the data sync; users can queue a request (3 API calls, no quota worries on the free tier)
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const d = await fresh("details", r.id);
        if (d) return on && setX({ details: d });
        on && setX({ queued: !!(await fresh("requests", "d_" + r.id)) });
      } catch (e) { on && setX({ err: e.message }); }
    })();
    loadMatchStats(code).then((s) => on && setStats(Array.isArray(s[r.id]) ? s[r.id] : null)).catch(() => {});
    return () => { on = false; };
  }, [r.id, code]);

  async function request() {
    setX((s) => ({ ...s, busy: true }));
    try { await setDoc(doc(db, "requests", "d_" + r.id), { kind: "details", league: code, eid: r.id, at: serverTimestamp() }); setX({ queued: true }); }
    catch (e) { setX({ err: "Could not queue the request: " + e.message }); }
  }
  const slot = x.loading ? <p className="text-body-secondary mb-0">Loading…</p> : x.err ? <Alert variant="danger" className="mb-0">{x.err}</Alert> : !x.details && (
    <div>
      <p className="small text-body-secondary">{x.queued ? "Requested. Lineups, events, shot map and positions appear after the next data sync (usually within 30 minutes)." : "Not loaded yet. Request them and the next data sync fetches this match."}</p>
      <Button variant="primary" size="sm" disabled={x.queued || x.busy} onClick={request}>{x.queued ? "Requested" : "Request match details"}</Button>
    </div>);
  return <AnalysisView out={out} fx={null} byId={byId} ended={{ hg: r.hg, ag: r.ag, t: r.t }} details={x.details} mstats={mstats ?? rowOf(x.details?.stats)} detailsSlot={slot || null} />;
}

export default function MatchView({ m, d, onBack }) {
  const code = m.league, s = useLeague(code), c = useComp(code), comp = d.byCode[code];
  const byId = useMemo(() => { const o = { ...d.byId }; for (const t of c.data?.teams ?? []) o[t.id] = { ...t, league: code }; return o; }, [d.byId, c.data, code]);
  if (c.data && (!byId[m.h] || !byId[m.a])) return <Alert variant="warning">Match teams not found.</Alert>;
  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex align-items-center gap-2"><Button size="sm" variant="outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-1" />Back</Button><span className="small text-body-secondary">Finished match · view only. Predictions use only data from before kickoff.</span></div>
      <Load s={{ err: s.err ?? c.err, data: s.data && c.data ? s.data : null }}>{(lg) => <Inner lg={lg} m={m} byId={byId} code={code} comp={comp} />}</Load>
    </div>
  );
}
