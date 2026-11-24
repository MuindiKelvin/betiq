import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Form, ListGroup } from "react-bootstrap";
import { dayKey, dayName, shiftDay } from "../lib/board";
import { DAILY, dailyReceipt, groupByComp, pickId } from "../lib/daily";
import { confirmPick, savedPickIds, useDaily } from "../lib/useDaily";
import { useLive } from "../lib/useLive";
import { phaseOf } from "../lib/phase";
import { MARKETS, pct, timeLabel } from "../lib/util";
import { downloadReceipt } from "../lib/receipts";
import { LeagueLogo, Spin } from "../components/ui";

const DAYS = 3;   // today and the next two local days

export default function Daily({ user, d }) {
  const today = dayKey(Date.now() / 1000), days = Array.from({ length: DAYS }, (_, i) => shiftDay(today, i));
  const [day, setDay] = useState(today), [comp, setComp] = useState(""), [opened, setOpened] = useState({}), [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const { rows = [], missing, loading, err } = useDaily(day), { doc: liveDoc, finals, nowMs } = useLive();
  useEffect(() => { savedPickIds(user.uid).then(setSaved).catch((e) => setMsg({ type: "danger", text: "Could not read your picks: " + e.message })); }, [user]);
  useEffect(() => { setComp(""); setOpened({}); }, [day]);

  // a pick can be confirmed only while its match has not started (same rule as saving from the analysis page)
  const open = (x) => phaseOf({ id: x.id, t: x.t }, liveDoc, nowMs, finals).kind === "upcoming";
  const groups = useMemo(() => groupByComp(rows, d.byCode), [rows, d.byCode]);
  const shown = comp ? groups.filter((g) => g.code === comp) : groups, flat = shown.flatMap((g) => g.picks);
  const todo = (list) => list.filter((x) => saved && !saved.has(pickId(x)) && open(x));
  // competitions open or closed: the choice of the user wins; otherwise only the first is open (all of a single one)
  const isOpen = (g) => (g.code in opened ? opened[g.code] : g.code === shown[0]?.code);
  const toggle = (g) => setOpened((o) => ({ ...o, [g.code]: !isOpen(g) }));
  const setAll = (v) => setOpened(Object.fromEntries(shown.map((g) => [g.code, v])));
  const who = user.displayName || user.email || "";

  async function confirm(list) {
    setBusy(true); setMsg(null);
    const res = await Promise.allSettled(list.map((x) => confirmPick(user.uid, x)));
    setSaved((s) => new Set([...s, ...list.filter((_, i) => res[i].status === "fulfilled").map(pickId)]));
    const bad = res.filter((r) => r.status === "rejected");
    setMsg(bad.length ? { type: "danger", text: `${bad.length} of ${list.length} could not be saved: ${bad[0].reason?.message ?? "unknown error"}` } : { type: "success", text: `${list.length} pick${list.length > 1 ? "s" : ""} saved to My Picks.` });
    setBusy(false);
  }
  const download = (list, code = null) => downloadReceipt(dailyReceipt(list, { day, code }), { who, title: "DAILY PICKS", badge: `MODEL PICKS · ${list.length}`, leagueName: (c) => d.byCode[c]?.name ?? null });

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex align-items-center flex-wrap gap-2">
        <h1 className="h3 mb-0 me-auto">Daily Picks</h1>
        {flat.length > 0 && <>
          <Button size="sm" variant="outline-secondary" onClick={() => download(flat, comp || null)}><i className="bi bi-download me-1" />Download {comp ? "this competition" : "all"}</Button>
          <Button size="sm" variant="primary" disabled={busy || !todo(flat).length} onClick={() => confirm(todo(flat))}><i className="bi bi-check2-all me-1" />Confirm {comp ? "these" : "all"}{todo(flat).length ? ` (${todo(flat).length})` : ""}</Button>
        </>}
      </div>
      <p className="small text-body-secondary mb-0">The model's most likely result, goals or both-teams-to-score pick for each upcoming match, chosen automatically after every data sync (up to {DAILY.cap} per competition and day, only above a minimum probability, raised for cups and continental competitions). They carry no bookmaker odds: confirm the ones you like to save them to My Picks, then compare any of them with a real price in the Value finder.</p>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {days.map((k) => <Button key={k} size="sm" variant={k === day ? "primary" : "outline-secondary"} onClick={() => setDay(k)}>{dayName(k, today, { month: true })}</Button>)}
        {shown.length > 1 && <div className="d-flex gap-2 ms-md-auto"><Button size="sm" variant="outline-secondary" onClick={() => setAll(true)}><i className="bi bi-arrows-expand me-1" />Expand all</Button><Button size="sm" variant="outline-secondary" onClick={() => setAll(false)}><i className="bi bi-arrows-collapse me-1" />Collapse all</Button></div>}
        {groups.length > 1 && <Form.Select size="sm" aria-label="Competition" value={comp} onChange={(e) => setComp(e.target.value)} style={{ maxWidth: 260 }} className={shown.length > 1 ? "" : "ms-md-auto"}><option value="">All competitions ({groups.length})</option>{groups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}</Form.Select>}
      </div>
      {msg && <Alert variant={msg.type} className="mb-0" dismissible onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {err && <Alert variant="danger" className="mb-0">Could not load the picks: {err}</Alert>}
      {loading && !err && <Spin />}
      {!loading && !err && missing && <Alert variant="secondary" className="mb-0">Daily picks have not been built yet. They appear after the next data sync.</Alert>}
      {!loading && !err && !missing && !groups.length && <Alert variant="secondary" className="mb-0">No picks for this day: no upcoming match cleared the minimum probability, or the teams playing have too little data.</Alert>}
      {shown.map((g) => (
        <Card key={g.code}>
          <Card.Header className="d-flex align-items-center gap-2 flex-wrap receipt-head" role="button" tabIndex={0} aria-expanded={isOpen(g)} onClick={() => toggle(g)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(g); } }}>
            <i className={`bi bi-chevron-${isOpen(g) ? "down" : "right"} text-body-secondary`} aria-hidden="true" />
            <LeagueLogo lg={d.byCode[g.code] ?? { id: g.id, name: g.name }} size={26} />
            <div className="me-auto"><div className="fw-semibold">{g.name}</div><div className="tiny text-body-secondary">{g.country || "International"} · {g.picks.length} pick{g.picks.length > 1 ? "s" : ""}{saved && saved.size > 0 && <> · {g.picks.filter((x) => saved.has(pickId(x))).length} confirmed</>}{d.byCode[g.code]?.kind === "comp" && <Badge bg="warning" text="dark" className="ms-2" title="Cup or continental competition: strengths come only from this competition's own matches, so the minimum probability is higher and the estimate rougher">Rough model</Badge>}</div></div>
            <Button size="sm" variant="outline-secondary" onClick={(e) => { e.stopPropagation(); download(g.picks, g.code); }}><i className="bi bi-download me-1" />Download</Button>
            <Button size="sm" variant="outline-primary" disabled={busy || !todo(g.picks).length} onClick={(e) => { e.stopPropagation(); confirm(todo(g.picks)); }}><i className="bi bi-check2 me-1" />Confirm{todo(g.picks).length ? ` (${todo(g.picks).length})` : ""}</Button>
          </Card.Header>
          {isOpen(g) && <ListGroup variant="flush">{g.picks.map((x) => {
            const done = saved?.has(pickId(x)), can = !done && open(x);
            return (
              <ListGroup.Item key={pickId(x)} className="d-flex align-items-center gap-3 py-3 flex-wrap">
                <div className="flex-fill" style={{ minWidth: 180 }}>
                  <div className="fw-medium">{x.hn} vs {x.an}</div>
                  <div className="small text-body-secondary"><i className="bi bi-clock me-1" />{timeLabel(x.t)} · expected goals {x.x[0].toFixed(1)}–{x.x[1].toFixed(1)}</div>
                </div>
                <div className="text-end"><div>{MARKETS[x.m].sel[x.s]}</div><div className="small text-body-secondary">{MARKETS[x.m].label} · {pct(x.p)}</div></div>
                <div className="text-end" style={{ minWidth: 120 }}>
                  {done ? <Badge bg="success">Confirmed</Badge>
                    : can ? <Button size="sm" variant="outline-primary" disabled={busy || !saved} onClick={() => confirm([x])}>Confirm</Button>
                    : <Badge bg="secondary" title="Picks can only be confirmed before kick-off">Closed</Badge>}
                </div>
              </ListGroup.Item>);
          })}</ListGroup>}
        </Card>))}
      <p className="tiny text-body-secondary mb-0"><i className="bi bi-exclamation-triangle me-1" />Statistical estimates, not guarantees. The same model as the Analysis tab; a pick can differ slightly if you have loaded all-competition head-to-head there. 18+, bet responsibly.</p>
    </div>
  );
}
