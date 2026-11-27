import { useEffect, useLayoutEffect, useRef } from "react";
import { Nav } from "react-bootstrap";
import { reducedMotion } from "../lib/motion";
import { useHotkeys } from "./Shortcuts";

// Writes the box of the active element (found with `selector` inside `ref`) to CSS variables, so a single indicator element can glide to it.
// The indicator is placed without gliding the first time and whenever it was hidden (display: none) before; after that every change glides.
export function useSlider(ref, selector, dep) {
  const hidden = useRef(true);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const measure = () => {
      const el = box.querySelector(selector);
      if (!el || !el.offsetWidth) { box.style.setProperty("--ind-o", "0"); hidden.current = true; return; }
      const instant = hidden.current; hidden.current = false;
      if (instant) box.classList.add("ind-instant");
      box.style.setProperty("--ind-x", el.offsetLeft + "px"); box.style.setProperty("--ind-y", el.offsetTop + "px");
      box.style.setProperty("--ind-w", el.offsetWidth + "px"); box.style.setProperty("--ind-h", el.offsetHeight + "px");
      box.style.setProperty("--ind-o", "1");
      if (instant) { void box.offsetWidth; requestAnimationFrame(() => box.classList.remove("ind-instant")); }
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null, active = box.querySelector(selector);
    if (ro) { ro.observe(box); if (active) ro.observe(active); }
    window.addEventListener("resize", measure);
    document.fonts?.ready?.then(measure);          // web fonts change the widths
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref, selector, dep]);
}

// Underline tabs with a gold line that glides between them. items: [{ key, label, icon? }]. [ and ] step to the previous / next tab.
export function SlideNav({ items, activeKey, onSelect, className = "" }) {
  const ref = useRef(null), keys = items.map((i) => i.key), at = keys.indexOf(activeKey);
  useSlider(ref, ".nav-link.active", activeKey + "|" + keys.join());
  useEffect(() => {                                  // keep the active tab in view when the row scrolls sideways
    const box = ref.current, el = box?.querySelector(".nav-link.active");
    if (!box || !el) return;
    const l = el.offsetLeft, r = l + el.offsetWidth;
    if (l < box.scrollLeft) box.scrollTo({ left: Math.max(0, l - 8), behavior: reducedMotion() ? "auto" : "smooth" });
    else if (r > box.scrollLeft + box.clientWidth) box.scrollTo({ left: r - box.clientWidth + 8, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [activeKey]);
  useHotkeys({
    "[": () => { if (at > 0) onSelect(keys[at - 1]); },
    "]": () => { if (at >= 0 && at < keys.length - 1) onSelect(keys[at + 1]); },
  });
  return (
    <Nav ref={ref} className={"nav-underline flex-nowrap overflow-auto comp-tabs sliding " + className} activeKey={activeKey} onSelect={onSelect}>
      {items.map(({ key, label, icon }) => <Nav.Item key={key}><Nav.Link eventKey={key} className="text-nowrap">{icon && <i className={`bi bi-${icon} me-1`} />}{label}</Nav.Link></Nav.Item>)}
      <span className="ind ind-line" aria-hidden="true" />
    </Nav>
  );
}
