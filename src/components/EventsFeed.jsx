import { useLayoutEffect, useRef, useState } from "react";

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

// A stable key per event (not its position, which shifts when a newer event arrives at the top); a repeat of the same text gets a counter.
export function eventKeys(ev) {
  const seen = {};
  return ev.map((e) => { const base = [e.type, e.m, e.x, e.s, e.p ?? e.i ?? "", e.k ?? ""].join("|"); seen[base] = (seen[base] ?? 0) + 1; return seen[base] > 1 ? `${base}~${seen[base]}` : base; });
}

export default function EventsFeed({ details, h, a }) {
  const ev = buildEvents(details), name = (s) => (s === "h" ? h : a), keys = eventKeys(ev), sig = keys.join("\n");
  // events that were not there on the previous render slide in at the top; the first render shows the list as is
  const before = useRef(null), [fresh, setFresh] = useState(() => new Set());
  useLayoutEffect(() => {
    const prev = before.current; before.current = new Set(keys);
    if (!prev) return undefined;
    const add = keys.filter((k) => !prev.has(k));
    if (!add.length) return undefined;
    setFresh(new Set(add));
    const t = setTimeout(() => setFresh(new Set()), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  if (!ev.length) return <p className="text-body-secondary mb-0">No events recorded.</p>;
  return (
    <ul className="events list-unstyled mb-0">
      {ev.map((e, i) => (
        <li key={keys[i]} className={"ev" + (e.type === "goal" ? " ev-goal" : "") + (fresh.has(keys[i]) ? " ev-new" : "")} style={{ "--i": fresh.has(keys[i]) ? 0 : Math.min(i, 8) }}>
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
