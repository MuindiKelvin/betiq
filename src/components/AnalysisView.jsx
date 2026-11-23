import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { MARKETS, dateTimeLabel, pct, shortDate } from "../lib/util";
import { fairOdds } from "../lib/model";
import { selProb } from "../lib/analysis";
import { assess, parseOdds, removeMargin } from "../lib/value";
import { CompareRow, Crest, FormChips, Ring, Spark, Stat } from "./ui";
import Pitch from "./Pitch";
import EventsFeed from "./EventsFeed";
import MatchStatsView from "./MatchStatsView";
import DetailsView from "./DetailsView";

const OUT = { H: "Home win", D: "Draw", A: "Away win" };
const GROUPS = [...new Set(Object.values(MARKETS).map((m) => m.grp))];
const CONF = { High: "success", Medium: "warning", Low: "secondary" };
// comparison row shown only when both teams have the number
const Opt = (p) => (p.a != null && p.b != null ? <CompareRow {...p} /> : null);
const Title = ({ icon, children, right }) => (
  <div className="d-flex align-items-center flex-wrap column-gap-2 row-gap-1 mb-3"><h2 className="h5 mb-0 me-auto"><i className={`bi bi-${icon} me-2 text-primary`} />{children}</h2>{right}</div>
);

/* ---------- scoreline heat map ---------- */
function Heat({ p, h, a, actual }) {
  const max = p.scores[0].p;
  return (
    <div className="heat-wrap">
      <div className="tiny text-body-secondary mb-1">Scoreline probability (%) · rows: {h} goals · columns: {a} goals{actual && <> · <span className="text-primary">outlined = actual score</span></>}</div>
      <table className="heat"><thead><tr><th />{[0, 1, 2, 3, 4, 5].map((j) => <th key={j}>{j}</th>)}</tr></thead>
        <tbody>{p.matrix.map((row, i) => (
          <tr key={i}><th>{i}</th>{row.map((v, j) => <td key={j} className={actual && actual.hg === i && actual.ag === j ? "actual" : undefined} style={{ background: `rgba(255,210,63,${(0.06 + 0.9 * (v / max)).toFixed(2)})`, color: v / max > 0.55 ? "#1a1500" : undefined }} title={`${i}–${j}: ${(v * 100).toFixed(1)}%`}>{v >= 0.01 ? Math.round(v * 100) : ""}</td>)}</tr>
        ))}</tbody></table>
    </div>
  );
}

/* ---------- market lines with fair odds ---------- */
function MarketRow({ label, v }) {
  const fo = fairOdds(v);
  return (
    <div className="mk-row">
      <div className="mk-label">{label}</div>
      <div className="mk-bar"><i style={{ width: v * 100 + "%" }} /></div>
      <div className="mk-pct">{pct(v)}</div>
      <div className="mk-odds" title="Fair decimal odds implied by the model">{fo ? fo.toFixed(2) : "–"}</div>
    </div>
  );
}

/* ---------- bet check (value finder) + save ---------- */
const TIER = { value: ["success", "Value: the model rates this more likely than the price implies"], fair: ["warning", "Fair price: no clear edge, so no bet"], poor: ["danger", "Poor value: the price is too short for this probability"] };
const readBank = () => { try { return localStorage.getItem("betiq.bankroll") ?? ""; } catch { return ""; } };
const writeBank = (v) => { try { localStorage.setItem("betiq.bankroll", v); } catch { /* storage unavailable */ } };

function BetCard({ out, onSave, saved, locked }) {
  const { p } = out, rough = out.comp?.kind === "comp";
  const [market, setMarket] = useState("1X2"), [sel, setSel] = useState(p.outcome), [odds, setOdds] = useState({}), [stake, setStake] = useState(""), [bank, setBank] = useState(readBank), [mine, setMine] = useState("");
  const keys = Object.keys(MARKETS[market].sel), prob = selProb(p, market, sel);
  const lab = (k) => (market === "1X2" ? (k === "H" ? out.H.name : k === "A" ? out.A.name : "Draw")
    : market === "DC" ? (k === "HD" ? `${out.H.name} or draw` : k === "DA" ? `Draw or ${out.A.name}` : "Either team wins") : MARKETS[market].sel[k]);
  const o = parseOdds(odds[sel]), mk = removeMargin(Object.fromEntries(keys.map((k) => [k, parseOdds(odds[k])])), keys, MARKETS[market].total ?? 1);
  const a = o ? assess({ prob, odds: o, mkt: mk, sel, rough }) : null;
  const bankN = parseFloat(bank), amount = a && a.stakeFrac > 0 && bankN > 0 ? Math.round(bankN * a.stakeFrac * 100) / 100 : null;
  const myP = parseFloat(mine) / 100, myProb = myP > 0 && myP < 1 ? myP : null;
  // a new market starts on the model's most likely selection
  const change = (m) => { setMarket(m); setSel(m === "1X2" ? p.outcome : Object.keys(MARKETS[m].sel).reduce((b, k) => (selProb(p, m, k) > selProb(p, m, b) ? k : b))); setOdds({}); };
  return (
    <Card className="h-100"><Card.Body>
      <Title icon="bullseye">Value finder</Title>
      <Row className="g-2 mb-2">
        <Col xs={12} sm={6}><Form.Select aria-label="Market" value={market} onChange={(e) => change(e.target.value)}>{GROUPS.map((g) => <optgroup key={g} label={g}>{Object.entries(MARKETS).filter(([, v]) => v.grp === g).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</optgroup>)}</Form.Select></Col>
        <Col xs={12} sm={6}><Form.Select aria-label="Your selection" value={sel} onChange={(e) => setSel(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{lab(k)}</option>)}</Form.Select></Col>
      </Row>
      <div className="tiny text-body-secondary mb-1">Bookmaker odds. Fill in every outcome to remove the margin; only your selection is required.</div>
      <Row className="g-2 mb-2">{keys.map((k) => (
        <Col xs={12 / keys.length} key={k}>
          <div className={"tiny text-truncate " + (k === sel ? "fw-semibold" : "text-body-secondary")}>{lab(k)}{k === sel && " (your bet)"}</div>
          <Form.Control size="sm" type="number" inputMode="decimal" min="1.01" step="0.01" placeholder="e.g. 2.10" aria-label={`Odds for ${lab(k)}`} value={odds[k] ?? ""} onChange={(e) => setOdds((x) => ({ ...x, [k]: e.target.value }))} />
        </Col>))}
      </Row>
      <Row className="g-2 mb-2">
        <Col xs={4}><Form.Control size="sm" type="number" inputMode="decimal" min="0" step="1" placeholder="Stake" aria-label="Stake (optional)" title="Stake (optional)" value={stake} onChange={(e) => setStake(e.target.value)} /></Col>
        <Col xs={4}><Form.Control size="sm" type="number" inputMode="decimal" min="0" step="1" placeholder="Bankroll" aria-label="Bankroll (optional, kept on this device)" title="Bankroll (optional, kept on this device)" value={bank} onChange={(e) => { setBank(e.target.value); writeBank(e.target.value); }} /></Col>
        <Col xs={4}><Form.Control size="sm" type="number" inputMode="decimal" min="1" max="99" step="1" placeholder="Your %" aria-label="Your own probability in percent (optional)" title="Your own probability in percent (optional): lets the Calibration page compare you with the model" value={mine} onChange={(e) => setMine(e.target.value)} /></Col>
      </Row>
      <div className="d-flex justify-content-around text-center my-3">
        <Stat value={pct(prob)} label="Model probability" />
        <Stat value={fairOdds(prob)?.toFixed(2) ?? "–"} label="Fair odds" />
        <Stat value={o ? pct(1 / o, 1) : "–"} label="Odds imply" />
      </div>
      {a && mk && <div className="d-flex justify-content-around text-center mb-3">
        <Stat value={pct(a.mktProb, 1)} label="Market, margin removed" />
        <Stat value={pct(mk.margin, 1)} label="Bookmaker margin" />
      </div>}
      {a && mk && (mk.margin < 0 || mk.margin > 0.3) && <div className="alert alert-warning py-2 small">The odds you entered imply a {pct(mk.margin, 1)} margin, which is unusual. Check them for typos.</div>}
      {a && <div className={`alert alert-${TIER[a.tier][0]} py-2 small`}>
        {TIER[a.tier][1]}. Expected return per 1 staked: <strong>{a.ev >= 0 ? "+" : ""}{a.ev.toFixed(2)}</strong> (edge {a.edge >= 0 ? "+" : ""}{(a.edge * 100).toFixed(1)} pts vs the {mk ? "margin-free market" : "odds-implied"} probability).
        <div className="mt-1">{a.tier !== "value" ? <strong>No bet.</strong> : rough ? "Stake suggestion is off here: cup and continental predictions are too rough." : <>Suggested stake: <strong>{pct(a.stakeFrac, 1)}</strong> of bankroll{amount != null && <> (<strong>{amount}</strong>)</>}. <span className="text-body-secondary">Quarter-Kelly, capped at 5%.</span>{amount != null && <Button variant="link" size="sm" className="p-0 ms-2 align-baseline" onClick={() => setStake(String(amount))}>Use</Button>}</>}</div>
      </div>}
      {a && mk && Math.abs(a.gap) > 0.15 && <div className="alert alert-info py-2 small"><i className="bi bi-info-circle me-2" />The model and the market differ by {Math.abs(a.gap * 100).toFixed(0)} points. Markets usually price in lineups and injuries, so check them before trusting this edge.</div>}
      {!a && <p className="small text-body-secondary">Enter the odds you are offered to compare them with the model's fair odds.</p>}
      {locked && <div className="alert alert-warning py-2 small"><i className="bi bi-clock-history me-2" />{locked} The calculator above still works.</div>}
      <Button className="w-100" variant="outline-primary" disabled={saved || !!locked} onClick={() => onSave({ market, selection: sel, prob, odds: o, stake: parseFloat(stake) > 0 ? parseFloat(stake) : null, myProb, mktProb: a?.mktProb ?? null })}>
        <i className={`bi bi-${saved ? "check2" : "bookmark-plus"} me-2`} />{saved ? "Saved to My Picks" : "Save to My Picks"}
      </Button>
    </Card.Body></Card>
  );
}

/* ---------- main view ---------- */
const Panel = ({ icon, title, right, children, className = "" }) => <Card className={"h-100 " + className}><Card.Body><Title icon={icon} right={right}>{title}</Title>{children}</Card.Body></Card>;
const sum = (rows) => { const r = { w: 0, d: 0, l: 0, g: 0, btts: 0 }; rows.forEach((m) => { m.f > m.a ? r.w++ : m.f === m.a ? r.d++ : r.l++; r.g += m.f + m.a; if (m.f && m.a) r.btts++; }); return r; };

export default function AnalysisView({ out, fx, byId, onSave, saved, ended, h2hInfo, onRequestH2H, details, mstats, detailsSlot, locked }) {
  const { H, A, p, fh, fa, h2h, sH, sA, pgH, pgA } = out;
  const nm = (id) => byId[id]?.name ?? "Team";
  const [showAllH2H, setAll] = useState(false);
  const rows = showAllH2H ? h2h.rows : h2h.rows.slice(0, 6);
  const lg = out.comp, isComp = lg?.kind === "comp";
  const years = h2h.rows.length ? [new Date(h2h.rows[h2h.rows.length - 1].t * 1000).getUTCFullYear(), new Date(h2h.rows[0].t * 1000).getUTCFullYear()] : null;
  const pc = (x) => pct(x);
  const actualOut = ended ? (ended.hg > ended.ag ? "H" : ended.hg < ended.ag ? "A" : "D") : null, called = actualOut === p.outcome;
  const actualLabel = actualOut === "H" ? `${H.name} win` : actualOut === "A" ? `${A.name} win` : "Draw";
  const lead = p.outcome === "H" ? H.name : p.outcome === "A" ? A.name : null;
  const l10 = sum(h2h.rows.slice(0, 10)), n10 = Math.min(10, h2h.rows.length);
  const lineups = details?.lineups ?? null;

  /* ---- panels ---- */
  const prediction = (
    <Panel icon="graph-up-arrow" title={ended ? "Pre-match prediction" : "Prediction"} className="border-primary-subtle" right={<Badge bg={CONF[p.confidence]} text={p.confidence === "Medium" ? "dark" : undefined}>{p.confidence} confidence</Badge>}>
      <div className="ring-row mb-3">
        <Ring value={p.home} color="#19d38a" label={`${H.name} win`} /><Ring value={p.draw} color="#94a3b8" label="Draw" /><Ring value={p.away} color="#4cc9f0" label={`${A.name} win`} />
      </div>
      <div className="verdict-box"><i className="bi bi-lightbulb me-2 text-primary" />Model favours <strong>{lead ?? "a draw"}</strong> ({pct(Math.max(p.home, p.draw, p.away))}). Expected goals {p.lh.toFixed(1)}–{p.la.toFixed(1)}, most likely score {p.scores[0].h}–{p.scores[0].a}.</div>
      {ended && <div className={"alert py-2 small mt-3 mb-0 alert-" + (called ? "success" : "warning")}><i className={`bi bi-${called ? "check-circle" : "x-circle"} me-2`} />Actual result: <strong>{actualLabel}</strong>. The model {called ? "called it" : "missed it"}.</div>}
    </Panel>);
  const insights = (
    <Panel icon="stars" title="Match insights">
      <ul className="insights list-unstyled mb-0">{out.insights.map((x, i) => <li key={i}><i className={`bi bi-${x.ok ? "check-circle-fill ok" : "exclamation-circle-fill warn"}`} /><span>{x.text}</span></li>)}</ul>
    </Panel>);
  const pitch = (
    <Panel icon="people" title="Teamsheets & maps">
      {lineups || details?.avgpos || details?.shots?.length ? <Pitch lineups={lineups} details={details} h={H.name} a={A.name} /> : detailsSlot ?? <p className="text-body-secondary mb-0">Teamsheets are published about an hour before kickoff.</p>}
    </Panel>);
  const events = <Panel icon="list-ul" title="Match events">{details?.goals ? <div className="events-scroll"><EventsFeed details={details} h={H.name} a={A.name} /></div> : detailsSlot ?? <p className="text-body-secondary mb-0">Events appear here once loaded.</p>}</Panel>;
  const stats = <Panel icon="bar-chart-line" title="Match statistics" right={<span className="tiny text-body-secondary">{H.name} · {A.name}</span>}>{mstats ? <MatchStatsView s={mstats} h={H.name} a={A.name} bare /> : <p className="text-body-secondary small mb-0">Per-match statistics are not available for this match.</p>}</Panel>;
  const h2hCompact = (
    <Panel icon="trophy" title="Head-to-head" right={h2hInfo && (h2hInfo.doc ? <Badge bg="success" text="dark">All competitions</Badge> : h2hInfo.queued ? <Badge bg="secondary">History requested</Badge> : h2hInfo.canRequest ? <Button size="sm" variant="outline-primary" disabled={h2hInfo.busy} onClick={onRequestH2H} title="Fetches every past meeting in any competition. Costs 1 API call on the next data sync.">Load all competitions</Button> : null)}>
      {n10 ? (<>
        <div className="text-center small text-body-secondary mb-2">Last {n10} meeting{n10 > 1 ? "s" : ""}</div>
        <div className="d-flex align-items-center justify-content-around text-center">
          <div><Crest team={H} size={40} /><div className="num fs-1 text-success">{l10.w}</div><div className="tiny text-body-secondary">Wins</div></div>
          <div><div className="num fs-1">{l10.d}</div><div className="tiny text-body-secondary">Draws</div></div>
          <div><Crest team={A} size={40} /><div className="num fs-1 text-info">{l10.l}</div><div className="tiny text-body-secondary">Wins</div></div>
        </div>
        <div className="text-center small my-2">Avg goals {(l10.g / n10).toFixed(1)} <span className="text-body-secondary">|</span> BTTS {pct(l10.btts / n10)}</div>
      </>) : <p className="text-body-secondary small">No meetings in the loaded seasons.</p>}
      <Button variant="outline-primary" size="sm" className="w-100 mt-auto" onClick={() => document.getElementById("h2h-full")?.scrollIntoView({ behavior: "smooth", block: "start" })}>View full head-to-head <i className="bi bi-arrow-right ms-1" /></Button>
    </Panel>);
  const formCompact = (
    <Panel icon="activity" title="Current form">
      <div className="row g-2 text-center">
        {[[H, fh, "#19d38a"], [A, fa, "#4cc9f0"]].map(([t, f, c]) => (
          <div className="col-6" key={t.id}><div className="small fw-semibold text-truncate">{t.name}</div><div className="d-flex justify-content-center my-2"><FormChips r={f.form} size={22} /></div>
            <div className="small text-body-secondary">Pts: {f.points}</div><Spark matches={f.last} color={c} /></div>))}
      </div>
    </Panel>);

  return (
    <Row className="g-3">
      {/* hero */}
      <Col xs={12}><Card className="pitch hero"><Card.Body className="py-4">
        <div className="text-center mb-2">{ended ? <Badge bg="secondary" title="Full time">FT</Badge> : <Badge bg="primary" text="dark">UPCOMING</Badge>}</div>
        <div className="hero-grid text-center">
          <div className="hero-team"><Crest team={H} size="clamp(48px, 15vw, 84px)" /><div className="hero-name h2 mt-2 mb-1">{H.name}</div><div className="d-flex justify-content-center"><FormChips r={fh.form} size={22} /></div></div>
          <div className="hero-mid">{ended ? <div className="score score-lg">{ended.hg}–{ended.ag}</div> : <div className="num fs-1 text-body-secondary">VS</div>}</div>
          <div className="hero-team"><Crest team={A} size="clamp(48px, 15vw, 84px)" /><div className="hero-name h2 mt-2 mb-1">{A.name}</div><div className="d-flex justify-content-center"><FormChips r={fa.form} size={22} /></div></div>
        </div>
        <p className="text-center small text-body-secondary mt-3 mb-0">
          {lg && <><i className="bi bi-trophy me-2 text-primary" />{lg.name}{lg.country ? ` (${lg.country})` : ""} · </>}
          {ended ? <><i className="bi bi-flag me-1" />{dateTimeLabel(ended.t)}</> : fx ? <><i className="bi bi-calendar-event me-1" />{dateTimeLabel(fx.t)}</> : "No upcoming fixture found for this pairing (the pick cannot be auto-settled)"}
        </p>
      </Card.Body></Card></Col>
      {isComp && <Col xs={12}><div className="alert alert-warning py-2 small mb-0"><i className="bi bi-info-circle me-2" />Competition model: strengths come only from this competition's own matches (few per team), so predictions here are rough. Treat them with extra caution.</div></Col>}

      {/* dashboard rows */}
      {ended ? (<>
        <Col xs={12} lg={5}>{pitch}</Col><Col xs={12} lg={4}>{events}</Col><Col xs={12} lg={3}>{stats}</Col>
        <Col xs={12} md={6} xl={3}>{h2hCompact}</Col><Col xs={12} md={6} xl={3}>{formCompact}</Col><Col xs={12} md={6} xl={3}>{prediction}</Col><Col xs={12} md={6} xl={3}>{insights}</Col>
      </>) : (<>
        <Col xs={12} lg={5}>{prediction}</Col><Col xs={12} lg={3}>{insights}</Col><Col xs={12} lg={4}><BetCard out={out} onSave={onSave} saved={saved} locked={locked} /></Col>
        <Col xs={12} lg={5}>{pitch}</Col><Col xs={12} lg={4}>{h2hCompact}</Col><Col xs={12} lg={3}>{formCompact}</Col>
      </>)}

      <Col xs={12}><h2 className="h4 mt-3 mb-0 section-title">Deep dive</h2></Col>
      {/* scoreline map + markets */}
      <Col xs={12} lg={6}><Card className="h-100"><Card.Body>
        <Title icon="grid-3x3">Scoreline map</Title>
        <Row className="g-2 text-center mb-3">
          <Col xs={4}><Stat value={`${p.scores[0].h}–${p.scores[0].a}`} label="Most likely score" sub={pct(p.scores[0].p, 1)} /></Col>
          <Col xs={4}><Stat value={`${p.lh.toFixed(1)}–${p.la.toFixed(1)}`} label="Expected goals" /></Col>
          <Col xs={4}><Stat value={(p.lh + p.la).toFixed(1)} label="Expected total" /></Col>
        </Row>
        <Heat p={p} h={H.name} a={A.name} actual={ended} />
      </Card.Body></Card></Col>
      <Col xs={12} lg={6}><Card className="h-100"><Card.Body>
        <Title icon="list-check">Markets</Title>
        <div className="mk-head"><span /><span /><span>Prob.</span><span title="Fair decimal odds">Fair odds</span></div>
        <MarketRow label={`${H.name} win`} v={p.home} /><MarketRow label="Draw" v={p.draw} /><MarketRow label={`${A.name} win`} v={p.away} />
        <hr className="my-2" />
        <MarketRow label={`${H.name} or draw`} v={p.home + p.draw} /><MarketRow label={`${A.name} or draw`} v={p.away + p.draw} /><MarketRow label="Either team wins" v={p.home + p.away} />
        <hr className="my-2" />
        <MarketRow label="Over 1.5 goals" v={p.over15} /><MarketRow label="Over 2.5 goals" v={p.over25} /><MarketRow label="Over 3.5 goals" v={p.over35} />
        <MarketRow label="Both teams score" v={p.btts} /><MarketRow label={`${H.name} clean sheet`} v={p.homeCS} /><MarketRow label={`${A.name} clean sheet`} v={p.awayCS} />
      </Card.Body></Card></Col>

      {/* why + full form */}
      <Col xs={12} lg={6}><Card className="h-100"><Card.Body>
        <Title icon="lightbulb">Why the model says this</Title>
        <ul className="why mb-0">{out.factors.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </Card.Body></Card></Col>
      <Col xs={12} lg={6}><Card className="h-100"><Card.Body>
        <Title icon="activity">{ended ? "Form before the match (last 5)" : "Form details (last 5, newest first)"}</Title>
        {[[H, fh], [A, fa]].map(([t, f]) => (
          <div key={t.id} className="mb-3">
            <div className="d-flex align-items-center gap-2 mb-2"><Crest team={t} size={22} /><strong>{t.name}</strong><span className="ms-auto small text-body-secondary">{f.points} pts · {f.gf} scored · {f.ga} conceded</span></div>
            <div className="d-flex flex-column gap-1">{f.last.map((m) => (
              <div key={m.id} className="d-flex align-items-center gap-2 small">
                <Badge bg={m.res === "W" ? "success" : m.res === "D" ? "secondary" : "danger"} style={{ width: 22 }}>{m.res}</Badge>
                <span className="text-body-secondary" style={{ width: 70 }}>{shortDate(m.t)}</span>
                <span className="tiny text-body-secondary" style={{ width: 14 }}>{m.home ? "H" : "A"}</span>
                <span className="flex-fill text-truncate">{nm(m.opp)}</span><strong>{m.f}–{m.a}</strong>
              </div>))}{!f.last.length && <span className="small text-body-secondary">No matches loaded.</span>}</div>
          </div>))}
      </Card.Body></Card></Col>

      {/* full head-to-head */}
      <Col xs={12} lg={6} id="h2h-full"><Card className="h-100"><Card.Body>
        <Title icon="arrow-left-right">Head-to-head, all meetings</Title>
        {h2h.rec.n ? (<>
          <div className="d-flex justify-content-between small text-body-secondary mb-2 flex-wrap gap-2">
            <span>{h2h.rec.n} meeting{h2h.rec.n > 1 ? "s" : ""}: {H.name} {h2h.rec.w}W {h2h.rec.d}D {h2h.rec.l}L</span><span>Avg goals <strong className="text-body">{((h2h.rec.gf + h2h.rec.ga) / h2h.rec.n).toFixed(1)}</strong></span>
            <span>BTTS <strong className="text-body">{pct(h2h.rec.btts / h2h.rec.n)}</strong></span><span>Over 2.5 <strong className="text-body">{pct(h2h.rec.o25 / h2h.rec.n)}</strong></span>
          </div>
          <ul className="list-unstyled small mb-2">{rows.map((m) => (
            <li key={m.id} className="d-flex align-items-center gap-2 py-1 border-top border-secondary-subtle">
              <span className="text-body-secondary" style={{ width: 74 }}>{shortDate(m.t)}</span>
              <span className="flex-fill text-truncate">{nm(m.h)} <strong>{m.hg}–{m.ag}</strong> {nm(m.a)}{m.c && <span className="tiny text-body-secondary ms-2">{m.c}</span>}</span>
              <Badge bg={m.f > m.a ? "success" : m.f === m.a ? "secondary" : "danger"}>{m.f > m.a ? "W" : m.f === m.a ? "D" : "L"}</Badge>
            </li>))}</ul>
          {h2h.rows.length > 6 && <Button variant="link" size="sm" className="p-0" onClick={() => setAll(!showAllH2H)}>{showAllH2H ? "Show fewer" : `Show all ${h2h.rows.length}`}</Button>}
          <div className="tiny text-body-secondary mt-2">Result badges are from {H.name}'s point of view. {years && <>Meetings from {years[0]} to {years[1]}. </>}{h2hInfo?.doc ? "Includes every competition." : isComp ? "Competition matches loaded so far." : "This competition only (use “Load all competitions” for meetings elsewhere)."}</div>
        </>) : <p className="text-body-secondary mb-0">These teams have not met in the seasons loaded (the sync loads the last 5 seasons of this competition).</p>}
      </Card.Body></Card></Col>
      {details?.lineups && <Col xs={12} lg={6}><DetailsView details={details} h={H.name} a={A.name} finished={!!ended} timeline={false} /></Col>}

      {/* season statistics */}
      <Col xs={12}><Card><Card.Body>
        <Title icon="bar-chart-line" right={<span className="small"><strong>{H.name}</strong> vs <strong>{A.name}</strong></span>}>Season statistics</Title>
        <Row className="g-4">
          <Col xs={12} lg={6}>
            <div className="tiny text-uppercase text-body-secondary ls mb-2">Results-based</div>
            <CompareRow label="Points per game" a={sH.ppg} b={sA.ppg} better="high" />
            <CompareRow label="Win rate" a={sH.winPct} b={sA.winPct} better="high" fmt={pc} />
            <CompareRow label="Goals scored / game" a={sH.gf} b={sA.gf} better="high" />
            <CompareRow label="Goals conceded / game" a={sH.ga} b={sA.ga} better="low" />
            <CompareRow label="Clean sheets" a={sH.cs} b={sA.cs} better="high" fmt={pc} />
            <CompareRow label="Failed to score" a={sH.fts} b={sA.fts} better="low" fmt={pc} />
            <CompareRow label="Both teams scored" a={sH.btts} b={sA.btts} fmt={pc} />
            <CompareRow label="Over 2.5 goals" a={sH.o25} b={sA.o25} fmt={pc} />
            <CompareRow label={`${H.name} at home vs ${A.name} away (pts/game)`} a={out.homeAtHome.ppg} b={out.awayAway.ppg} better="high" />
          </Col>
          <Col xs={12} lg={6}>
            <div className="tiny text-uppercase text-body-secondary ls mb-2">Match statistics, per game</div>
            {pgH && pgA ? (<>
              <Opt label="Shots" a={pgH.shots} b={pgA.shots} better="high" fmt={(x) => x.toFixed(1)} />
              <Opt label="Shots on target" a={pgH.shotsOnTarget} b={pgA.shotsOnTarget} better="high" fmt={(x) => x.toFixed(1)} />
              <Opt label="Corners" a={pgH.corners} b={pgA.corners} better="high" fmt={(x) => x.toFixed(1)} />
              <Opt label="Yellow cards" a={pgH.yellowCards} b={pgA.yellowCards} fmt={(x) => x.toFixed(2)} />
              <Opt label="Red cards" a={pgH.redCards} b={pgA.redCards} fmt={(x) => x.toFixed(2)} />
              <Opt label="Fouls" a={pgH.fouls} b={pgA.fouls} fmt={(x) => x.toFixed(1)} />
              <Opt label="Possession" a={pgH.ballPossession} b={pgA.ballPossession} fmt={(x) => x.toFixed(0) + "%"} />
              <Opt label="Expected goals (xG)" a={pgH.xg} b={pgA.xg} better="high" fmt={(x) => x.toFixed(2)} />
              <Opt label="Offsides" a={pgH.offsides} b={pgA.offsides} fmt={(x) => x.toFixed(1)} />
              <div className="tiny text-body-secondary mt-2">Averages per game over each team's last {Math.min(pgH.n, pgA.n) || 20} matches.</div>
              {pgH.corners != null && pgA.corners != null && <div className="indicative mt-3">
                <i className="bi bi-info-circle me-2" />Indicative totals if each side repeats its average: about <strong>{(pgH.corners + pgA.corners).toFixed(1)}</strong> corners{pgH.yellowCards != null && pgA.yellowCards != null && <> and <strong>{(pgH.yellowCards + pgA.yellowCards).toFixed(1)}</strong> yellow cards</>}.
              </div>}
            </>) : <div className="small text-body-secondary">Team statistics for {H.name} and {A.name} have not been loaded yet. The data sync refreshes them for a few hundred teams per run.</div>}
          </Col>
        </Row>
      </Card.Body></Card></Col>

      <Col xs={12}><p className="small text-body-secondary mb-0"><i className="bi bi-exclamation-triangle me-2" />Statistical estimates, not guarantees. Betting carries risk: never stake money you cannot afford to lose. If gambling stops being fun, seek help.</p></Col>
    </Row>
  );
}
