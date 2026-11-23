// npm run test:rules-contract
// Not a rules emulator test (the emulator needs a Java download). It checks that what the app WRITES (src/) agrees with what firestore.rules ALLOWS:
// every key the app sends is permitted, every key the rules require is sent, and every request carries the caller's uid.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath returns a correct path on every OS (URL.pathname gives "/C:/..." on Windows, which broke the old version).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), ok = (n) => console.log("ok  " + n);

/* ---------- a tiny scanner: split call arguments and read the top-level keys of an object literal ---------- */
function skipString(s, i) { const q = s[i]; for (i++; i < s.length; i++) { if (s[i] === "\\") i++; else if (s[i] === q) return i; } return s.length; }
function splitTop(s, from, open, close) {          // s[from] === open; returns { parts: [source of each top-level comma-separated part], end }
  const parts = []; let depth = 0, start = from + 1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(s, i); continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { depth--; if (depth === 0) { parts.push(s.slice(start, i)); return { parts, end: i }; } }
    else if (c === "," && depth === 1) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  throw new Error("unbalanced " + open + close);
}
function objectKeys(lit) {                          // lit = "{ a: 1, b, ...c }" -> { keys, spread }
  const t = lit.trim(); assert.ok(t.startsWith("{") && t.endsWith("}"), "not an object literal: " + t.slice(0, 40));
  const { parts } = splitTop(t, 0, "{", "}"), keys = []; let spread = false;
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.startsWith("...")) { spread = true; continue; }
    const m = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(p); assert.ok(m, "cannot read key in: " + p.slice(0, 40)); keys.push(m[1]);
  }
  return { keys, spread };
}
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));
function writes(re) {                               // every `setDoc(...)` / `addDoc(...)` whose first argument matches re -> [{ file, keys, spread, valueOf(key) }]
  const out = [];
  for (const f of files(path.join(ROOT, "src"))) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(setDoc|addDoc)\(/g)) {
      const open = m.index + m[0].length - 1, { parts } = splitTop(src, open, "(", ")");
      if (parts.length < 2 || !re.test(parts[0])) continue;
      out.push({ file: path.relative(ROOT, f), ...objectKeys(parts[1]), body: parts[1] });
    }
  }
  return out;
}
const list = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
const block = (start) => { const i = rules.indexOf(start); assert.ok(i >= 0, "rules block not found: " + start); const j = rules.indexOf("\n    match ", i + 10); return rules.slice(i, j < 0 ? undefined : j); };
const only = (b) => list(/hasOnly\(\[([^\]]*)\]\)/.exec(b)[1]), all = (b) => list(/hasAll\(\[([^\]]*)\]\)/.exec(b)?.[1] ?? "");

/* ---------- the scanner itself ---------- */
{
  const lit = '{ v: 3, a: f(x, { y: 1 }), t: `t${u}, w`, b, ...rest, c: [1, 2], d: g(1) ?? null }';
  const r = objectKeys(lit); assert.deepEqual(r.keys, ["v", "a", "t", "b", "c", "d"]); assert.ok(r.spread);
  assert.deepEqual(splitTop("f(a, [b, c], {d: 1}, 'x,y')", 1, "(", ")").parts.map((s) => s.trim()), ["a", "[b, c]", "{d: 1}", "'x,y'"]);
  ok("scanner reads top-level keys through nested calls, strings and spreads");
}

/* ---------- requests ---------- */
const reqRules = block("match /requests/{id}"), reqAllowed = only(reqRules), reqKinds = list(/kind in \[([^\]]*)\]/.exec(reqRules)[1]);
const reqWrites = writes(/^\s*doc\(\s*db\s*,\s*"requests"/);
assert.ok(reqWrites.length >= 5, `expected at least 5 request write sites in src/, found ${reqWrites.length}`);
for (const w of reqWrites) {
  assert.ok(!w.spread, `${w.file}: a spread hides keys from this check`);
  for (const k of w.keys) assert.ok(reqAllowed.includes(k), `${w.file}: sends "${k}" but firestore.rules does not allow it`);
  for (const k of ["kind", "league", "at", "uid"]) assert.ok(w.keys.includes(k), `${w.file}: request is missing "${k}"`);
  assert.match(w.body, /uid\s*:\s*auth\.currentUser\??\.uid/, `${w.file}: uid must be the signed-in user's id`);
  assert.match(w.body, /at\s*:\s*serverTimestamp\(\)/, `${w.file}: "at" must be serverTimestamp() (the rules require request.time)`);
  const lit = /kind\s*:\s*"([a-z0-9]+)"/.exec(w.body); if (lit) assert.ok(reqKinds.includes(lit[1]), `${w.file}: kind "${lit[1]}" is not allowed by the rules`);
}
ok(`${reqWrites.length} request write sites match the rules (keys, kind, uid, server time)`);
assert.ok(reqAllowed.includes("uid") && /request\.resource\.data\.uid == request\.auth\.uid/.test(reqRules), "rules must bind uid to the caller");
ok("rules bind the request uid to the caller");

/* ---------- picks ---------- */
const pickRules = block("match /users/{uid}/picks/{id}"), pickAllowed = only(pickRules), pickRequired = all(pickRules);
const pickWrites = writes(/"picks"/);
assert.ok(pickWrites.length >= 2, `expected at least 2 pick write sites in src/, found ${pickWrites.length}`);
for (const w of pickWrites) {
  assert.ok(!w.spread, `${w.file}: a spread hides keys from this check`);
  for (const k of w.keys) assert.ok(pickAllowed.includes(k), `${w.file}: pick sends "${k}" but firestore.rules does not allow it`);
  for (const k of pickRequired) assert.ok(w.keys.includes(k), `${w.file}: pick is missing required "${k}"`);
  assert.match(w.body, /createdAt\s*:\s*serverTimestamp\(\)/); assert.match(w.body, /\bv\s*:\s*3\b/);
}
ok(`${pickWrites.length} pick write sites match the rules`);
assert.ok(!/allow[^;]*\b(update|write)\b/.test(pickRules), "the picks rules must not allow update or write");
for (const f of files(path.join(ROOT, "src"))) assert.ok(!/updateDoc\(/.test(fs.readFileSync(f, "utf8")), `${f}: updateDoc is used but the rules deny updates to picks and requests`);
ok("no client code updates documents (the rules deny updates)");

/* ---------- never writable / never readable by clients ---------- */
const readable = list(/coll in \[([^\]]*)\]/.exec(rules)[1]);
for (const c of ["system", "users", "requests"]) assert.ok(!readable.includes(c), `"${c}" must not be in the public read list`);
ok("system data is not in the client read list");
assert.ok(readable.includes("daily"), "daily picks must be readable");
for (const c of ["daily", "schedule"]) assert.ok(JSON.parse(fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8")).fieldOverrides.some((o) => o.collectionGroup === c && o.fieldPath === "list" && o.indexes.length === 0), `${c}.list must be exempt from indexing (large array)`);
ok("daily picks are readable and their list is exempt from indexing");
console.log("\nALL RULES CONTRACT TESTS PASSED");
