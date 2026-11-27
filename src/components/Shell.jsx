import { useLiveCount } from "../lib/useLive";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Offcanvas } from "react-bootstrap";
import { Crest, LeagueLogo, VerifiedBadge, hit } from "./ui";
import Credit from "./Credit";
import { useSlider } from "./SlideNav";
import { useHotkeys, useShortcuts } from "./Shortcuts";
import { isVerified } from "../lib/verified";

export const TABS = [["explore", "Explore", "compass"], ["live", "Live", "broadcast"], ["daily", "Daily Picks", "calendar2-check"], ["picks", "My Picks", "star-fill"], ["history", "History", "clock-history"], 
  ["profile", "Profile", "person-fill"], ["help", "Help", "question-circle-fill"]];

export function SideNav({ tab, onSelect, user, onSignOut }) {
  const liveCount = useLiveCount(), nav = useRef(null), { openHelp } = useShortcuts();
  useSlider(nav, ".side-link.active", tab);   // the gold highlight glides to the active link
  return (
    <div className="d-flex flex-column h-100">
      <div className="side-brand"><i className="bi bi-dribbble brand-ball" /><div><div className="brand">Bet<span>IQ</span></div><div className="tiny text-body-secondary">Analyze · Predict · Bet Smart</div></div></div>
      <nav ref={nav} className="side-nav px-3 py-3 d-flex flex-column gap-1 flex-fill">
        {TABS.map(([k, l, i]) => <button key={k} type="button" className={"side-link" + (tab === k ? " active" : "")} onClick={() => onSelect(k)}><i className={`bi bi-${i}`} />{l}{k === "live" && liveCount > 0 && <span className="badge bg-danger live-pulse ms-auto">{liveCount}</span>}</button>)}
        <span className="ind" aria-hidden="true" />
      </nav>
      <div className="side-user">
        {user.photoURL ? <img src={user.photoURL} alt="" width="40" height="40" className="rounded-circle" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{(user.displayName ?? "?")[0]}</span>}
        <div className="text-truncate"><div className="fw-semibold text-truncate">{user.displayName ?? "Account"}{isVerified(user) && <VerifiedBadge className="ms-1" />}</div><div className="tiny text-body-secondary text-truncate">{user.email}</div></div>
      </div>
      <button type="button" className="side-link mx-3 mb-1 d-none d-lg-flex" style={{ width: "calc(100% - 2rem)" }} onClick={openHelp}><i className="bi bi-keyboard" />Shortcuts<kbd className="ms-auto">?</kbd></button>
      <button type="button" className="side-link mx-3 mb-2" onClick={onSignOut}><i className="bi bi-box-arrow-left" />Sign Out</button>
      <Credit className="side-credit" />
    </div>
  );
}

// Search teams and competitions. Team -> its team page; competition -> its pages (Explore).
// Keyboard: / or Ctrl/Cmd+K focus it, Up / Down move through the results, Enter opens the highlighted one (the first if none is), Esc closes it.
export function GlobalSearch({ d, onTeam, onComp }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [active, setActive] = useState(-1), box = useRef(null), input = useRef(null), menu = useRef(null);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  const focus = () => { input.current?.focus(); input.current?.select(); setOpen(true); };
  useHotkeys({ "/": focus, "mod+k": focus });
  const on = q.trim().length > 0;
  const teams = on ? Object.values(d.byId).filter((t) => hit(q, t.name)).slice(0, 6) : [], comps = on ? d.entries.filter((c) => hit(q, `${c.name} ${c.country}`)).slice(0, 4) : [];
  const items = useMemo(() => [...comps.map((c) => ({ key: "c" + c.code, c })), ...teams.map((t) => ({ key: "t" + t.id, t }))], [q, d]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(-1); }, [q]);
  useEffect(() => { menu.current?.querySelector(".kb-active")?.scrollIntoView({ block: "nearest" }); }, [active]);
  const pick = (fn) => { fn(); setQ(""); setOpen(false); setActive(-1); };
  const choose = (it) => pick(() => (it.c ? onComp(it.c.code) : onTeam(it.t)));
  const onKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!items.length) return; e.preventDefault(); setOpen(true); setActive((a) => (e.key === "ArrowDown" ? Math.min(items.length - 1, a + 1) : Math.max(0, a - 1))); }
    else if (e.key === "Enter") { const it = items[active >= 0 ? active : 0]; if (open && on && it) { e.preventDefault(); choose(it); } }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); e.currentTarget.blur(); }
  };
  const shown = open && on, row = (it, i, body) => <button type="button" role="option" id={"gs-opt-" + i} aria-selected={active === i} key={it.key} className={"dropdown-item py-2 d-flex align-items-center gap-2" + (active === i ? " kb-active" : "")} onMouseMove={() => active !== i && setActive(i)} onClick={() => choose(it)}>{body}</button>;
  return (
    <div className="gsearch position-relative flex-fill" ref={box}>
      <div className="input-group"><span className="input-group-text"><i className="bi bi-search" /></span>
        <Form.Control ref={input} value={q} placeholder="Search teams, competitions…  ( / )" aria-label="Search teams and competitions" role="combobox" aria-expanded={shown} aria-controls="gsearch-list" aria-autocomplete="list" aria-activedescendant={shown && active >= 0 ? "gs-opt-" + active : undefined}
          onFocus={() => setOpen(true)} onKeyDown={onKey} onChange={(e) => { setQ(e.target.value); setOpen(true); }} /></div>
      {shown && (
        <div className="gsearch-menu card shadow-lg" id="gsearch-list" role="listbox" ref={menu}>
          {items.map((it, i) => (it.c
            ? row(it, i, <><LeagueLogo lg={it.c} size={22} />{it.c.name}<span className="ms-auto tiny text-body-secondary">{it.c.country}</span></>)
            : row(it, i, <><Crest team={it.t} size={22} />{it.t.name}<span className="ms-auto tiny text-body-secondary">{d.byCode[it.t.league]?.name}</span></>)))}
          {!items.length && <div className="px-3 py-2 small text-body-secondary">No results</div>}
        </div>)}
    </div>
  );
}

export const MobileNav = ({ show, onHide, ...p }) => (
  <Offcanvas show={show} onHide={onHide} className="side-offcanvas" style={{ width: "min(270px, 86vw)" }}><Offcanvas.Body className="p-0"><SideNav {...p} onSelect={(k) => { p.onSelect(k); onHide(); }} /></Offcanvas.Body></Offcanvas>
);
export const MenuButton = ({ onClick }) => <Button variant="outline-secondary" className="d-lg-none" aria-label="Menu" onClick={onClick}><i className="bi bi-list fs-5" /></Button>;
export function HelpButton() {
  const { openHelp } = useShortcuts();
  return <Button variant="outline-secondary" className="d-none d-md-inline-flex align-items-center" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={openHelp}><i className="bi bi-keyboard" /></Button>;
}
