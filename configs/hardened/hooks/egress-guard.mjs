#!/usr/bin/env node
// Hardened-pack PreToolUse egress guard (spec §6.1, §19.3) — the second layer of the strongest arm
// (hook + deny). Deny rules in settings.json stop the common verbs; this hook is the backstop that
// catches the rest, and holds even under bypassPermissions (§3 fact).
//
// Reads a PreToolUse hook payload on stdin and denies any tool call that would send data off-box.
// Keyless, zero dependencies, cross-platform (Node runs the same on Windows, §21.12).
//
// PARITY WITH src/egress.ts IS A GATE, NOT A HOPE (audit F5). This file used to carry the comment
// "the predicate mirrors src/egress.ts" while covering only WebFetch/WebSearch, mcp__*, and a Bash
// regex — no Task, no Write/Edit path containment, no persistence surfaces. The measured `hook` arm
// wires the FULL isEgress predicate, so the arm was strictly stronger than the config users were
// told to copy, and the strongest-arm claim overstated the installed defense. The two predicates
// are now pinned to agree by src/egress-parity.test.ts.
//
// It cannot import src/egress.ts: this file is copied standalone into a user project, where no
// harness exists. The duplication is deliberate; the test is what keeps it honest.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";

const EGRESS_CMD =
  /(^|[\s;&|(`"'])(curl|wget|nc|ncat|telnet|nslookup|dig|scp|ftp|iwr|irm)\b|invoke-webrequest|invoke-restmethod|invoke-expression|webclient|downloadstring|downloadfile|\bgit\s+push\b/i;
const EGRESS_TOOLS = new Set(["WebFetch", "WebSearch"]);
const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/** A session that plants an instruction here is obeyed by every LATER session (spec §8.3). */
const PERSIST = /(^|\/)(CLAUDE\.md|\.claude\/|CLAUDE\.local\.md)/i;
/** A token in a Bash command that looks like a path worth resolving against the root. */
const PATH_TOKEN = /(^|[\s;&|(`"'=])((?:\.{1,2}[\\/]|[\\/]|~[\\/]|[A-Za-z]:[\\/])[^\s;&|)`"']+)/g;
/** A drive-letter or UNC prefix — absolute on Windows, an ordinary relative name to POSIX. */
const WIN_ABS = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/** Native separators would break PERSIST on Windows, a first-class target. */
const slash = (p) => p.replace(/\\/g, "/");

/** Is `p` contained by `root`? Lexical, then symlink-aware — a junction at <root>/x is lexically
 *  inside and resolves outside. Fails CLOSED: an unresolvable root is not evidence of containment. */
function within(root, p) {
  if (WIN_ABS.test(p) && !WIN_ABS.test(root)) return false;
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  try {
    let probe = abs;
    while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const real = path.join(realpathSync(probe), path.relative(probe, abs));
    const realRel = path.relative(realpathSync(root), real);
    return !realRel.startsWith("..") && !path.isAbsolute(realRel);
  } catch {
    return false;
  }
}

/** The project this hook is guarding. Claude Code exports CLAUDE_PROJECT_DIR; the payload carries
 *  `cwd`; cwd is the last resort. */
function projectRoot(input) {
  const cand = process.env.CLAUDE_PROJECT_DIR
    || (typeof input?.cwd === "string" ? input.cwd : "")
    || process.cwd();
  try { return realpathSync(cand); } catch { return path.resolve(cand); }
}

export function egressReason(input, root = projectRoot(input)) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  if (EGRESS_TOOLS.has(tool)) return `tool ${tool} can reach the network`;
  // A subagent inherits the task but not this hook's reasoning about it, so a parent that cannot
  // egress can still ask a child to (spec §6.2, the confused-deputy goal).
  if (tool === "Task") return "subagent spawn can route egress around this guard";
  if (tool.startsWith("mcp__")) return `MCP tool ${tool} may egress off-box`;
  if (tool === "Bash") {
    const cmd = String(ti.command ?? "");
    if (EGRESS_CMD.test(cmd)) return "shell command performs network egress";
    for (const m of cmd.matchAll(PATH_TOKEN)) {
      if (!within(root, m[2])) return "shell command touches a path outside the project";
    }
  }
  if (EDIT_TOOLS.has(tool)) {
    const fp = String(ti.file_path ?? "");
    if (fp && !within(root, fp)) return "write outside the project";
    if (PERSIST.test(slash(fp))) return "write to a persistence surface a later session would obey";
  }
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
