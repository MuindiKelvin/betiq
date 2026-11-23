// npm run test:secrets  - the scanner finds each kind of secret, ignores placeholders, and never returns the matched text.
// Fake values are assembled at run time so this file itself contains nothing that looks like a credential.
import assert from "node:assert/strict";
import { isForbidden, scanText } from "../check-secrets.mjs";

const ok = (name, fn) => { fn(); console.log("ok  " + name); };
const rules = (file, text) => scanText(file, text).map((f) => f.rule);

const pem = "-----BEGIN " + "PRIVATE KEY-----";
const web = "AI" + "za" + "A".repeat(35);
const gh = "gh" + "p_" + "a1".repeat(18);
const bsd = "BSD_API_" + "KEY=" + "abcd1234".repeat(4);

ok("finds a private key block and a service-account JSON", () => {
  assert.deepEqual(rules("a.txt", pem + "\nMIIE..."), ["private-key-block"]);
  assert.ok(rules("k.json", '{"private_key": "' + pem + '\\nabc"}').includes("service-account-json"));
});
ok("finds the BSD key value but not placeholders or an empty value", () => {
  assert.deepEqual(rules(".env", bsd), ["bsd-api-key-value"]);
  for (const t of ["BSD_API_KEY=", "BSD_API_KEY=your_key_here", "BSD_API_KEY=xxxxxxxxxxxxxxxxxxxx", "BSD_API_KEY=<paste here>", "# BSD_API_KEY (free key)"]) assert.deepEqual(rules("x", t), [], t);
});
ok("finds GitHub tokens; the Firebase web key is only a warning", () => {
  assert.deepEqual(rules("a", gh), ["github-token"]);
  const w = scanText("a", web); assert.equal(w.length, 1); assert.equal(w[0].sev, "warn");
});
ok("clean source produces no findings", () => {
  assert.deepEqual(scanText("src/App.jsx", "const FEATURES = []; export default function App() {}"), []);
});
ok("the report never contains the matched text", () => {
  const out = JSON.stringify([...scanText("f", pem + web + gh + bsd)]);
  for (const secret of [web, gh, bsd, "abcd1234"]) assert.ok(!out.includes(secret));
});
ok("forbidden files: real env and key files, but not .env.example", () => {
  for (const f of [".env", "betiq/.env", ".env.local", "serviceAccountKey.json", "keys/serviceAccountKey (1).json", "proj-firebase-adminsdk-abc.json", ".sync-out/live/main.json"]) assert.ok(isForbidden(f), f);
  for (const f of [".env.example", "src/env.js", "scripts/lib/bsd.mjs", "serviceAccount.md"]) assert.ok(!isForbidden(f), f);
});
console.log("\nALL SECRET-SCANNER TESTS PASSED");
