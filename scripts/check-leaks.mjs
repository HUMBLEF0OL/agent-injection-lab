// SDK-import isolation gate (§5, §14) + trajectory-privacy scan (§21 item 13).
// Lifted+adapted from agent-eval-harness scripts/check-leaks.mjs (MIT).
//
// Part 1 — SDK isolation: only src/agent/sdk.ts may reach the Agent SDK. Covers
// every import form (static `from`, bare `import`, dynamic `import()`, `require()`)
// and any subpath, because a `from`-only regex misses the others.
//
// Part 2 — trajectory privacy: trajectories are committed, so assert no
// real-credential-shaped string leaked into any tracked .db. The synthetic
// AIL-CANARY-* value is expected and stripped before the shape check runs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";

const VENDOR = /\b(?:from|import|require)\s*\(?\s*["']@anthropic-ai\/claude-agent-sdk(?:\/[^"']*)?["']/;
const ALLOWED = "src/agent/sdk.ts"; // display string; comparison below uses path.sep

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith(".ts")) continue;
    if (relative("src", p).split(sep).join("/") === "agent/sdk.ts") continue;
    if (VENDOR.test(readFileSync(p, "utf8"))) offenders.push(p.split(sep).join("/"));
  }
}
walk("src");
if (offenders.length) {
  console.error(`Agent SDK imported outside ${ALLOWED} (§5):`);
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log(`leak check ok — SDK imported only in ${ALLOWED}`);

// ── §21 item 13 trajectory privacy: no real-credential shape in any tracked .db ──
// Well-known token shapes plus PEM private-key headers. The canary never matches
// these prefixes, but strip it first anyway so the intent — "looks like a key/token
// AND is not our synthetic canary" — is explicit rather than incidental.
const CRED = [
  /AKIA[0-9A-Z]{16}/,                                   // AWS access key id
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,                         // Anthropic key
  /\bsk-[A-Za-z0-9]{20,}/,                               // OpenAI-style key
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,                        // GitHub token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,                      // Slack token
  /\bAIza[0-9A-Za-z_-]{35}\b/,                           // Google API key
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,      // PEM private key
];

let trackedDbs = [];
try {
  trackedDbs = execFileSync("git", ["ls-files", "-z", "*.db"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
} catch {
  console.log("privacy scan skipped — git not available to list tracked .db files");
  process.exit(0);
}

const leaks = [];
for (const db of trackedDbs) {
  // latin1 keeps every byte a 1:1 char so ASCII token shapes match inside binary.
  const text = readFileSync(db, "latin1").replace(/AIL-CANARY-[0-9a-fA-F]+/g, "");
  for (const re of CRED) {
    const m = text.match(re);
    if (m) leaks.push(`${db}: ${m[0].slice(0, 12)}… (${re})`);
  }
}
if (leaks.length) {
  console.error("Real-credential shape found in tracked database(s) (§21 item 13):");
  for (const l of leaks) console.error("  " + l);
  process.exit(1);
}
console.log(`privacy scan ok — ${trackedDbs.length} tracked .db, no credential shapes`);
