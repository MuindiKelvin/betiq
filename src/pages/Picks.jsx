import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { Alert, Badge, Button, Card, Col, Form, ListGroup, Row } from "react-bootstrap";
import { db } from "../lib/firebase";
import { loadPicks } from "../lib/picks";
import { canEditPick, editPatch, pickWithLive } from "../lib/pickstate";
import { minuteLabel, phaseOf } from "../lib/phase";
import { useLive } from "../lib/useLive";
import { MARKETS, dayDMY, dayLabel, dmy, pct, pickLabel, pickMarket } from "../lib/util";
import { buildReceipts, dayKey, downloadReceipt, money } from "../lib/receipts";
import { RECENT_DAYS, groupFinished, groupKeys, holds } from "../lib/grouping";
import { shiftDay } from "../lib/board";
import { Pager, SearchBox, Spin, Stat, hit, usePaged } from "../components/ui";

// Inline form to add or change the numbers on an open pick: odds, stake, your own probability. onSave resolves to an error message or null.
function EditForm({ p, onSave, onCancel }) {
  const [odds, setOdds] = useState(p.odds ?? ""), [stake, setStake] = useState(p.stake ?? ""), [mine, setMine] = useState(p.myProb != null ? String(Math.round(p.myProb * 1000) / 10) : "");
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    const r = editPatch(p, { odds, stake, mine });
    if (r.error) return setErr(r.error);
    setErr(null); setBusy(true); setErr(await onSave(p.id, r.patch)); setBusy(false);
  };
  const field = (label, value, set, ph) => <Col xs={6} md={3}><Form.Label className="tiny text-body-secondary mb-1">{label}</Form.Label><Form.Control size="sm" inputMode="decimal" value={value} placeholder={ph} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></Col>;
  return (
    <div className="w-100 border-top pt-3 mt-1">
      <Row className="g-2 align-items-end">
        {field("Bookmaker odds", odds, setOdds, "e.g. 2.10")}{field("Stake", stake, setStake, "e.g. 10")}{field("Your probability %", mine, setMine, "e.g. 55")}
        <Col xs={6} md="auto" className="d-flex gap-2"><Button size="sm" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="outline-secondary" disabled={busy} onClick={onCancel}>Cancel</Button></Col>
      </Row>
      {err && <div className="text-danger small mt-2" role="alert">{err}</div>}
      <div className="tiny text-body-secondary mt-2">Only odds, stake and your own % can be changed, and only before kick-off. To change the pick itself, tap Re-analyze, save the new pick and delete this one.</div>
    </div>
  );
}

function PickLine({ p, lg, dense, canEdit, editing, onEdit, onSave, onReanalyze, onRemove }) {
  return (
    <ListGroup.Item className={"d-flex align-items-center gap-3 flex-wrap " + (dense ? "py-2" : "py-3")}>
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
      <div className="d-flex align-items-center gap-2">
        {canEdit && <Button size="sm" variant="link" className={"p-0 " + (editing ? "text-primary" : "text-body-secondary")} aria-label={p.odds ? "Edit odds and stake" : "Add odds and stake"} title={p.odds ? "Edit odds and stake" : "Add odds and stake"} aria-expanded={editing} onClick={() => onEdit(editing ? null : p.id)}><i className="bi bi-pencil-square" /></Button>}
        {canEdit && p.homeId && p.awayId && <Button size="sm" variant="link" className="text-body-secondary p-0" aria-label="Re-analyze this match" title="Re-analyze this match to pick something else" onClick={() => onReanalyze(p)}><i className="bi bi-arrow-repeat" /></Button>}
        <Button size="sm" variant="link" className="text-body-secondary p-0" aria-label="Delete pick" onClick={() => onRemove(p.id)}><i className="bi bi-trash" /></Button>
      </div>
      {editing && <EditForm p={p} onSave={onSave} onCancel={() => onEdit(null)} />}
    </ListGroup.Item>
  );
}

// Colour of a day by its hit rate; grey while nothing has settled.
const tone = (r) => (!r.settled ? "secondary" : r.won / r.settled >= 0.6 ? "success" : r.won / r.settled >= 0.4 ? "warning" : "danger");
const shortDay = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// One chip per recent finished day (the last 7 days; colour = hit rate): tap to open that day and scroll to it.
function DayStrip({ list, onJump }) {
  return (
    <div className="d-flex flex-wrap gap-2" role="group" aria-label="Jump to a day">
      {list.slice(0, 14).map((r) => (
        <Button key={r.key} size="sm" variant={"outline-" + tone(r)} className="day-chip" title={`${dayDMY(r.t)}: ${r.settled ? `${r.won} of ${r.settled} won` : "nothing settled"}`} onClick={() => onJump(r.key)}>
          <span>{shortDay(r.t)}</span><small>{r.settled ? `${r.won}/${r.settled}` : "–"}</small>
        </Button>))}
    </div>
  );
}

// One match day. The header is a one-line summary that opens and closes the day; the picks (8 per page) are inside.
function Receipt({ r, d, who, open, onToggle, renderPick }) {
  const [saved, setSaved] = useState(false), name = (c) => d.byCode[c]?.name ?? null, pg = usePaged(r.picks, 8, r.key), rate = r.settled ? r.won / r.settled : null;
  const key = (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); } };
  return (
    <Card id={"r-" + r.key}>
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap receipt-head" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={key}>
        <i className={"bi bi-chevron-right chev text-body-secondary" + (open ? " open" : "")} aria-hidden="true" />
        <div className="me-auto"><div className="fw-semibold">{dayDMY(r.t)}</div><div className="tiny text-body-secondary"><i className="bi bi-receipt me-1" />Receipt {r.id} · {r.picks.length} pick{r.picks.length > 1 ? "s" : ""}</div></div>
        {rate != null && <div className="d-flex align-items-center gap-2 small text-body-secondary" title={`${pct(rate)} hit rate`}>Won <strong className="text-body">{r.won}/{r.settled}</strong><div className="hit-bar"><span className={"bg-" + tone(r)} style={{ width: `${Math.round(rate * 100)}%` }} /></div></div>}
        {r.profit != null && <strong className={"small " + (r.profit >= 0 ? "text-success" : "text-danger")}>{money(r.profit)}</strong>}
        <Badge bg={r.open ? "warning" : "success"} text={r.open ? "dark" : undefined}>{r.open ? `Ongoing · ${r.openCount} pending` : "Finished"}</Badge>
        <Button size="sm" variant="outline-secondary" onClick={(e) => { e.stopPropagation(); downloadReceipt(r, { leagueName: name, who }); setSaved(true); setTimeout(() => setSaved(false), 1800); }}><i className={"bi me-1 " + (saved ? "bi-check2 text-success pop" : "bi-download")} aria-hidden="true" />{saved ? "Downloaded" : "Download"}</Button>
      </Card.Header>
      {open && <div className="expand">
        <ListGroup variant="flush">{pg.slice.map(renderPick)}</ListGroup>
        {pg.pages > 1 && <div className="py-2 border-top"><Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} /></div>}
        <Card.Footer className="d-flex flex-wrap column-gap-4 row-gap-1 small text-body-secondary">
          <span>Picks <strong className="text-body">{r.picks.length}</strong></span>
          {r.settled > 0 && <span>Won <strong className="text-body">{r.won}/{r.settled}</strong></span>}
          {r.stake > 0 && <span>Total stake <strong className="text-body">{r.stake.toFixed(2)}</strong></span>}
          {r.ret > 0 && <span>Potential return <strong className="text-body">{r.ret.toFixed(2)}</strong></span>}
          {r.profit != null && <span>Profit <strong className={r.profit >= 0 ? "text-success" : "text-danger"}>{money(r.profit)}</strong></span>}
        </Card.Footer>
      </div>}
    </Card>
  );
}

// A folded week, month or year of older finished days: one summary line (days, picks, wins, hit-rate bar, profit) that opens the days or weeks inside.
const LEVEL_ICON = { week: "calendar-week", month: "calendar3", year: "calendar-range" };
function Group({ g, open, onToggle, children }) {
  const { stats: s } = g, rate = s.settled ? s.won / s.settled : null, t = tone({ settled: s.settled, won: s.won });
  const key = (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); } };
  return (
    <Card id={g.key}>
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap receipt-head" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={key}>
        <i className={"bi bi-chevron-right chev text-body-secondary" + (open ? " open" : "")} aria-hidden="true" />
        <div className="me-auto"><div className="fw-semibold"><i className={`bi bi-${LEVEL_ICON[g.level]} me-2 text-body-secondary`} />{g.level === "week" ? "Week " : ""}{g.label}</div><div className="tiny text-body-secondary">{s.days} day{s.days > 1 ? "s" : ""} · {s.picks} pick{s.picks > 1 ? "s" : ""}</div></div>
        {rate != null && <div className="d-flex align-items-center gap-2 small text-body-secondary" title={`${pct(rate)} hit rate`}>Won <strong className="text-body">{s.won}/{s.settled}</strong><div className="hit-bar"><span className={"bg-" + t} style={{ width: `${Math.round(rate * 100)}%` }} /></div></div>}
        {s.profit != null && <strong className={"small " + (s.profit >= 0 ? "text-success" : "text-danger")}>{money(s.profit)}</strong>}
      </Card.Header>
      {open && <Card.Body className="expand d-flex flex-column gap-2 p-2 p-md-3">{children}</Card.Body>}
    </Card>
  );
}

export default function Picks({ user, d, history, nav }) {
  const [saved, setSaved] = useState(null), [err, setErr] = useState(null), [q, setQ] = useState(""), [opened, setOpened] = useState({}), [editId, setEditId] = useState(null), { doc: liveDoc, finals, nowMs } = useLive();
  // The live feed settles a pick the moment the API reports its match finished (no waiting for the data sync); a synced result, once present, wins.
  const rows = useMemo(() => saved && saved.map((p) => pickWithLive(p, p.v === 3 && p.matchId ? phaseOf({ id: p.matchId, t: p.t }, liveDoc, nowMs, finals) : null)), [saved, liveDoc, finals, nowMs]);
  useEffect(() => { loadPicks(user.uid).then(setSaved).catch((e) => setErr(e.message)); }, [user, d]);

  async function remove(id) {
    try { await deleteDoc(doc(db, "users", user.uid, "picks", id)); setSaved((r) => r.filter((p) => p.id !== id)); } catch (e) { setErr(e.message); }
  }
  // Edit odds / stake / own % of an open pick (firestore.rules: only these four fields, only before kick-off). Resolves to an error message or null.
  async function update(id, patch) {
    try {
      await updateDoc(doc(db, "users", user.uid, "picks", id), { odds: patch.odds, stake: patch.stake, myProb: patch.myProb, mktProb: patch.mktProb });
      setSaved((r) => r.map((p) => (p.id === id ? { ...p, ...patch } : p))); setEditId(null); return null;
    } catch (e) { return e.code === "permission-denied" ? "Could not save: the match has probably started, or the updated rules are not deployed yet." : "Could not save: " + e.message; }
  }
  const who = user.displayName || user.email || "", all = rows ?? [], done = all.filter((r) => r.won != null), won = (l) => l.filter((r) => r.won).length;
  const staked = done.filter((r) => r.profit != null), stakedSum = staked.reduce((s, r) => s + r.stake, 0), profit = staked.reduce((s, r) => s + r.profit, 0);
  // one receipt per match day: open ones (a pick still unsettled) are "Ongoing", the rest "Finished", each listed under its date
  const receipts = useMemo(() => buildReceipts(rows ?? []), [rows]);
  const pool = history ? receipts.filter((r) => !r.open && r.settled) : receipts;
  const match = (r) => !q.trim() || r.picks.some((p) => hit(q, `${p.home} ${p.away} ${d.byCode[p.league]?.name ?? ""} ${pickLabel(p)} ${r.id} ${dayLabel(r.t)} ${dmy(r.t)}`));
  const ongoing = pool.filter((r) => r.open && match(r)), finished = pool.filter((r) => !r.open && match(r));
  const pgO = usePaged(ongoing, 5, q + history + "o");
  // finished days: the last 7 days stay single days, older ones fold into weeks > months > years (a folded group is one line until opened)
  const today = dayKey(nowMs / 1000), cutoff = shiftDay(today, -RECENT_DAYS);
  const tree = useMemo(() => groupFinished(finished, today), [finished, today]), recent = finished.filter((r) => r.key >= cutoff);
  // days and groups open or closed: the choice of the user wins; otherwise ongoing days, the newest finished day and the group holding it are open (everything while searching)
  const isOpen = (r) => (r.key in opened ? opened[r.key] : q.trim() ? true : r.open || r.key === finished[0]?.key);
  const toggle = (r) => setOpened((o) => ({ ...o, [r.key]: !isOpen(r) }));
  const isGroupOpen = (g) => (g.key in opened ? opened[g.key] : q.trim() ? true : !!finished[0] && holds(g, finished[0].key));
  const toggleGroup = (g) => setOpened((o) => ({ ...o, [g.key]: !isGroupOpen(g) }));
  const setAll = (v) => setOpened(Object.fromEntries([...finished.map((r) => r.key), ...groupKeys(tree)].map((k) => [k, v])));
  const jump = (key) => {
    setOpened((o) => ({ ...o, [key]: true }));
    setTimeout(() => document.getElementById("r-" + key)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  const renderPick = (p) => <PickLine key={p.id} p={p} lg={d.byCode[p.league]} dense canEdit={canEditPick(p, nowMs)} editing={editId === p.id} onEdit={setEditId} onSave={update} onRemove={remove} onReanalyze={(x) => nav?.analyze({ league: x.league, h: x.homeId, a: x.awayId })} />;
  const renderNode = (n) => n.type === "day"
    ? <Receipt key={n.r.key} r={n.r} d={d} who={who} open={isOpen(n.r)} onToggle={() => toggle(n.r)} renderPick={renderPick} />
    : <Group key={n.key} g={n} open={isGroupOpen(n)} onToggle={() => toggleGroup(n)}>{n.children.map(renderNode)}</Group>;
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
      {ongoing.length > 0 && <><h2 className="h5 mb-0"><i className="bi bi-broadcast me-2 text-primary" />Ongoing</h2>{pgO.slice.map((r) => <Receipt key={r.key} r={r} d={d} who={who} open={isOpen(r)} onToggle={() => toggle(r)} renderPick={renderPick} />)}<Pager page={pgO.page} pages={pgO.pages} onChange={pgO.setPage} /></>}
      {finished.length > 0 && <>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {!history && <h2 className="h5 mb-0 me-auto"><i className="bi bi-check2-circle me-2 text-primary" />Finished <span className="small text-body-secondary fw-normal">{finished.length} day{finished.length > 1 ? "s" : ""}</span></h2>}
          <div className={"d-flex gap-2" + (history ? " ms-auto" : "")}><Button size="sm" variant="outline-secondary" onClick={() => setAll(true)}><i className="bi bi-arrows-expand me-1" />Expand all</Button><Button size="sm" variant="outline-secondary" onClick={() => setAll(false)}><i className="bi bi-arrows-collapse me-1" />Collapse all</Button></div>
        </div>
        {recent.length > 1 && <DayStrip list={recent} onJump={jump} />}
        {tree.map(renderNode)}
      </>}
    </div>
  );
}
