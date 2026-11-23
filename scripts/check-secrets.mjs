// Fails when a credential is tracked by git or when a file that git would add contains one.  npm run check:secrets
// It reports the FILE and the RULE only. It never prints the matched text, so its output is safe to paste into a ticket or a CI log.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// error = a real secret; warn = something that is public by design (Firebase web key) but should not sit in tracked source.
export const RULES = [
  { id: "private-key-block", sev: "error", re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: "service-account-json", sev: "error", re: /"private_key"\s*:\s*"-----BEGIN/ },
  { id: "bsd-api-key-value", sev: "error", re: /BSD_API_KEY\s*[=:]\s*["']?(?!your|xxx|changeme|<)[A-Za-z0-9_-]{16,}/i },
  { id: "github-token", sev: "error", re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { id: "slack-token", sev: "error", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "anthropic-or-openai-key", sev: "error", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/ },
  { id: "google-api-key", sev: "warn", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];
// Files that must never be tracked, whatever they contain.
export const FORBIDDEN = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /(^|\/)serviceAccountKey[^/]*\.json$/i, /(^|\/)[^/]*-firebase-adminsdk-[^/]*\.json$/i, /(^|\/)\.sync-out(\/|$)/];

// Pure: returns [{ file, rule, sev }] for one file's text. Never returns the text itself.
export function scanText(file, text) {
  return RULES.filter((r) => r.re.test(text)).map((r) => ({ file, rule: r.id, sev: r.sev }));
}
export const isForbidden = (file) => FORBIDDEN.some((re) => re.test(file));

const SKIP = /(^|\/)(node_modules|dist|\.git|\.firebase)\//, SKIP_FILE = /(package-lock\.json|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz))$/i, MAX = 2_000_000;

function git(args) { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean); }

export function scanRepo() {
  const tracked = new Set(git(["ls-files"])), candidates = git(["ls-files", "--cached", "--others", "--exclude-standard"]);
  const findings = [];
  for (const f of tracked) if (isForbidden(f)) findings.push({ file: f, rule: "forbidden-file-tracked", sev: "error" });
  for (const f of new Set(candidates)) {
    if (SKIP.test(f) || SKIP_FILE.test(f) || !fs.existsSync(f)) continue;
    const st = fs.statSync(f); if (!st.isFile() || st.size > MAX) continue;
    findings.push(...scanText(f, fs.readFileSync(f, "utf8")));
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let findings;
  try { findings = scanRepo(); } catch (e) { console.error("check:secrets needs a git repository (", e.message.split("\n")[0], ")"); process.exit(2); }
  for (const f of findings) console.log(`${f.sev.toUpperCase().padEnd(5)} ${f.file}  [${f.rule}]`);
  const errors = findings.filter((f) => f.sev === "error").length;
  console.log(errors ? `\n${errors} secret finding(s). Remove them, rotate the credential, and rewrite history if it was ever committed.` : `check:secrets OK (${findings.length} warning(s))`);
  process.exit(errors ? 1 : 0);
}
