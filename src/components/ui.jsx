import { usePhase } from "../lib/useLive";
import PhaseMid from "./PhaseMid";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Form as BSForm, InputGroup, Pagination, Spinner } from "react-bootstrap";
import { dayLabel, groupByDay, timeLabel } from "../lib/util";

export const Spin = () => <div className="text-center py-5"><Spinner animation="border" variant="primary" role="status"><span className="visually-hidden">Loading</span></Spinner></div>;
export const Load = ({ s, children }) => (s.err ? <div className="alert alert-danger">{s.err}</div> : s.data ? children(s.data) : <Spin />);

const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n = "?") => n.replace(/[^\p{L} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const IMG = "https://sports.bzzoiro.com/img";
// BSD image API (free, for identifying teams/leagues/players inside the app). Falls back to initials when an image is missing.
// size: pixels (number) or any CSS length such as "clamp(52px, 17vw, 84px)" for crests that must shrink on small screens
function Img({ kind, id, name, size, round }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [id]);
  const px = typeof size === "number" ? `${size}px` : size, box = { width: px, height: px };
  if (id == null || bad) return <span className="crest-fallback" style={{ ...box, fontSize: `calc(${px} * 0.38)`, background: `hsl(${hue(id ?? name)} 45% 28%)`, borderRadius: round ? "50%" : undefined }}>{initials(name)}</span>;
  return <img className="crest" src={`${IMG}/${kind}/${id}/`} alt="" style={{ ...box, borderRadius: round ? "50%" : undefined, objectFit: round ? "cover" : "contain" }} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
}
export const Crest = ({ team, size = 28 }) => <Img kind="team" id={team?.id} name={team?.name} size={size} />;
export const LeagueLogo = ({ lg, size = 36 }) => <Img kind="league" id={lg?.id} name={lg?.name} size={size} />;
export const PlayerPhoto = ({ id, name, size = 40 }) => <Img kind="player" id={id} name={name} size={size} round />;
export const ManagerPhoto = ({ id, name, size = 40 }) => <Img kind="manager" id={id} name={name} size={size} round />;
export const VenuePhoto = ({ id, name, size = 40 }) => <Img kind="venue" id={id} name={name} size={size} />;

const CHIP = { W: "success", D: "secondary", L: "danger" };
export const FormChips = ({ r = [], size = 26 }) => (
  <div className="d-flex flex-wrap gap-1 align-items-center">
    {!r.length && <span className="text-body-secondary small">No data</span>}
    {r.map((x, i) => <Badge key={i} pill bg={CHIP[x]} className="d-inline-flex align-items-center justify-content-center" style={{ width: size, height: size }}>{x}</Badge>)}
  </div>
);

// Verified-account mark in the app's gold; shown next to the name of a user whose email is verified (lib/verified.js)
export const VerifiedBadge = ({ size = "1em", className = "" }) => <i className={`bi bi-patch-check-fill verified-mark ${className}`} style={{ fontSize: size }} role="img" aria-label="Verified email" title="Verified email" />;

export const Stat = ({ value, label, sub }) => (
  <div className="text-center"><div className="num fs-2">{value}</div><div className="small text-body-secondary">{label}</div>{sub && <div className="tiny text-body-secondary">{sub}</div>}</div>
);

// Searchable team combobox (type to filter, click to choose)
export function TeamSelect({ label, teams, value, onChange, disabledId, placeholder }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), box = useRef(null);
  const sel = teams.find((t) => t.id === value);
  const list = useMemo(() => teams.filter((t) => t.id !== disabledId && t.name.toLowerCase().includes(q.toLowerCase())), [teams, q, disabledId]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="team-select position-relative" ref={box}>
      <div className="tiny text-uppercase text-body-secondary mb-1 ls">{label}</div>
      <button type="button" className="form-select text-start d-flex align-items-center gap-2" aria-label={label} onClick={() => { setOpen(!open); setQ(""); }}>
        {sel ? <><Crest team={sel} size={22} /><span className="text-truncate">{sel.name}</span></> : <span className="text-body-secondary">{placeholder ?? "Choose team"}</span>}
      </button>
      {open && (
        <div className="team-menu card shadow-lg">
          <BSForm.Control autoFocus size="sm" placeholder="Search team…" value={q} onChange={(e) => setQ(e.target.value)} className="m-2 w-auto" />
          <div className="team-menu-list">
            {list.map((t) => (
              <button type="button" key={t.id} className="dropdown-item d-flex align-items-center gap-2 py-2" onClick={() => { onChange(t.id); setOpen(false); }}>
                <Crest team={t} size={22} />{t.name}
              </button>))}
            {!list.length && <div className="px-3 py-2 text-body-secondary small">No team found</div>}
          </div>
        </div>)}
    </div>
  );
}

// Three-segment probability bar (home / draw / away)
export function ProbBar({ p, h, a, height = 34 }) {
  const seg = [[p.home, "seg-home", h], [p.draw, "seg-draw", "Draw"], [p.away, "seg-away", a]];
  return (
    <div className="prob-bar" style={{ height }}>
      {seg.map(([v, c, l]) => <div key={c} className={c} style={{ width: v * 100 + "%" }} title={`${l} ${(v * 100).toFixed(0)}%`}><span>{v >= 0.09 ? Math.round(v * 100) + "%" : ""}</span></div>)}
    </div>
  );
}

// Mirrored comparison row: bar grows from the centre towards each side
export function CompareRow({ label, a, b, fmt = (x) => x.toFixed(2), better }) {
  const has = a != null && b != null, tot = has ? Math.abs(a) + Math.abs(b) : 0, wa = tot ? (Math.abs(a) / tot) * 100 : 50;
  const lead = !has || a === b || !better ? null : (a > b) === (better === "high") ? "a" : "b";
  return (
    <div className="cmp-row">
      <div className={"cmp-val text-end" + (lead === "a" ? " lead" : "")}>{a == null ? "n/a" : fmt(a)}</div>
      <div className="cmp-mid">
        <div className="tiny text-body-secondary text-center mb-1">{label}</div>
        <div className="cmp-bars"><div className="cmp-a"><i className={lead === "a" ? "lead" : ""} style={{ width: wa + "%" }} /></div><div className="cmp-b"><i className={lead === "b" ? "lead" : ""} style={{ width: 100 - wa + "%" }} /></div></div>
      </div>
      <div className={"cmp-val" + (lead === "b" ? " lead" : "")}>{b == null ? "n/a" : fmt(b)}</div>
    </div>
  );
}

const LIVE = { inprogress: ["danger", "Live"], postponed: ["warning", "Postponed"], canceled: ["warning", "Cancelled"], cancelled: ["warning", "Cancelled"] };
export function MatchRow({ m, byId, onOpen }) {
  const st = LIVE[m.s], H = byId[m.h], A = byId[m.a], p = usePhase(m);
  return (
    <button type="button" className="list-group-item list-group-item-action d-flex align-items-center gap-2 py-3" title="Open match" onClick={() => onOpen({ h: m.h, a: m.a, league: m.league ?? H?.league, id: m.id, t: m.t, hg: m.hg, ag: m.ag, s: m.s, r: m.r, rn: m.rn, g: m.g })}>
      <span className="side d-flex align-items-center justify-content-end gap-2 text-end"><span className="fw-medium text-truncate">{H?.name ?? "?"}</span><Crest team={H} /></span>
      <span className="match-mid text-center">
        <PhaseMid m={m} p={p} st={st} />
      </span>
      <span className="side d-flex align-items-center gap-2"><Crest team={A} /><span className="fw-medium text-truncate">{A?.name ?? "?"}</span></span>
    </button>
  );
}
export const Days = ({ list, byId, onOpen }) => groupByDay(list).map(([label, items]) => (
  <div key={label} className="mb-3">
    <div className="small fw-semibold text-body-secondary mb-2 px-1">{label}</div>
    <div className="list-group">{items.map((m) => <MatchRow key={m.id} m={m} byId={byId} onOpen={onOpen} />)}</div>
  </div>));

// every word typed must appear in the text
export const hit = (q, text) => { const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean); const t = String(text).toLowerCase(); return w.every((x) => t.includes(x)); };

export const SearchBox = ({ value, onChange, placeholder = "Search…", style }) => (
  <InputGroup className="search-box" style={style}>
    <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
    <BSForm.Control type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
  </InputGroup>
);

// page is 0-based; resets to the first page whenever resetKey changes
export function usePaged(list, size, resetKey) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  const pages = Math.max(1, Math.ceil(list.length / size)), p = Math.min(page, pages - 1);
  return { page: p, pages, setPage, slice: list.slice(p * size, (p + 1) * size), total: list.length };
}
export function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null;
  const start = Math.max(0, Math.min(page - 2, pages - 5)), nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <Pagination size="sm" className="justify-content-center mb-0 flex-wrap">
      <Pagination.Prev disabled={page === 0} onClick={() => onChange(page - 1)} />
      {start > 0 && <><Pagination.Item onClick={() => onChange(0)}>1</Pagination.Item>{start > 1 && <Pagination.Ellipsis disabled />}</>}
      {nums.map((n) => <Pagination.Item key={n} active={n === page} onClick={() => onChange(n)}>{n + 1}</Pagination.Item>)}
      {start + 5 < pages && <>{start + 5 < pages - 1 && <Pagination.Ellipsis disabled />}<Pagination.Item onClick={() => onChange(pages - 1)}>{pages}</Pagination.Item></>}
      <Pagination.Next disabled={page >= pages - 1} onClick={() => onChange(page + 1)} />
    </Pagination>
  );
}

export function MatchList({ fixtures, results, team, byId, onOpen, pageSize = 15 }) {
  const [view, setView] = useState(fixtures.length ? "fixtures" : "results"), [q, setQ] = useState("");
  const mine = (m) => (!team || m.h === team || m.a === team) && (!q.trim() || hit(q, `${byId[m.h]?.name} ${byId[m.a]?.name} ${dayLabel(m.t)}`));
  const src = { fixtures: fixtures.filter(mine), results: results.filter(mine) };
  const pg = usePaged(src[view], pageSize, view + q + team);
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <div className="btn-group" role="group">
          {[["fixtures", "Fixtures"], ["results", "Results"]].map(([k, l]) => (
            <Button key={k} size="sm" variant={view === k ? "primary" : "outline-secondary"} onClick={() => setView(k)}>{l} <Badge bg="dark" className="ms-1">{src[k].length}</Badge></Button>))}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search team or date" style={{ maxWidth: 300 }} />
        {view === "results" && <span className="tiny text-body-secondary">Tap a finished match for its stats, scorers and teamsheets</span>}
      </div>
      {pg.slice.length ? <Days list={pg.slice} byId={byId} onOpen={onOpen} /> : <div className="alert alert-secondary">No {view} found.</div>}
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </>
  );
}

// Circular probability gauge
export function Ring({ value, label, color, size = 96 }) {
  const r = 38, c = 2 * Math.PI * r, v = Math.min(1, Math.max(0, value));
  return (
    <div className="ring text-center" style={{ maxWidth: size }}>
      <svg viewBox="0 0 100 100" className="ring-svg" role="img" aria-label={`${label} ${Math.round(v * 100)}%`}>
        <circle cx="50" cy="50" r={r} className="ring-bg" />
        <circle cx="50" cy="50" r={r} className="ring-fg" style={{ stroke: color }} strokeDasharray={c} strokeDashoffset={c * (1 - v)} transform="rotate(-90 50 50)" />
        <text x="50" y="57" textAnchor="middle" className="ring-num">{Math.round(v * 100)}%</text>
      </svg>
      <div className="ring-label">{label}</div>
    </div>
  );
}

// Points per match (win 3, draw 1, loss 0), oldest to newest. matches = newest-first list from teamMatches().
export function Spark({ matches, color }) {
  const pts = [...matches].reverse().map((m) => (m.res === "W" ? 3 : m.res === "D" ? 1 : 0));
  if (pts.length < 2) return null;
  const W = 140, H = 44, pad = 6, x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1), y = (v) => H - pad - (v / 3) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="Form trend">
      <path d={pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} fill="none" style={{ stroke: color }} strokeWidth="2" />
      {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" style={{ fill: color }} />)}
    </svg>
  );
}
