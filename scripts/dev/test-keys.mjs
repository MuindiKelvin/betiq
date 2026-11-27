// Keyboard helpers (src/lib/keys.js): which key presses are shortcuts, and how j / k step through a list.
import assert from "node:assert/strict";
import { isTyping, keyName, stepIndex, tabForDigit } from "../../src/lib/keys.js";

const el = (tagName, o = {}) => ({ nodeType: 1, tagName, isContentEditable: false, getAttribute: (n) => (n === "type" ? o.type ?? null : null), ...o });
// typing targets keep single-key shortcuts out
assert.equal(isTyping(el("INPUT")), true);
assert.equal(isTyping(el("INPUT", { type: "search" })), true);
assert.equal(isTyping(el("INPUT", { type: "date" })), true);
assert.equal(isTyping(el("INPUT", { type: "checkbox" })), false);
assert.equal(isTyping(el("INPUT", { type: "radio" })), false);
assert.equal(isTyping(el("TEXTAREA")), true);
assert.equal(isTyping(el("SELECT")), true);
assert.equal(isTyping(el("DIV", { isContentEditable: true })), true);
assert.equal(isTyping(el("BUTTON")), false);
assert.equal(isTyping(null), false);

// key names
const k = (key, o = {}) => keyName({ key, ...o });
assert.equal(k("j"), "j"); assert.equal(k("J"), "j"); assert.equal(k("?", { shiftKey: true }), "?"); assert.equal(k("/"), "/");
assert.equal(k("["), "["); assert.equal(k("ArrowLeft"), "ArrowLeft"); assert.equal(k("Escape"), "Escape"); assert.equal(k("1"), "1");
assert.equal(k("k", { ctrlKey: true }), "mod+k"); assert.equal(k("K", { metaKey: true }), "mod+k");
assert.equal(k("k", { ctrlKey: true, shiftKey: true }), null);        // not ours
assert.equal(k("a", { ctrlKey: true }), null);                        // select all, copy ... stay with the browser
assert.equal(k("ArrowLeft", { altKey: true }), null);                 // Alt+Left = browser back
assert.equal(k("j", { isComposing: true }), null); assert.equal(k("Dead"), null); assert.equal(k("Process"), null); assert.equal(k(undefined), null);
assert.equal(keyName(null), null);

// sidebar digits
const tabs = ["explore", "live", "daily", "picks", "history", "profile", "help"];
assert.equal(tabForDigit("1", tabs), "explore"); assert.equal(tabForDigit("7", tabs), "help"); assert.equal(tabForDigit("8", tabs), undefined);
assert.equal(tabForDigit("0", tabs), undefined); assert.equal(tabForDigit("a", tabs), undefined); assert.equal(tabForDigit("10", tabs), undefined);

// j / k
const rects = [0, 1, 2, 3, 4].map((i) => ({ top: 100 + i * 80, bottom: 170 + i * 80 }));
assert.equal(stepIndex(1, 1, rects), 2); assert.equal(stepIndex(-1, 1, rects), 0);
assert.equal(stepIndex(-1, 0, rects), 0, "k at the top stays");  assert.equal(stepIndex(1, 4, rects), 4, "j at the bottom stays");
assert.equal(stepIndex(1, -1, rects, { top: 60 }), 0, "j with nothing focused: first row under the top bar");
assert.equal(stepIndex(1, -1, rects, { top: 200 }), 1, "... skipping rows scrolled under the bar");
assert.equal(stepIndex(1, -1, rects, { top: 9999 }), 4, "... all above: the last one");
assert.equal(stepIndex(-1, -1, rects, { height: 330 }), 2, "k with nothing focused: last row that starts on screen");
assert.equal(stepIndex(-1, -1, rects, { height: 50 }), 0, "... none on screen: the first");
assert.equal(stepIndex(1, -1, [], {}), -1); assert.equal(stepIndex(1, 3, [], {}), -1);
console.log("keys: ok");
