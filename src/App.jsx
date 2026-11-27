import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { flushSync } from "react-dom";
import { Alert, Button, Col, Container, Row } from "react-bootstrap";
import { auth, provider } from "./lib/firebase";
import { loadCatalog, loadTeamIndex } from "./lib/data";
import { dayLabel } from "./lib/util";
import Backdrop from "./components/Backdrop";
import { Spin } from "./components/ui";
import Analyze from "./pages/Analyze";
import Explore from "./pages/Explore";
import Competitions from "./pages/Competitions";
import Competition from "./pages/Competition";
import Team from "./pages/Team";
import Player from "./pages/Player";
import { Manager, Referee, Venue } from "./pages/People";
import Picks from "./pages/Picks";
import Live from "./pages/Live";
import Daily from "./pages/Daily";
import { LiveProvider } from "./lib/useLive";
import MatchView from "./pages/MatchView";
import Profile from "./pages/Profile";
import Help from "./pages/Help";
import Credit from "./components/Credit";
import { GlobalSearch, HelpButton, MenuButton, MobileNav, SideNav, TABS } from "./components/Shell";
import { ToastProvider } from "./components/Toasts";
import { ShortcutsProvider, useHotkeys } from "./components/Shortcuts";
import { morph, visibleRow } from "./lib/vt";
import { HOME, Trail, parentOf, routeKey } from "./lib/route";

// history calls can throw in a sandboxed frame; the app then simply keeps working without the browser buttons
const hist = (fn, ...a) => { try { window.history[fn](...a); } catch { /* no history control here */ } };

const FEATURES = [
  ["arrow-left-right", "Head-to-head", "Every past meeting across five seasons, with goals, BTTS and over/under tendencies."],
  ["activity", "Current form", "Last five results for each side, points, goals, and how that compares with their season."],
  ["bar-chart-line", "Deep statistics", "Possession, shots, corners, cards and xG, with squads, players and transfers."],
  ["graph-up-arrow", "Predictions", "Win/draw/loss, likely scores, goals markets and fair odds. Check any price for value."],
];

function Login({ onError, err }) {
  return (
    <>
      <Backdrop strong />
      <Container className="py-5 min-dvh-100 d-flex flex-column justify-content-center">
        <div className="text-center mb-5">
          <div className="brand display-2 mb-2">Bet<span>IQ</span></div>
          <p className="lead text-body-secondary mx-auto mb-4" style={{ maxWidth: 620 }}>Analyze a match before you bet: head-to-head, form, statistics and a probability-based prediction across 80+ competitions worldwide.</p>
          <Button variant="primary" size="lg" className="px-4" onClick={() => signInWithPopup(auth, provider).catch((e) => onError(e.message))}><i className="bi bi-google me-2" />Continue with Google</Button>
          {err && <Alert variant="danger" className="mt-3 mx-auto" style={{ maxWidth: 520 }}>{err}</Alert>}
        </div>
        <Row className="g-3">{FEATURES.map(([i, t, s]) => <Col xs={12} sm={6} lg={3} key={t}><div className="hero-feature"><i className={`bi bi-${i}`} /><div className="h5 mt-2 mb-1">{t}</div><div className="small text-body-secondary">{s}</div></div></Col>)}</Row>
        <p className="small text-body-secondary text-center mt-4 mb-1">Free to use. Predictions are statistical estimates, not guarantees. 18+ · Bet responsibly.</p>
        <Credit className="text-center" />
      </Container>
    </>
  );
}

// the providers wrap the app so every page can show toasts and register keyboard shortcuts
export default function App() {
  return <ToastProvider><ShortcutsProvider><Main /></ShortcutsProvider></ToastProvider>;
}

function Main() {
  const [user, setUser] = useState(undefined), [tab, setTab] = useState("explore"), [mode, setMode] = useState("browse"), [menu, setMenu] = useState(false);   // mode: Explore shows "browse" (competitions) or "analyze" (match analysis)
  const [comp, setComp] = useState(null), [compTab, setCompTab] = useState("overview");          // selected competition + its tab
  const [team, setTeam] = useState(null), [player, setPlayer] = useState(null), [ent, setEnt] = useState(null), [view, setView] = useState(null), [pre, setPre] = useState(null);
  const [err, setErr] = useState(null), [d, setD] = useState(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // two documents at startup: the competition catalog and the global team index. Everything else loads when a competition is opened.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [cat, idx] = await Promise.all([loadCatalog(), loadTeamIndex()]);
        const catalog = cat?.leagues ?? [], byCode = Object.fromEntries(catalog.map((l) => [l.code, l]));
        const entries = catalog.filter((l) => l.s?.at && (l.s.results || l.s.fixtures)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "league" ? -1 : 1) || a.name.localeCompare(b.name));
        const byId = {}; for (const t of idx?.t ?? []) byId[t[0]] = { id: t[0], name: t[1], league: t[2] };
        setD({ catalog, byCode, entries, byId, updated: cat?.updated });
      } catch (e) { setErr("Could not load data: " + e.message); }
    })();
  }, [user]);

  // navigation: detail pages (match > player > team) sit on top of the current page; sidebar clicks clear them
  const clear = () => { setView(null); setPlayer(null); setTeam(null); setEnt(null); setPre(null); window.scrollTo({ top: 0 }); };
  const nav = {
    comp: (code, t = "overview") => { clear(); setComp(code); setCompTab(t); setMode("browse"); setTab("explore"); },
    team: (id, code) => { setPlayer(null); setView(null); setEnt(null); setTeam({ id, code }); window.scrollTo({ top: 0 }); },
    person: (e) => { setView(null); setPlayer(null); setEnt(e); window.scrollTo({ top: 0 }); },   // { kind: "manager" | "referee" | "venue", id, code, name, row }
    player: (p) => { setEnt(null); setPlayer(p); window.scrollTo({ top: 0 }); },
    analyze: (p) => { clear(); setPre(p ?? null); setMode("analyze"); setTab("explore"); },
    // every match (played or upcoming) opens the match page; `from` (the clicked row) lets its crests and score glide into the page header (View Transitions API)
    open: (m, from) => morph(() => { window.scrollTo({ top: 0 }); setView(m); }, { from }),
  };
  const closeMatch = () => morph(() => setView(null), { from: document.querySelector(".match-head"), to: () => visibleRow(view?.id) });
  // The browser history mirrors the navigation state: every new page (tab, competition, team, player, match ...) is one history entry, so the phone's back and
  // forward buttons, the back swipe and Alt+Left move through the pages instead of leaving the app. Switching tabs inside a competition replaces the entry.
  const [token] = useState(() => Math.random().toString(36).slice(2)), trail = useRef(null), ready = !!(user && d);
  const route = { tab, mode, comp, compTab, team, player, ent, view, pre }, routeRef = useRef(route), pageKey = routeKey(route);
  routeRef.current = route;
  useEffect(() => {
    if (!ready) { trail.current = null; return; }                       // signed out: forget this session's entries
    let t = trail.current;
    if (!t) { t = trail.current = new Trail(); const id = t.start(route); hist("replaceState", { ...window.history.state, iq: token, id }, ""); return; }
    if (pageKey === t.key) { t.update(route); return; }                  // same page (also: the browser button just moved here)
    const id = t.push(route); hist("pushState", { iq: token, id }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pageKey, compTab]);
  useEffect(() => {                                                      // scroll position is reset by the app on every page change, not by the browser
    if (!ready) return undefined;
    let was; try { was = window.history.scrollRestoration; window.history.scrollRestoration = "manual"; } catch { return undefined; }
    return () => { try { window.history.scrollRestoration = was; } catch { /* ignore */ } };
  }, [ready]);
  useEffect(() => {
    const onPop = (e) => {                                               // the phone's back / forward button: show the page of that history entry
      const t = trail.current;
      if (!t) return;
      const st = e.state, snap = (st && st.iq === token ? t.go(st.id) : t.go(-1)) ?? HOME;   // an entry of an earlier page load cannot be restored: start page
      t.key = routeKey(snap);
      const cur = routeRef.current, apply = () => { setTab(snap.tab); setMode(snap.mode); setComp(snap.comp); setCompTab(snap.compTab); setTeam(snap.team); setPlayer(snap.player); setEnt(snap.ent); setView(snap.view); setPre(snap.pre); };
      setMenu(false);                                                    // the menu drawer never stays open over another page
      if (cur.view && !snap.view) morph(apply, { from: document.querySelector(".match-head"), to: () => visibleRow(cur.view.id) });   // the same glide as the Back button
      else { window.scrollTo({ top: 0 }); flushSync(apply); }   // one render for all nine fields, so no half-changed page is ever recorded
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [token]);
  // one step back, the same order the pages are stacked in: match > manager/referee/venue > player > team > competition. false = nothing to go back to
  // When the browser's previous entry is that very page, this is the browser's back (so the history does not grow); otherwise the page is replaced by its parent.
  const back = () => {
    const up = parentOf(route);
    if (!up) return false;
    if (trail.current?.backIs(up)) hist("back");
    else if (view) closeMatch(); else if (ent) setEnt(null); else if (player) setPlayer(null); else if (team) setTeam(null); else setComp(null);
    return undefined;
  };
  const go = (k) => { if (k === "explore" && tab === "explore") { setComp(null); setMode("browse"); } clear(); setTab(k); };   // the sidebar entry of the current page returns to its start
  const out = () => signOut(auth);
  // keyboard: 1..7 open the sidebar pages, Esc / B go back (letters never fire while typing; see components/Shortcuts.jsx)
  useHotkeys(user && d ? { ...Object.fromEntries(TABS.map(([k], i) => [String(i + 1), () => go(k)])), Escape: back, b: back } : {});
  if (user === undefined) return <Backdrop />;
  if (!user) return <Login onError={setErr} err={err} />;
  const page = d && ({
    explore: (
      <Explore mode={mode} showSwitch={mode === "analyze" || !comp} onMode={(m) => { if (m === mode) return; clear(); if (m === "browse") setComp(null); setMode(m); }}>
        {mode === "analyze" ? <Analyze key={pre ? `${pre.h}-${pre.a}-${pre.league}` : "new"} user={user} d={{ ...d, compCode: comp }} pre={pre} />
          : comp ? <Competition key={comp} d={d} code={comp} tab={compTab} setTab={setCompTab} nav={nav} onBack={back} /> : <Competitions d={d} nav={nav} />}
      </Explore>),
    live: <Live d={d} nav={nav} />,
    daily: <Daily user={user} d={d} />,
    profile: <Profile user={user} d={d} onSignOut={out} />,
    help: <Help />,
  }[tab] ?? <Picks key={tab} user={user} d={d} nav={nav} history={tab === "history"} />);
  const Page = { manager: Manager, referee: Referee, venue: Venue }[ent?.kind];
  const top = d && (view ? <MatchView key={view.id} m={view} d={d} user={user} onBack={back} nav={nav} />
    : ent && Page ? <Page key={`${ent.kind}-${ent.id}`} ent={ent} d={d} nav={nav} onBack={back} />
    : player ? <Player key={player.id} player={player} d={d} nav={nav} onBack={back} />
    : team ? <Team key={`${team.id}-${team.code}`} team={team} d={d} nav={nav} onBack={back} /> : page);
  const shell = { tab, onSelect: go, user, onSignOut: out };

  return (
    <LiveProvider>
      <Backdrop />
      <aside className="sidebar d-none d-lg-flex"><SideNav {...shell} /></aside>
      <MobileNav show={menu} onHide={() => setMenu(false)} {...shell} />
      <div className="main-wrap">
        <header className="topbar sticky-top">
          <div className="d-flex align-items-center gap-2 gap-md-3 px-3 py-2">
            <MenuButton onClick={() => setMenu(true)} />
            {d ? <GlobalSearch d={d} onTeam={(t) => nav.team(t.id, t.league)} onComp={(c) => nav.comp(c)} /> : <span className="flex-fill" />}
            <HelpButton />
            <span className="brand d-lg-none">Bet<span>IQ</span></span>
          </div>
        </header>
        <Container fluid="xl" as="main" className="py-4 px-3 px-md-4">
          {err && <Alert variant="danger">{err}</Alert>}
          {!d && !err && <Spin kind="cards" />}
          {d && !d.entries.length && <Alert variant="info">No data yet. Run <code>npm run sync:local</code> (see README).</Alert>}
          {d && d.entries.length > 0 && <div key={[tab, view?.id, ent && ent.kind + ent.id, player?.id, team && team.id + "-" + team.code].join("|")} className="page-in">{top}</div>}
          <p className="small text-body-secondary text-center mt-5 mb-0">
            {d?.updated && <>Catalog updated {dayLabel(Date.parse(d.updated) / 1000)} · </>}Data: Bzzoiro Sports Data (sports.bzzoiro.com) · Estimates only. 18+, bet responsibly.
          </p>
          <Credit className="text-center mt-1" />
        </Container>
      </div>
    </LiveProvider>
  );
}
