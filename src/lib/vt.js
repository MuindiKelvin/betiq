// Shared-element transition (View Transitions API): the crests and the score of a match row glide into the match page header, and back.
// Chrome and Edge animate it; any other browser (or reduced motion) just runs the update without animation.
import { flushSync } from "react-dom";
import { reducedMotion } from "./motion";

export const VT = { home: "vt-h-crest", away: "vt-a-crest", score: "vt-score" };
const supported = () => typeof document !== "undefined" && typeof document.startViewTransition === "function";

// [name, element] pairs inside `root`: a match row (crests inside .side, score inside .match-mid), or the match page header (data-vt marks).
export function parts(root) {
  if (!root) return [];
  const marked = root.querySelectorAll("[data-vt]");
  if (marked.length) return [...marked].map((el) => [VT[el.dataset.vt], el]).filter(([n]) => n);
  const sides = root.querySelectorAll(".side"), crest = (s) => s?.querySelector(".crest, .crest-fallback");
  return [[VT.home, crest(sides[0])], [VT.away, crest(sides[1])], [VT.score, root.querySelector(".match-mid .score")]].filter(([, el]) => el);
}

// The row of a match in the page, when it is on screen (a morph towards something off screen would fly out of the window).
export function visibleRow(id) {
  if (id == null || typeof document === "undefined") return null;
  const el = document.querySelector(`[data-mid="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.bottom > 56 && r.top < window.innerHeight ? el : null;
}

// update(): changes the React state (runs inside flushSync). from: the element that is leaving. to: an element, or a function returning one, once the update is done.
export function morph(update, { from = null, to = null } = {}) {
  if (!supported() || reducedMotion()) { update(); return; }
  const marked = [], mark = (pairs) => pairs.forEach(([name, el]) => { el.style.viewTransitionName = name; marked.push(el); });
  mark(parts(from));
  let t;
  try {
    t = document.startViewTransition(() => {
      flushSync(update);
      mark(parts(typeof to === "function" ? to() : to));
    });
  } catch { marked.forEach((el) => { el.style.viewTransitionName = ""; }); update(); return; }
  const clear = () => marked.forEach((el) => { el.style.viewTransitionName = ""; });
  t.ready.catch(() => {});                  // "transition was skipped" is not an error
  t.updateCallbackDone.catch(() => {});
  t.finished.then(clear, clear);
}
