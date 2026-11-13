// Goals, cards and substitutions, newest first, with the running score.
export function buildEvents(details) {
  const ev = [
    ...(details.goals ?? []).map((e) => ({ ...e, type: "goal" })),
    ...(details.cards ?? []).map((e) => ({ ...e, type: "card" })),
    ...(details.subs ?? []).map((e) => ({ ...e, type: "sub" })),
  ].sort((x, y) => (x.m ?? 0) - (y.m ?? 0) || (x.x ?? 0) - (y.x ?? 0));
  let h = 0, a = 0;
  for (const e of ev) if (e.type === "goal") { e.s === "h" ? h++ : a++; e.score = `${h}–${a}`; }
  return ev.reverse();
}

export default function EventsFeed({ details, h, a }) {
  const ev = buildEvents(details), name = (s) => (s === "h" ? h : a);
  if (!ev.length) return <p className="text-body-secondary mb-0">No events recorded.</p>;
  return (
    <ul className="events list-unstyled mb-0">
      {ev.map((e, i) => (
        <li key={i} className={"ev" + (e.type === "goal" ? " ev-goal" : "")}>
          <span className="ev-min">{e.m != null ? `${e.m}${e.x ? "+" + e.x : ""}'` : ""}</span>
          <span className="ev-icon">{e.type === "goal" ? <i className="bi bi-circle-fill goal-dot" /> : e.type === "card" ? <span className={"card-icon " + (e.k === "y" ? "yellow" : "red")} /> : <i className="bi bi-arrow-left-right text-info" />}</span>
          <span className="ev-text">
            {e.type === "goal" && <><strong>Goal! {name(e.s)} {e.score}</strong><span className="d-block tiny text-body-secondary">{e.p ?? "Unknown"}{e.k === "pen" && " (penalty)"}{e.k === "og" && " (own goal)"}{e.a && ` · assist ${e.a}`}</span></>}
            {e.type === "card" && <><strong>{e.k === "y" ? "Yellow card" : e.k === "yr" ? "Second yellow" : "Red card"} ({name(e.s)})</strong><span className="d-block tiny text-body-secondary">{e.p ?? "Unknown"}</span></>}
            {e.type === "sub" && <><strong>Substitution ({name(e.s)})</strong><span className="d-block tiny text-body-secondary">{e.i ?? "?"} replaces {e.o ?? "?"}</span></>}
          </span>
        </li>))}
    </ul>
  );
}
