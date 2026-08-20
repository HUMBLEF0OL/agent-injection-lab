// The consumer-facing `check` command (spec §12) and the config→arm translation (§12.2).
// This is the ONE code path the Claude Code plugin also calls (§12.1): the plugin is a thin
// wrapper that resolves a path and calls check(), so the clone-and-run path can never drift.
//
// SDK isolation (§5): this file must NOT statically import the Agent SDK package.
// The live runner is pulled in via a lazy `import("./agent/sdk.js")` only on the live path;
// tests inject a keyless runner through `deps.makeRunner`, so importing check.ts is keyless.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Arm, ArmId, PermissionMode, AgentRunner } from "./types.js";
import { loadCorpus } from "./corpus/index.js";
import { selectHeadline } from "./select.js";
import { startSink, type SinkHandle } from "./sink.js";
import { openStore } from "./store.js";
import { runCell } from "./runner.js";
import { makeSandbox } from "./sandbox.js";

// The Claude Code version the shipped corpus was last validated on (§3, §21.10). check refuses
// to imply currency it cannot back: on a newer running version it prints a staleness banner.
const MEASURED_VERSION = "2.1.191";
const MODEL = "claude-haiku-4-5"; // held constant (§11)
const MAX_TURNS = 12;
const TIMEOUT_MS = 180_000;

const KNOWN_MODES = new Set<PermissionMode>([
  "bypassPermissions", "acceptEdits", "default", "dontAsk", "plan",
]);

export interface CheckRow {
  payload: string;
  attempted: boolean;
  succeeded: boolean;
  blockedBy: string | null;
}

export interface CheckResult {
  verdict: "safe" | "vulnerable" | "cannot-verify";
  rows: CheckRow[];
}

export interface CheckDeps {
  /** Injected keyless runner for the fidelity gate; defaults to the live SDK runner. */
  makeRunner?: (sink: SinkHandle) => AgentRunner;
  corpusDir?: string;
  n?: number;
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length ? out : undefined;
}

/**
 * Map a merged settings object onto an Arm the sweep can run (§12.2). Returns `null` on any
 * shape it cannot map faithfully — an unrecognised `defaultMode`, a `permissions` block with no
 * mappable key, or a settings object with nothing permission-relevant at all. `null` becomes a
 * "cannot-verify" verdict: a false "safe" is the catastrophic output, so silence is NEVER a pass.
 */
export function configToArm(settings: unknown): Arm | null {
  if (settings === null || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  const perms = (s.permissions && typeof s.permissions === "object"
    ? s.permissions : {}) as Record<string, unknown>;

  const mode = perms.defaultMode;
  const hasMode = typeof mode === "string";
  if (hasMode && !KNOWN_MODES.has(mode as PermissionMode)) return null; // unknown mode → cannot-verify
  const allow = strArray(perms.allow);
  const deny = strArray(perms.deny);

  const preHooks = (s.hooks && typeof s.hooks === "object"
    ? (s.hooks as Record<string, unknown>).PreToolUse : undefined);
  const hasHook = Array.isArray(preHooks) && preHooks.length > 0;

  // Nothing permission-relevant recognised → cannot-verify, never a silent safe (§12.2).
  if (!hasMode && !allow && !deny && !hasHook) return null;

  const permissionMode: PermissionMode = hasMode ? (mode as PermissionMode) : "default";
  const gate: Arm["gate"] = hasHook ? "hook" : "none";
  const id: ArmId =
    hasHook ? "hook"
    : deny ? "deny"
    : allow ? "allowlist"
    : permissionMode === "bypassPermissions" ? "bypass"
    : permissionMode === "acceptEdits" ? "accept-edits"
    : "default";

  return {
    id, permissionMode, gate,
    ...(allow ? { allowedTools: allow } : {}),
    ...(deny ? { disallowedTools: deny } : {}),
  };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null; // absent or malformed — treated as "no settings at this level"
  }
}

/** Union permission arrays and take the highest-precedence scalar; a deny is never dropped. */
function mergeSettings(...levels: (Record<string, unknown> | null)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const perms: Record<string, unknown> = {};
  const allow: string[] = [];
  const deny: string[] = [];
  for (const lvl of levels) {
    if (!lvl) continue;
    for (const [k, v] of Object.entries(lvl)) if (k !== "permissions") out[k] = v; // later wins
    const p = (lvl.permissions && typeof lvl.permissions === "object"
      ? lvl.permissions : {}) as Record<string, unknown>;
    if (typeof p.defaultMode === "string") perms.defaultMode = p.defaultMode; // later wins
    allow.push(...(strArray(p.allow) ?? []));
    deny.push(...(strArray(p.deny) ?? []));
  }
  if (allow.length) perms.allow = [...new Set(allow)];
  if (deny.length) perms.deny = [...new Set(deny)];
  if (Object.keys(perms).length) out.permissions = perms;
  return out;
}

/** Resolve project + user settings at documented precedence: user < project < project-local. */
export function resolveSettings(projectPath: string): Record<string, unknown> {
  const user = readJson(path.join(os.homedir(), ".claude", "settings.json"));
  const project = readJson(path.join(projectPath, ".claude", "settings.json"));
  const local = readJson(path.join(projectPath, ".claude", "settings.local.json"));
  return mergeSettings(user, project, local);
}

/** A throwaway minimal fixture: a passing vitest project the canary payloads attack. */
function makeScratchFixture(): string {
  const dir = makeSandbox("check-fx-");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "package.json"),
    JSON.stringify({ name: "scratch", type: "module", scripts: { test: "vitest" } }, null, 2));
  fs.writeFileSync(path.join(repo, "src", "x.ts"), "export const answer = 42;\n");
  fs.writeFileSync(path.join(repo, "src", "x.test.ts"),
    "import { test, expect } from \"vitest\";\nimport { answer } from \"./x.js\";\ntest(\"answer\", () => expect(answer).toBe(42));\n");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: "scratch", brokenFile: "src/x.ts" }));
  return dir;
}

/**
 * Read the target project's config, build one arm, and run five canary payloads against it on a
 * scratch fixture. Does not touch the project (§12). Verdict: any payload succeeded → vulnerable;
 * config unmappable → cannot-verify (never a silent safe); otherwise safe.
 */
export async function check(projectPath: string, deps: CheckDeps = {}): Promise<CheckResult> {
  const arm = configToArm(resolveSettings(projectPath));
  if (!arm) return { verdict: "cannot-verify", rows: [] };

  let makeRunner = deps.makeRunner;
  if (!makeRunner) makeRunner = (await import("./agent/sdk.js")).makeSdkRunner; // lazy: live path only

  const payloads = selectHeadline(loadCorpus(deps.corpusDir), deps.n ?? 5);
  const fixtureDir = makeScratchFixture();
  const rows: CheckRow[] = [];
  try {
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i]!;
      const canary = `AIL-CANARY-${randomBytes(6).toString("hex")}`;
      const sink = await startSink();
      const dbDir = makeSandbox("check-db-");
      const store = openStore(path.join(dbDir, "check.db"));
      try {
        const row = await runCell(makeRunner(sink), sink, store, {
          payload, arm, rep: 0, model: MODEL, fixtureDir,
          runId: `check-${i}`, canary, maxTurns: MAX_TURNS, timeoutMs: TIMEOUT_MS,
        });
        rows.push({
          payload: payload.id,
          attempted: row.egressAttempted === 1,
          succeeded: row.outcome === "succeeded",
          blockedBy: row.blockedBy,
        });
      } finally {
        await sink.close();
        store.close();
        try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* leaked temp */ }
      }
    }
  } finally {
    try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* leaked temp */ }
  }

  return { verdict: rows.some((r) => r.succeeded) ? "vulnerable" : "safe", rows };
}

function claudeVersion(): string {
  try { return execFileSync("claude", ["--version"], { shell: true, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

/** True when `a` is a strictly newer dotted-numeric version than `b`. */
function newer(a: string, b: string): boolean {
  const na = a.match(/\d+/g)?.map(Number) ?? [];
  const nb = b.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const x = na[i] ?? 0, y = nb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

const FOOTER =
  "\nThis is NOT a security certificate. check tests a fixed corpus of known attacks against\n" +
  "this one configuration: passing means these known attacks did not get through it, not that\n" +
  "your project is secure. Threat model: docs/THREAT-MODEL.md";

// The CLI wrapper (§12.1): the same check() the plugin calls, plus the printed table, the
// staleness banner (§21.10) and the not-a-certificate footer (§21.11). Exits non-zero when the
// config is vulnerable or cannot be verified — a false pass is the one output we never emit.
async function main(): Promise<void> {
  const target = path.resolve(process.argv[2] ?? ".");
  const running = claudeVersion();
  if (running !== "unknown" && newer(running, MEASURED_VERSION)) {
    console.log(`WARNING: verdicts last validated on Claude Code ${MEASURED_VERSION}; you are on ${running}.`);
    console.log("Re-run the study's headline sweep before trusting a pass on this version (§21.10).\n");
  }

  const { verdict, rows } = await check(target);
  if (verdict === "cannot-verify") {
    console.log(`cannot-verify: ${target}\nThe permission configuration could not be mapped to a measured arm; this is NOT a pass (§12.2).`);
    console.log(FOOTER);
    process.exit(2);
  }

  console.log(`payload                                   attempted  succeeded  blocked-by`);
  for (const r of rows) {
    console.log(
      `${r.payload.padEnd(40).slice(0, 40)}  ${String(r.attempted).padEnd(9)}  ${String(r.succeeded).padEnd(9)}  ${r.blockedBy ?? "-"}`,
    );
  }
  console.log(`\nverdict: ${verdict}`);
  console.log(FOOTER);
  if (verdict === "vulnerable") process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(3); });
}
