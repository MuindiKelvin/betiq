import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Small slide-in messages ("Saved to My Picks"). push({ text, tone }) returns an id; tone: success | danger | info | warning.
// They close by themselves (errors stay longer), stay while the pointer or keyboard focus is on them, and can be dismissed.
const Ctx = createContext({ push: () => 0, dismiss: () => {} });
export const useToast = () => useContext(Ctx);
const ICON = { success: "check-circle-fill", danger: "exclamation-triangle-fill", warning: "exclamation-circle-fill", info: "info-circle-fill" };
const MAX = 4, LEAVE_MS = 220;

export function ToastProvider({ children }) {
  const [list, setList] = useState([]), timers = useRef(new Map()), seq = useRef(0);
  const clear = (id) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); };
  const drop = useCallback((id) => { clear(id); setList((l) => l.filter((t) => t.id !== id)); }, []);
  const dismiss = useCallback((id) => {
    clear(id);
    setList((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    timers.current.set(id, setTimeout(() => drop(id), LEAVE_MS));
  }, [drop]);
  const arm = useCallback((id, ms) => { clear(id); timers.current.set(id, setTimeout(() => dismiss(id), ms)); }, [dismiss]);
  const push = useCallback(({ text, tone = "success", ms }) => {
    const id = ++seq.current;
    setList((l) => [...l, { id, text, tone }].slice(-MAX));
    arm(id, ms ?? (tone === "danger" ? 7000 : 3500));
    return id;
  }, [arm]);
  useEffect(() => { const t = timers.current; return () => t.forEach((x) => clearTimeout(x)); }, []);
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {list.map((t) => (
          <div key={t.id} className={`iq-toast iq-toast-${t.tone}` + (t.leaving ? " leaving" : "")} role={t.tone === "danger" ? "alert" : "status"}
            onMouseEnter={() => !t.leaving && clear(t.id)} onMouseLeave={() => !t.leaving && arm(t.id, 1500)} onFocus={() => !t.leaving && clear(t.id)} onBlur={() => !t.leaving && arm(t.id, 1500)}>
            <i className={`bi bi-${ICON[t.tone] ?? ICON.info} iq-toast-icon`} aria-hidden="true" />
            <span className="iq-toast-text">{t.text}</span>
            <button type="button" className="iq-toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}><i className="bi bi-x-lg" aria-hidden="true" /></button>
          </div>))}
      </div>
    </Ctx.Provider>
  );
}
