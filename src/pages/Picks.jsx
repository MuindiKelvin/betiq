import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc } from "firebase/firestore";
import { Alert, Badge, Button, Card, Col, ListGroup, Row } from "react-bootstrap";
import { db } from "../lib/firebase";
import { loadPicks } from "../lib/picks";
import { pickWithLive } from "../lib/pickstate";
import { minuteLabel, phaseOf } from "../lib/phase";
import { useLive } from "../lib/useLive";
import { MARKETS, dayLabel, pct, pickLabel, pickMarket } from "../lib/util";
import { buildReceipts, downloadReceipt, money } from "../lib/receipts";
import { Pager, SearchBox, Spin, Stat, hit, usePaged } from "../components/ui";

function PickLine({ p, lg, onRemove }) {
  return (
    <ListGroup.Item className="d-flex align-items-center gap-3 py-3 flex-wrap">
      <div className="flex-fill" style={{ minWidth: 180 }}>
        <div className="fw-medium">{p.home} vs {p.away}</div>
        {lg && <div className="small text-body-secondary"><i className="bi bi-trophy me-1" />{lg.name}{p.v !== 3 && <Badge bg="secondary" className="ms-2">Legacy</Badge>}{String(p.id).startsWith("a_") && <Badge bg="primary" text="dark" className="ms-2" title="Confirmed from Daily Picks">Daily pick</Badge>}</div>}
      </div>
      <div className="text-end"><div>{pickLabel(p)}</div><div className="small text-body-secondary">{MARKETS[pickMarket(p)]?.label}{p.prob != null && ` · ${pct(p.prob)}`}</div></div>
      {p.odds && <div className="text-end small"><div>@ {p.odds.toFixed(2)}</div>{p.stake && <div className="text-body-secondary">stake {p.stake}</div>}</div>}
      <div className="text-end" style={{ minWidth: 130 }}>
        {p.won != null ? <><Badge bg={p.won ? "success" : "danger"}>{p.score} · FT · {p.won ? "Won" : "Lost"}</Badge>{p.profit != null && <div className={"small " + (p.profit >= 0 ? "text-success" : "text-danger")}>{money(p.profit)}</div>}</>
          : p.live ? <><Badge bg="danger" className={p.liveStale ? "opacity-50" : ""}>{minuteLabel(p.live.min) ?? "Live"} · {p.live.hg ?? "–"}–{p.live.ag ?? "–"}</Badge><div className="tiny text-body-secondary">in play</div></>
          : p.wait === "overdue" || p.wait === "left" ? <><Badge bg="warning" text="dark">Awaiting result</Badge><div className="tiny text-body-secondary">kick-off passed</div></>
          : p.wait ? <Badge bg="warning" text="dark">{p.wait === "postponed" ? "Postponed" : p.wait === "cancelled" ? "Cancelled" : p.raw ?? "Disrupted"}</Badge>
          : <Badge bg="secondary">{p.v !== 3 ? "Not tracked" : p.matchId ? "Pending" : "No fixture"}</Badge>}
      </div>
      <Button size="sm" variant="link" className="text-body-secondary p-0" aria-label="Delete pick" onClick={() => onRemove(p.id)}><i className="bi bi-trash" /></Button>
    </ListGroup.Item>
  );
}

function Receipt({ r, d, who, onRemove }) {
  const name = (c) => d.byCode[c]?.name ?? null, pg = usePaged(r.picks, 5, r.key);   // 5 picks per page inside a receipt
  return (
    <Card>
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <div className="me-auto"><div className="fw-semibold">{dayLabel(r.t)}</div><div className="tiny text-body-secondary"><i className="bi bi-receipt me-1" />Receipt {r.id}</div></div>
        <Badge bg={r.open ? "warning" : "success"} text={r.open ? "dark" : undefined}>{r.open ? `Ongoing · ${r.openCount} pending` : "Finished"}</Badge>
        <Button size="sm" variant="outline-secondary" onClick={() => downloadReceipt(r, { leagueName: name, who })}><i className="bi bi-download me-1" />Download</Button>
      </Card.Header>
      <ListGroup variant="flush">{pg.slice.map((p) => <PickLine key={p.id} p={p} lg={d.byCode[p.league]} onRemove={onRemove} />)}</ListGroup>
      {pg.pages > 1 && <div className="py-2 border-top"><Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} /></div>}
      <Card.Footer className="d-flex flex-wrap column-gap-4 row-gap-1 small text-body-secondary">
        <span>Picks <strong className="text-body">{r.picks.length}</strong></span>
        {r.settled > 0 && <span>Won <strong className="text-body">{r.won}/{r.settled}</strong></span>}
        {r.stake > 0 && <span>Total stake <strong className="text-body">{r.stake.toFixed(2)}</strong></span>}
        {r.ret > 0 && <span>Potential return <strong className="text-body">{r.ret.toFixed(2)}</strong></span>}
        {r.profit != null && <span>Profit <strong className={r.profit >= 0 ? "text-success" : "text-danger"}>{money(r.profit)}</strong></span>}
      </Card.Footer>
    </Card>
  );
}

export default function Picks({ user, d, history }) {
  const [saved, setSaved] = useState(null), [err, setErr] = useState(null), [q, setQ] = useState(""), { doc: liveDoc, finals, nowMs } = useLive();
  // The live feed settles a pick the moment the API reports its match finished (no waiting for the data sync); a synced result, once present, wins.
  const rows = useMemo(() => saved && saved.map((p) => pickWithLive(p, p.v === 3 && p.matchId ? phaseOf({ id: p.matchId, t: p.t }, liveDoc, nowMs, finals) : null)), [saved, liveDoc, finals, nowMs]);
  useEffect(() => { loadPicks(user.uid).then(setSaved).catch((e) => setErr(e.message)); }, [user, d]);

  async function remove(id) {
    try { await deleteDoc(doc(db, "users", user.uid, "picks", id)); setSaved((r) => r.filter((p) => p.id !== id)); } catch (e) { setErr(e.message); }
  }
  const who = user.displayName || user.email || "", all = rows ?? [], done = all.filter((r) => r.won != null), won = (l) => l.filter((r) => r.won).length;
  const staked = done.filter((r) => r.profit != null), stakedSum = staked.reduce((s, r) => s + r.stake, 0), profit = staked.reduce((s, r) => s + r.profit, 0);
  // one receipt per match day: open ones (a pick still unsettled) are "Ongoing", the rest "Finished", each listed under its date
  const receipts = useMemo(() => buildReceipts(rows ?? []), [rows]);
  const pool = history ? receipts.filter((r) => !r.open && r.settled) : receipts;
  const match = (r) => !q.trim() || r.picks.some((p) => hit(q, `${p.home} ${p.away} ${d.byCode[p.league]?.name ?? ""} ${pickLabel(p)} ${r.id} ${dayLabel(r.t)}`));
  const ongoing = pool.filter((r) => r.open && match(r)), finished = pool.filter((r) => !r.open && match(r));
  const pgO = usePaged(ongoing, 5, q + history + "o"), pg = usePaged(finished, 5, q + history);   // receipts per page
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
      {pool.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search team, league, pick or date" style={{ maxWidth: 340 }} />}
      {rows && !ongoing.length && !finished.length && <Alert variant="secondary" className="mb-0">{pool.length ? "No receipts match your search." : history ? "No settled picks yet. A pick settles as soon as its match is reported finished." : "No picks yet. Analyze a match and tap “Save to My Picks”."}</Alert>}
      {ongoing.length > 0 && <><h2 className="h5 mb-0"><i className="bi bi-broadcast me-2 text-primary" />Ongoing</h2>{pgO.slice.map((r) => <Receipt key={r.key} r={r} d={d} who={who} onRemove={remove} />)}<Pager page={pgO.page} pages={pgO.pages} onChange={pgO.setPage} /></>}
      {finished.length > 0 && <>{!history && <h2 className="h5 mb-0"><i className="bi bi-check2-circle me-2 text-primary" />Finished</h2>}{pg.slice.map((r) => <Receipt key={r.key} r={r} d={d} who={who} onRemove={remove} />)}</>}
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </div>
  );
}
