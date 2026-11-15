import { Badge } from "react-bootstrap";
import { minuteLabel } from "../lib/phase";
import { timeLabel } from "../lib/util";

// Centre of a match row: score and minute when live, a plain "Kick-off passed" when the schedule says it started but nothing confirms it
export default function PhaseMid({ m, p, st }) {
  const sc = (a, b) => <span className="score">{a ?? "–"}–{b ?? "–"}</span>;
  switch (p?.kind) {
    case "live": return <><div>{sc(p.row.hg, p.row.ag)}</div><Badge bg="danger" className={p.stale ? "opacity-50" : ""} title={p.stale ? "The live feed is delayed, so this may be out of date" : "Live"}>{minuteLabel(p.row.min) ?? "Live"}</Badge></>;
    case "overdue": return <><div className="small text-body-secondary">{timeLabel(p.t)}</div><Badge bg="warning" text="dark" title="The scheduled kick-off time has passed. The live feed has not confirmed the match yet.">Kick-off passed</Badge></>;
    case "left": return <><div className="small text-body-secondary">{timeLabel(p.t)}</div><Badge bg="secondary" title="No longer in the live feed; the status is being confirmed">Left live feed</Badge></>;
    case "finished": return <><div>{sc(p.hg ?? m.hg, p.ag ?? m.ag)}</div><Badge bg="secondary" title="Full time">FT</Badge></>;
    case "postponed": case "cancelled": case "disrupted": return <Badge bg="warning" text="dark">{p.kind === "disrupted" ? p.raw : p.kind === "postponed" ? "Postponed" : "Cancelled"}</Badge>;
    case "upcoming": if (p.moved) return <><div className="small text-body-secondary">{timeLabel(p.t)}</div><Badge bg="warning" text="dark" title="The kick-off time changed">Rescheduled</Badge></>; break;
    default: break;
  }
  return st ? <Badge bg={st[0]}>{st[1]}</Badge> : m.hg != null ? <span className="score">{m.hg}–{m.ag}</span> : <span className="small text-body-secondary">{timeLabel(p?.t ?? m.t)}</span>;
}
