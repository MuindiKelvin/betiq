import { useMemo, useState } from "react";
import { Alert, Badge, Button, ButtonGroup, Card, Form } from "react-bootstrap";
import { useLive } from "../lib/useLive";
import { fmtDur, scoreText } from "../lib/phase";
import { boardItems, boardView, dayKey, dayName, shiftDay } from "../lib/board";
import { useSchedule } from "../lib/schedule";
import { tzAt, tzName } from "../lib/util";
import { Crest, LeagueLogo, Spin } from "../components/ui";
import PhaseMid from "../components/PhaseMid";
import { useHotkeys } from "../components/Shortcuts";

const HALT = { quota: "the daily API quota reserve was reached (it resets at 00:00 UTC)", auth: "the API key was rejected" };
const CHIPS = [["all", "All"], ["live", "Live"], ["finished", "FT"], ["upcoming", "Upcoming"]];

function Row({ x, d, nav }) {
  const { r, p } = x, H = d.byId[r.h] ?? (r.h != null ? { id: r.h, name: r.hn } : null), A = d.byId[r.a] ?? (r.a != null ? { id: r.a, name: r.an } : null);
  const can = r.h != null && r.a != null && r.c && d.byCode[r.c];
  const src = p.kind === "live" ? p.row : p;                                    // live row, or the finished phase: both carry et / pen
  const extra = p.kind === "live" || p.kind === "finished" ? [src.et != null && `Extra time ${scoreText(src.et)}`, src.pen != null && `Penalties ${scoreText(src.pen)}`].filter(Boolean) : [];
  const hg = p.kind === "finished" ? p.hg : r.hg, ag = p.kind === "finished" ? p.ag : r.ag;
  const body = (
    <>
      <span className="side d-flex align-items-center justify-content-end gap-2 text-end"><span className="fw-medium text-truncate">{H?.name ?? r.hn ?? "?"}</span><Crest team={H} /></span>
      <span className="match-mid text-center"><PhaseMid m={{ ...r, hg, ag }} p={p} />{extra.length > 0 && <div className="tiny text-body-secondary">{extra.join(" · ")}</div>}</span>
      <span className="side d-flex align-items-center gap-2"><Crest team={A} /><span className="fw-medium text-truncate">{A?.name ?? r.an ?? "?"}</span></span>
    </>);
  const cls = "list-group-item d-flex align-items-center gap-2 py-3", hasX = p.kind === "live" && p.row.x && Object.keys(p.row.x).length > 0;
  return (
    <>
      {can ? <button type="button" data-mid={r.id} className={cls + " list-group-item-action"} title="Open match" onClick={(e) => nav.open({ h: r.h, a: r.a, league: r.c, id: r.id, t: p.t, hg: p.kind === "finished" ? p.hg : undefined, ag: p.kind === "finished" ? p.ag : undefined, s: p.kind === "live" ? "inprogress" : p.kind === "finished" ? "finished" : r.s }, e.currentTarget)}>{body}</button> : <div className={cls}>{body}</div>}
      {hasX && <div className="list-group-item py-1 tiny text-body-secondary"><details><summary>Everything else the feed sent</summary><pre className="mb-0 small">{JSON.stringify(p.row.x, null, 1)}</pre></details></div>}
    </>);
}

function DayStrip({ day, today, onPick }) {
  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => shiftDay(day, n));
  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <Button size="sm" variant="outline-secondary" aria-label="Previous day" onClick={() => onPick(shiftDay(day, -1))}><i className="bi bi-chevron-left" /></Button>
      <ButtonGroup size="sm" className="flex-wrap">{days.map((k) => <Button key={k} variant={k === day ? "primary" : "outline-secondary"} onClick={() => onPick(k)}>{dayName(k, today)}</Button>)}</ButtonGroup>
      <Button size="sm" variant="outline-secondary" aria-label="Next day" onClick={() => onPick(shiftDay(day, 1))}><i className="bi bi-chevron-right" /></Button>
      <Form.Control size="sm" type="date" aria-label="Pick a date" value={day} onChange={(e) => e.target.value && onPick(e.target.value)} style={{ width: "auto" }} />
      {day !== today && <Button size="sm" variant="link" onClick={() => onPick(today)}>Today</Button>}
    </div>);
}

export default function Live({ d, nav }) {
  const { doc, finals, err, nowMs, feed, clockOff, lagMs } = useLive();
  const today = dayKey(nowMs / 1000), [day, setDay] = useState(null), [pick, setPick] = useState(null), [dir, setDir] = useState(null), cur = day ?? today;
  const sched = useSchedule(cur);
  const items = useMemo(() => boardItems({ rows: sched.rows, doc, finals, nowMs }), [sched.rows, doc, finals, nowMs]);
  const base = boardView({ items, day: cur, filter: "all", byCode: d.byCode });
  const filter = pick ?? (base.counts.live > 0 ? "live" : "all");           // until a chip is tapped: show what is in play, else the whole day
  const view = filter === "all" ? base : boardView({ items, day: cur, filter, byCode: d.byCode });
  // dir: which side the list slides in from (a later day comes from the right, an earlier one from the left)
  const choose = (k) => { if (k !== cur) setDir(k > cur ? "from-right" : "from-left"); setDay(k === today ? null : k); setPick(filter === "live" ? "all" : pick); };
  useHotkeys({ ArrowLeft: () => choose(shiftDay(cur, -1)), ArrowRight: () => choose(shiftDay(cur, 1)), t: () => choose(today), a: () => setPick("all"), l: () => setPick("live"), f: () => setPick("finished"), u: () => setPick("upcoming") });
  const status = err ? <Alert variant="danger" className="mb-0">Could not read live data: {err}. If this says permission denied, deploy the updated Firestore rules (see README).</Alert>
    : feed.state === "none" ? <Alert variant="secondary" className="mb-0">The live feed is not connected. Start the runner (<code>npm start</code>, see README) so scores and minutes appear here. Until then, matches past their kick-off time are marked “Kick-off passed” without a score.</Alert>
    : feed.state === "halted" ? <Alert variant="warning" className="mb-0">Live updates are paused: {HALT[feed.halt] ?? feed.halt}.</Alert>
    : feed.state === "stale" ? <Alert variant="warning" className="mb-0">The live feed is delayed: its last update was {fmtDur(feed.ageS)} ago. Anything below may be out of date.</Alert>
    : feed.state === "idle" ? <Alert variant="secondary" className="mb-0">No matches are live right now (checked {fmtDur(feed.ageS)} ago).</Alert>
    : <Alert variant="success" className="mb-0">Live feed updated {fmtDur(feed.ageS)} ago{doc?.pollS ? `, checked about every ${doc.pollS} s` : ""}. Minutes and scores are shown exactly as reported, not counted on this device.</Alert>;
  const heading = filter === "live" ? "Matches in play now" : new Date(Date.parse(cur + "T12:00:00Z")).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="d-flex flex-column gap-3">
      <div><h1 className="h3 mb-1">Live</h1><p className="text-body-secondary mb-0">Matches by competition and day. Times are shown in your time zone: {tzName() || "local"} ({tzAt(nowMs / 1000)}).</p></div>
      {status}
      {clockOff && <Alert variant="warning" className="mb-0">This device’s clock looks wrong by about {fmtDur(Math.abs(lagMs) / 1000)}. “Kick-off passed” and “updated … ago” need an accurate clock, so check your date and time settings.</Alert>}
      {(doc?.partial || doc?.bad > 0) && <Alert variant="warning" className="mb-0">{doc.partial ? "The live list may be incomplete. " : ""}{doc.bad > 0 ? `${doc.bad} live record(s) could not be read.` : ""}</Alert>}
      {sched.err && <Alert variant="danger" className="mb-0">Could not read the match schedule: {sched.err}. If this says permission denied, deploy the Firestore rules (see README).</Alert>}
      <DayStrip day={cur} today={today} onPick={choose} />
      <div className="d-flex flex-wrap align-items-center gap-2">
        <ButtonGroup size="sm">{CHIPS.map(([k, l]) => <Button key={k} variant={filter === k ? "primary" : "outline-secondary"} onClick={() => setPick(k)}>{l} <Badge bg={k === "live" && view.counts.live > 0 ? "danger" : "dark"} className="ms-1">{view.counts[k]}</Badge></Button>)}</ButtonGroup>
        <span className="small fw-semibold text-body-secondary ms-1">{heading}</span>
      </div>
      <div key={cur} className={"d-flex flex-column gap-3 day-slide" + (dir ? " " + dir : "")}>
      {sched.loading && !sched.rows && <Spin kind="matches" />}
      {!sched.loading && !view.total && (
        <Alert variant="secondary" className="mb-0">{filter === "live" ? "No matches are in play right now." : sched.missing && !sched.err ? "No schedule is stored for this date yet. It is built after each data sync (see README: npm run schedule:local)." : "No matches for this filter on this day."}</Alert>)}
      {view.groups.map((g) => (
        <Card key={g.key}><Card.Body>
          <div className="d-flex align-items-center gap-2 mb-3"><LeagueLogo lg={{ id: g.id, name: g.name }} size={26} /><h2 className="h6 mb-0">{g.name}</h2>{g.country && <span className="small text-body-secondary">{g.country}</span>}</div>
          <div className="list-group">{g.rows.map((x) => <Row key={x.r.id} x={x} d={d} nav={nav} />)}</div>
        </Card.Body></Card>))}
      </div>
    </div>
  );
}
