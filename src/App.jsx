import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { Alert, Button, Col, Container, Row } from "react-bootstrap";
import { auth, provider } from "./lib/firebase";
import { loadCatalog, loadTeamIndex } from "./lib/data";
import { dayLabel } from "./lib/util";
import Backdrop from "./components/Backdrop";
import { Spin } from "./components/ui";
import Analyze from "./pages/Analyze";
import Competitions from "./pages/Competitions";
import Competition from "./pages/Competition";
import Team from "./pages/Team";
import Player from "./pages/Player";
import Picks from "./pages/Picks";
import Model from "./pages/Model";
import Calibration from "./pages/Calibration";
import Live from "./pages/Live";
import { LiveProvider } from "./lib/useLive";
import MatchView from "./pages/MatchView";
import Profile from "./pages/Profile";
import Help from "./pages/Help";
import Credit from "./components/Credit";
import { GlobalSearch, MenuButton, MobileNav, SideNav } from "./components/Shell";

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

export default function App() {
  const [user, setUser] = useState(undefined), [tab, setTab] = useState("competitions"), [menu, setMenu] = useState(false);
  const [comp, setComp] = useState(null), [compTab, setCompTab] = useState("overview");          // selected competition + its tab
  const [team, setTeam] = useState(null), [player, setPlayer] = useState(null), [view, setView] = useState(null), [pre, setPre] = useState(null);
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

  if (user === undefined) return <Backdrop />;
  if (!user) return <Login onError={setErr} err={err} />;

  // navigation: detail pages (match > player > team) sit on top of the current page; sidebar clicks clear them
  const clear = () => { setView(null); setPlayer(null); setTeam(null); setPre(null); window.scrollTo({ top: 0 }); };
  const nav = {
    comp: (code, t = "overview") => { clear(); setComp(code); setCompTab(t); setTab("competitions"); },
    team: (id, code) => { setPlayer(null); setView(null); setTeam({ id, code }); window.scrollTo({ top: 0 }); },
    player: (p) => { setPlayer(p); window.scrollTo({ top: 0 }); },
    analyze: (p) => { clear(); setPre(p ?? null); setTab("analyze"); },
    open: (m) => { window.scrollTo({ top: 0 }); setView(m); },   // every match (played or upcoming) opens the match page
  };
  const go = (k) => { if (k === "competitions" && tab === "competitions") setComp(null); clear(); setTab(k); };
  const out = () => signOut(auth);
  const page = d && ({
    competitions: comp ? <Competition key={comp} d={d} code={comp} tab={compTab} setTab={setCompTab} nav={nav} onBack={() => setComp(null)} /> : <Competitions d={d} nav={nav} />,
    analyze: <Analyze key={pre ? `${pre.h}-${pre.a}-${pre.league}` : "new"} user={user} d={{ ...d, compCode: comp }} pre={pre} />,
    model: <Model d={d} />,
    live: <Live d={d} nav={nav} />,
    calibration: <Calibration user={user} />,
    profile: <Profile user={user} d={d} onSignOut={out} />,
    help: <Help />,
  }[tab] ?? <Picks key={tab} user={user} d={d} history={tab === "history"} />);
  const top = d && (view ? <MatchView key={view.id} m={view} d={d} user={user} onBack={() => setView(null)} />
    : player ? <Player key={player.id} player={player} d={d} nav={nav} onBack={() => setPlayer(null)} />
    : team ? <Team key={`${team.id}-${team.code}`} team={team} d={d} nav={nav} onBack={() => setTeam(null)} /> : page);
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
            <span className="brand d-lg-none">Bet<span>IQ</span></span>
          </div>
        </header>
        <Container fluid="xl" as="main" className="py-4 px-3 px-md-4">
          {err && <Alert variant="danger">{err}</Alert>}
          {!d && !err && <Spin />}
          {d && !d.entries.length && <Alert variant="info">No data yet. Run <code>npm run sync:local</code> (see README).</Alert>}
          {d && d.entries.length > 0 && top}
          <p className="small text-body-secondary text-center mt-5 mb-0">
            {d?.updated && <>Catalog updated {dayLabel(Date.parse(d.updated) / 1000)} · </>}Data: Bzzoiro Sports Data (sports.bzzoiro.com) · Estimates only. 18+, bet responsibly.
          </p>
          <Credit className="text-center mt-1" />
        </Container>
      </div>
    </LiveProvider>
  );
}
