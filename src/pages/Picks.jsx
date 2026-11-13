import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, orderBy, query } from "firebase/firestore";
import { Alert, Badge, Button, Card, Col, ListGroup, Row } from "react-bootstrap";
import { db } from "../lib/firebase";
import { loadResults } from "../lib/data";
import { MARKETS, groupByDay, pct, pickLabel, pickMarket, settle } from "../lib/util";
import { Pager, SearchBox, Spin, Stat, hit, usePaged } from "../components/ui";

const money = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2);

export default function Picks({ user, d, history }) {
  const [rows, setRows] = useState(null), [err, setErr] = useState(null), [q, setQ] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const s = await getDocs(query(collection(db, "users", user.uid, "picks"), orderBy("createdAt", "desc")));
        const raw = s.docs.map((x) => ({ id: x.id, ...x.data() }));
        const codes = [...new Set(raw.filter((p) => p.v === 3 && p.matchId).map((p) => p.league))];
        const data = Object.fromEntries(await Promise.all(codes.map(async (c) => [c, await loadResults(c).catch(() => null)])));
        const out = raw.map((p) => {
          p.t = p.kickoff ?? p.createdAt?.seconds ?? Math.floor(Date.now() / 1000);
          const r = p.v === 3 && p.matchId ? data[p.league]?.results.find((x) => x.id === p.matchId) : null;
          if (r) { p.score = `${r.hg}–${r.ag}`; Object.assign(p, settle(p, r.hg, r.ag)); }
          return p;
        });
        setRows(out.sort((x, y) => y.t - x.t));
      } catch (e) { setErr(e.message); }
    })();
  }, [user, d]);

  async function remove(id) {
    try { await deleteDoc(doc(db, "users", user.uid, "picks", id)); setRows((r) => r.filter((p) => p.id !== id)); } catch (e) { setErr(e.message); }
  }
  const all = rows ?? [], done = all.filter((r) => r.won != null), won = (l) => l.filter((r) => r.won).length;
  const staked = done.filter((r) => r.profit != null), stakedSum = staked.reduce((s, r) => s + r.stake, 0), profit = staked.reduce((s, r) => s + r.profit, 0);
  const base = history ? done : all, shown = base.filter((r) => !q.trim() || hit(q, `${r.home} ${r.away} ${d.byCode[r.league]?.name ?? ""} ${pickLabel(r)}`));
  const pg = usePaged(shown, 10, q + history);
  const group = (keyFn, keys) => keys.map((k) => [k, done.filter((r) => keyFn(r) === k)]).filter(([, l]) => l.length);
  const tiles = [["Saved", all.length], ["Settled", done.length], ["Hit rate", done.length ? pct(won(done) / done.length) : "n/a"],
    ...(staked.length ? [["Profit (units)", money(profit)], ["ROI", stakedSum ? pct(profit / stakedSum, 1) : "n/a"]] : [])];

  return (
    <div className="d-flex flex-column gap-3">
      <h1 className="h3 mb-0">{history ? "Prediction history" : "My Picks"}</h1>
      {err && <Alert variant="danger" className="mb-0">{err}</Alert>}
      {!rows && !err && <Spin />}
      <Row className="g-3">{tiles.map(([l, v]) => <Col xs={6} md key={l}><Card><Card.Body><Stat value={v} label={l} /></Card.Body></Card></Col>)}</Row>
      {history && done.length > 0 && (
        <Row className="g-3">
          {[["By league", group((r) => r.league, Object.keys(d.byCode)), (c) => d.byCode[c]?.name ?? c], ["By market", group(pickMarket, Object.keys(MARKETS)), (k) => MARKETS[k].label]].map(([title, g, name]) => (
            <Col xs={12} md={6} key={title}><Card><Card.Header>{title}</Card.Header><ListGroup variant="flush">{g.map(([k, l]) => (
              <ListGroup.Item key={k} className="d-flex align-items-center gap-3"><span className="flex-fill">{name(k)}</span><span className="small text-body-secondary">{won(l)}/{l.length}</span><strong>{pct(won(l) / l.length)}</strong></ListGroup.Item>))}</ListGroup></Card></Col>))}
        </Row>)}
      {base.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search team, league or pick" style={{ maxWidth: 340 }} />}
      {rows && !shown.length && <Alert variant="secondary" className="mb-0">{base.length ? "No picks match your search." : history ? "No settled picks yet. A pick settles after the match is played and the next data sync has run." : "No picks yet. Analyze a match and tap “Save to My Picks”."}</Alert>}
      {groupByDay(pg.slice).map(([label, items]) => (
        <div key={label}>
          <div className="small fw-semibold text-body-secondary mb-2 px-1">{label}</div>
          <ListGroup>{items.map((r) => (
            <ListGroup.Item key={r.id} className="d-flex align-items-center gap-3 py-3 flex-wrap">
              <div className="flex-fill" style={{ minWidth: 180 }}>
                <div className="fw-medium">{r.home} vs {r.away}</div>
                {d.byCode[r.league] && <div className="small text-body-secondary"><i className="bi bi-trophy me-1" />{d.byCode[r.league].name}{r.v !== 3 && <Badge bg="secondary" className="ms-2">Legacy</Badge>}</div>}
              </div>
              <div className="text-end"><div>{pickLabel(r)}</div><div className="small text-body-secondary">{MARKETS[pickMarket(r)]?.label}{r.prob != null && ` · ${pct(r.prob)}`}</div></div>
              {r.odds && <div className="text-end small"><div>@ {r.odds.toFixed(2)}</div>{r.stake && <div className="text-body-secondary">stake {r.stake}</div>}</div>}
              <div className="text-end" style={{ minWidth: 130 }}>
                {r.won != null ? <><Badge bg={r.won ? "success" : "danger"}>{r.score} · {r.won ? "Won" : "Lost"}</Badge>{r.profit != null && <div className={"small " + (r.profit >= 0 ? "text-success" : "text-danger")}>{money(r.profit)}</div>}</>
                  : <Badge bg="secondary">{r.v !== 3 ? "Not tracked" : r.matchId ? "Pending" : "No fixture"}</Badge>}
              </div>
              <Button size="sm" variant="link" className="text-body-secondary p-0" aria-label="Delete pick" onClick={() => remove(r.id)}><i className="bi bi-trash" /></Button>
            </ListGroup.Item>))}</ListGroup>
        </div>))}
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </div>
  );
}
