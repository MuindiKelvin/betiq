import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "react-bootstrap";
import { STEP_SELECTOR, isTyping, keyName, stepIndex } from "../lib/keys";

// Keyboard shortcuts. Components register { key: handler } maps with useHotkeys(); the provider owns the one keydown listener.
// Single keys never fire while a text field has focus or a dialog / drawer is open. A handler that returns false passes the key on.
const Ctx = createContext({ register: () => () => {}, openHelp: () => {} });
export const useShortcuts = () => useContext(Ctx);
export function useHotkeys(map) {
  const { register } = useContext(Ctx), ref = useRef(map);
  ref.current = map;
  useEffect(() => register(() => ref.current), [register]);
}

// j / k: move focus to the next / previous match row, card or folded receipt (Enter opens it, as for any focused button)
function step(dir) {
  const list = [...document.querySelectorAll(STEP_SELECTOR)].filter((el) => el.offsetParent !== null);
  if (!list.length) return false;
  const i = stepIndex(dir, list.indexOf(document.activeElement), list.map((el) => el.getBoundingClientRect()), { top: 60, height: window.innerHeight });
  if (i < 0) return false;
  list[i].focus({ preventScroll: true });
  list[i].scrollIntoView({ block: "nearest" });
  return true;
}

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = mac ? "⌘" : "Ctrl";
export const SHORTCUTS = [
  ["Go to", [[["1", "…", "7"], "Explore, Live, Daily Picks, My Picks, History, Profile, Help"], [["/"], "Search teams and competitions"], [[MOD, "K"], "Search, also while typing"], [["Esc"], "Back one step (match, player, team, competition)"], [["B"], "Back one step"]]],
  ["Lists and tabs", [[["J"], "Next match, card or receipt"], [["K"], "Previous one"], [["Enter"], "Open the focused item"], [["["], "Previous tab"], [["]"], "Next tab"]]],
  ["Live and Daily Picks", [[["←"], "Previous day"], [["→"], "Next day"], [["T"], "Today"], [["A"], "Live page: all matches"], [["L"], "Live page: in play now"], [["F"], "Live page: finished"], [["U"], "Live page: upcoming"]]],
  ["Help", [[["?"], "Show this list"]]],
];

export function ShortcutsProvider({ children }) {
  const [help, setHelp] = useState(false), reg = useRef(new Set());
  const register = useCallback((get) => { reg.current.add(get); return () => { reg.current.delete(get); }; }, []);
  const openHelp = useCallback(() => setHelp(true), []);
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.defaultPrevented) return;
      const name = keyName(ev);
      if (!name) return;
      const typing = isTyping(ev.target);
      if (typing && name === "Escape") { ev.target.blur(); return; }
      if (typing && name !== "mod+k") return;
      if (document.querySelector(".modal, .offcanvas.show")) return;   // a dialog (also while it fades out) or the drawer owns the keyboard
      for (const get of [...reg.current].reverse()) {
        const h = get()?.[name];
        if (h && h(ev) !== false) { ev.preventDefault(); return; }
      }
      if (name === "?") { ev.preventDefault(); setHelp(true); }
      else if (name === "j" || name === "k") { if (step(name === "j" ? 1 : -1)) ev.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ register, openHelp }), [register, openHelp]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal show={help} onHide={() => setHelp(false)} centered contentClassName="iq-modal">
        <Modal.Header closeButton closeVariant="white"><Modal.Title as="h2" className="h5 mb-0"><i className="bi bi-keyboard me-2 text-primary" />Keyboard shortcuts</Modal.Title></Modal.Header>
        <Modal.Body>
          {SHORTCUTS.map(([title, rows]) => (
            <div key={title} className="mb-3">
              <div className="tiny text-uppercase text-body-secondary ls mb-1">{title}</div>
              {rows.map(([keys, text]) => <div key={text} className="kbd-row"><span className="kbd-keys">{keys.map((k, i) => (k === "…" ? <span key={i} className="text-body-secondary">…</span> : <kbd key={i}>{k}</kbd>))}</span><span>{text}</span></div>)}
            </div>))}
          <div className="tiny text-body-secondary">Single keys are ignored while you type in a field.</div>
        </Modal.Body>
      </Modal>
    </Ctx.Provider>
  );
}
