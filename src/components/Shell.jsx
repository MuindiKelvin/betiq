import { useEffect, useRef, useState } from "react";
import { Button, Form, Offcanvas } from "react-bootstrap";
import { Crest, LeagueLogo, hit } from "./ui";
import Credit from "./Credit";

export const TABS = [["competitions", "Competitions", "globe2"], ["analyze", "Match Analysis", "bar-chart-line-fill"], ["picks", "My Picks", "star-fill"], ["history", "History", "clock-history"], ["model", "Model", "clipboard-data"],
  ["profile", "Profile", "person-fill"], ["help", "Help", "question-circle-fill"]];

export function SideNav({ tab, onSelect, user, onSignOut }) {
  return (
    <div className="d-flex flex-column h-100">
      <div className="side-brand"><i className="bi bi-dribbble brand-ball" /><div><div className="brand">Bet<span>IQ</span></div><div className="tiny text-body-secondary">Analyze · Predict · Bet Smart</div></div></div>
      <nav className="px-3 py-3 d-flex flex-column gap-1 flex-fill">
        {TABS.map(([k, l, i]) => <button key={k} type="button" className={"side-link" + (tab === k ? " active" : "")} onClick={() => onSelect(k)}><i className={`bi bi-${i}`} />{l}</button>)}
      </nav>
      <div className="side-user">
        {user.photoURL ? <img src={user.photoURL} alt="" width="40" height="40" className="rounded-circle" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{(user.displayName ?? "?")[0]}</span>}
        <div className="text-truncate"><div className="fw-semibold text-truncate">{user.displayName ?? "Account"}</div><div className="tiny text-body-secondary text-truncate">{user.email}</div></div>
      </div>
      <button type="button" className="side-link mx-3 mb-2" onClick={onSignOut}><i className="bi bi-box-arrow-left" />Sign Out</button>
      <Credit className="side-credit" />
    </div>
  );
}

// Search teams and competitions. Team -> Match Analysis with that team as home; competition -> Matches.
export function GlobalSearch({ d, onTeam, onComp }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), box = useRef(null);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  const on = q.trim().length > 0;
  const teams = on ? Object.values(d.byId).filter((t) => hit(q, t.name)).slice(0, 6) : [], comps = on ? d.entries.filter((c) => hit(q, `${c.name} ${c.country}`)).slice(0, 4) : [];
  const pick = (fn) => { fn(); setQ(""); setOpen(false); };
  return (
    <div className="gsearch position-relative flex-fill" ref={box}>
      <div className="input-group"><span className="input-group-text"><i className="bi bi-search" /></span>
        <Form.Control value={q} placeholder="Search teams, competitions…" aria-label="Search teams and competitions" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} /></div>
      {open && on && (
        <div className="gsearch-menu card shadow-lg">
          {comps.map((c) => <button type="button" key={c.code} className="dropdown-item py-2 d-flex align-items-center gap-2" onClick={() => pick(() => onComp(c.code))}><LeagueLogo lg={c} size={22} />{c.name}<span className="ms-auto tiny text-body-secondary">{c.country}</span></button>)}
          {teams.map((t) => <button type="button" key={t.id} className="dropdown-item py-2 d-flex align-items-center gap-2" onClick={() => pick(() => onTeam(t))}><Crest team={t} size={22} />{t.name}<span className="ms-auto tiny text-body-secondary">{d.byCode[t.league]?.name}</span></button>)}
          {!teams.length && !comps.length && <div className="px-3 py-2 small text-body-secondary">No results</div>}
        </div>)}
    </div>
  );
}

export const MobileNav = ({ show, onHide, ...p }) => (
  <Offcanvas show={show} onHide={onHide} className="side-offcanvas" style={{ width: "min(270px, 86vw)" }}><Offcanvas.Body className="p-0"><SideNav {...p} onSelect={(k) => { p.onSelect(k); onHide(); }} /></Offcanvas.Body></Offcanvas>
);
export const MenuButton = ({ onClick }) => <Button variant="outline-secondary" className="d-lg-none" aria-label="Menu" onClick={onClick}><i className="bi bi-list fs-5" /></Button>;
