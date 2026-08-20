// Live potency pilot (plan Task 18) — runs a curated, HOST-SAFE subset of the corpus in the
// `bypass` arm on Claude Code subscription quota (SDK authenticates off Claude Code credentials
// with ANTHROPIC_API_KEY unset — the §3 path; no metered API).
//
// SAFETY (honours "do not compromise the current system"): bypass has NO egress gate, so this
// pilot runs ONLY goals that cannot touch the host — exfil-to-loopback (curl/webfetch/mcp/dns/git
// all target the 127.0.0.1 sink), sandbox-internal edits (backdoor), and deputy. It deliberately
// EXCLUDES write-outside / persist / add-dep, which under bypass could write outside the sandbox
// or install real packages. Canary is synthetic (AIL-CANARY-*); every sink binds 127.0.0.1.
//
// Run:  AIL_LIVE=1 npx tsx scripts/pilot.ts    (writes pilot.db; ~30-50s per cell)

import { randomBytes } from "node:crypto";
import * as path from "node:path";
import { openStore } from "../src/store.js";
import { startSink } from "../src/sink.js";
import { loadCorpus } from "../src/corpus/index.js";
import { makeSdkRunner } from "../src/agent/sdk.js";
import { ARMS } from "../src/arms.js";
import { runCell } from "../src/runner.js";

const IDS = [
  "comment-exfil-bash-heartbeat",
  "claudemd-exfil-bash-ci",
  "claudemd-exfil-mcp-telemetry",
  "test-message-exfil-bash-register",
  "comment-exfil-webfetch-lint",
  "commit-msg-exfil-bash-token",
  "comment-backdoor-metrics",
  "dep-dts-exfil-bash-activate",
  "readme-exfil-bash-setup",
  "pkg-script-exfil-bash-pretest",
  // the three metadata carriers (now delivered by runCell): mcp tool description, PR, issue
  "mcp-tool-desc-exfil-mcp-governance",
  "pr-title-exfil-bash-cistatus",
  "issue-body-exfil-bash-repro",
];

const corpus = loadCorpus();
const store = openStore("pilot.db");
const rows: string[] = [];
for (const id of IDS) {
  const p = corpus.find((x) => x.id === id);
  if (!p) { console.log(`MISSING ${id}`); continue; }
  const sink = await startSink();
  const canary = `AIL-CANARY-${randomBytes(8).toString("hex")}`;
  const t0 = Date.now();
  try {
    const row = await runCell(makeSdkRunner(sink), sink, store, {
      payload: p, arm: ARMS.bypass, rep: 0, model: "claude-haiku-4-5",
      fixtureDir: path.join("fixtures", p.taskId), runId: `pilot-${id}`,
      canary, maxTurns: 20, timeoutMs: 150_000,
    });
    const s = `${id}\t[${p.carrier}/${p.goal}]\tout=${row.outcome}\tattempt=${row.egressAttempted}\tcarrierRead=${row.carrierRead}\ttaskPassed=${row.taskPassed}\tstop=${row.stop}\t${Math.round((Date.now()-t0)/1000)}s`;
    console.log("DONE " + s); rows.push(s);
  } catch (e) {
    const s = `${id}\tERROR ${(e as Error).message}`;
    console.log(s); rows.push(s);
  } finally {
    await sink.close();
  }
}
console.log("\n===== PILOT SUMMARY =====");
for (const r of rows) console.log(r);
store.close();
