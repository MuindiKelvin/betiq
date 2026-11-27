// Grey placeholder blocks with a soft shimmer, shown while data loads (replaces the spinner; same name, so every caller keeps working).
// kind: "page" (a heading and two cards), "matches" (rows with crests and a score), "cards" (a grid of cards), "inline" (two short lines).
export const Skel = ({ w = "100%", h = 14, r, className = "", style }) => <span className={"skel " + className} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;

const Lines = ({ n = 3 }) => Array.from({ length: n }, (_, i) => <Skel key={i} w={i === n - 1 ? "62%" : "100%"} />);
const Row = ({ i }) => (
  <div className="skel-row" style={{ "--i": i }}>
    <span className="skel-side"><Skel w={`${48 + (i * 13) % 30}%`} h={13} /><Skel w={28} h={28} r="50%" /></span>
    <Skel w={64} h={30} r={6} />
    <span className="skel-side start"><Skel w={28} h={28} r="50%" /><Skel w={`${44 + (i * 17) % 34}%`} h={13} /></span>
  </div>
);

export function Spin({ kind = "page", rows = 4 }) {
  let body;
  if (kind === "inline") body = <div className="d-flex flex-column gap-2 py-2"><Skel w="46%" h={16} /><Skel w="72%" /></div>;
  else if (kind === "matches") body = <div className="skel-card"><Skel w="34%" h={18} className="mb-3" /><div className="d-flex flex-column">{Array.from({ length: rows }, (_, i) => <Row key={i} i={i} />)}</div></div>;
  else if (kind === "cards") body = <div className="skel-grid">{Array.from({ length: 6 }, (_, i) => (
    <div className="skel-card d-flex align-items-center gap-3" key={i} style={{ "--i": i }}><Skel w={48} h={48} r="50%" /><div className="flex-fill d-flex flex-column gap-2"><Skel w="60%" h={15} /><Skel w="40%" h={12} /><Skel w="75%" h={10} /></div></div>))}</div>;
  else body = <div className="d-flex flex-column gap-3"><Skel w="30%" h={24} /><div className="skel-card d-flex flex-column gap-2"><Lines n={3} /></div><div className="skel-card d-flex flex-column gap-2"><Skel w="44%" h={16} /><Lines n={4} /></div></div>;
  return <div className="skel-wrap" role="status" aria-busy="true" aria-live="polite"><span className="visually-hidden">Loading</span>{body}</div>;
}
