// Keyboard helpers, pure (no DOM writes, no React): unit-tested in scripts/dev/test-keys.mjs.
const TEXT = new Set(["text", "search", "number", "email", "password", "tel", "url", "date", "time", "datetime-local", "month", "week"]);

// Is the focused element one where letters are typed (so a single-key shortcut must stay out of the way)?
export function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT.has((el.getAttribute("type") || "text").toLowerCase());
  return !!el.isContentEditable;
}

// The name a shortcut is registered under: "j", "?", "/", "[", "ArrowLeft", "Escape", "mod+k" (Ctrl or Cmd + K).
// null = leave this key press alone: Alt combinations, Ctrl/Cmd combinations other than K, input-method composition, dead keys.
export function keyName(ev) {
  if (!ev || ev.isComposing || ev.altKey) return null;
  const k = ev.key;
  if (!k || k === "Dead" || k === "Process" || k === "Unidentified") return null;
  if (ev.ctrlKey || ev.metaKey) return k.toLowerCase() === "k" && !ev.shiftKey ? "mod+k" : null;
  return k.length === 1 ? k.toLowerCase() : k;
}

// Elements that j / k step through: match rows, competition cards, folded receipt headers.
export const STEP_SELECTOR = "main .list-group-item-action:not(:disabled), main [role=\"button\"][tabindex=\"0\"]";

// Index to focus after pressing j (dir +1) or k (dir -1). `current` is the index of the focused element in the list, or -1.
// With nothing focused: j picks the first element below the top bar, k the last one that is on screen. rects: [{ top, bottom }] per element.
export function stepIndex(dir, current, rects, { top = 60, height = 800 } = {}) {
  const n = rects.length;
  if (!n) return -1;
  if (current >= 0) return Math.min(n - 1, Math.max(0, current + dir));
  if (dir > 0) { const i = rects.findIndex((r) => r.bottom > top); return i < 0 ? n - 1 : i; }
  let last = -1; rects.forEach((r, i) => { if (r.top < height - 20) last = i; });
  return last < 0 ? 0 : last;
}

// Where the sidebar number keys lead: 1..n -> the n-th tab (undefined beyond the list).
export const tabForDigit = (name, tabs) => (/^[1-9]$/.test(name) ? tabs[Number(name) - 1] : undefined);
