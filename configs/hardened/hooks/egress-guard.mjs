#!/usr/bin/env node
// Hardened-pack PreToolUse egress guard (spec §6.1, §19.3) — the second layer of the
// strongest arm (hook + deny). Deny rules in settings.json stop the common verbs; this hook
// is the backstop that catches the rest, and holds even under bypassPermissions (§3 fact).
//
// Reads a PreToolUse hook payload on stdin and denies any tool call that would send data
// off-box. Keyless, zero dependencies, cross-platform (Node runs the same on Windows, §21.12).
// The predicate mirrors src/egress.ts; keep the two in sync when either changes.
import { readFileSync } from "node:fs";

const EGRESS_CMD =
  /(^|[\s;&|(`"'])(curl|wget|nc|ncat|telnet|nslookup|dig|scp|ftp|iwr|irm)\b|invoke-webrequest|invoke-restmethod|invoke-expression|webclient|downloadstring|downloadfile|\bgit\s+push\b/i;
const EGRESS_TOOLS = new Set(["WebFetch", "WebSearch"]);

export function egressReason(input) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  if (EGRESS_TOOLS.has(tool)) return `tool ${tool} can reach the network`;
  if (tool.startsWith("mcp__")) return `MCP tool ${tool} may egress off-box`;
  if (tool === "Bash" && EGRESS_CMD.test(String(ti.command ?? ""))) return "shell command performs network egress";
  return null;
}

// ponytail: only run the stdin/exit dance as a script, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("egress-guard.mjs")) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { /* not JSON — treat as empty */ }
  const reason = egressReason(input);
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `egress denied: ${reason}`,
      },
    }));
  } else {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}
