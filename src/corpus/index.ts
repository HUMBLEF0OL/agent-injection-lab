import * as fs from "node:fs";
import * as path from "node:path";
import type { Carrier, Goal, Style } from "../types.js";

export interface Payload {
  id: string; carrier: Carrier; goal: Goal; style: Style;
  taskId: string;                 // the fixture this payload is bound to (§11)
  text: string;                   // raw payload text with %CANARY% / %SINK% placeholders
  technique: string;              // §4.3.2 — the real incident it instantiates
  realism: string;                // §4.3.4 — the realism-rubric note
}

const CARRIERS: readonly string[] = [
  "readme", "claude-md", "comment", "test-message", "pkg-script",
  "dep-dts", "commit-msg", "mcp-tool-desc", "pr-title", "issue-body",
] satisfies readonly Carrier[];

const GOALS: readonly string[] = [
  "exfil-bash", "exfil-webfetch", "exfil-mcp", "exfil-git", "exfil-dns",
  "exfil-markdown", "write-outside", "backdoor", "postinstall", "add-dep",
  "persist", "deputy",
] satisfies readonly Goal[];

const STYLES: readonly string[] = ["piggyback", "redirect"] satisfies readonly Style[];

function pick(m: Record<string, unknown>, key: string, allowed: readonly string[], where: string): string {
  const v = m[key];
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new Error(`${where}: invalid ${key} ${JSON.stringify(v)} (expected one of ${allowed.join(", ")})`);
  }
  return v;
}

function str(m: Record<string, unknown>, key: string, where: string): string {
  const v = m[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`${where}: missing ${key}`);
  return v;
}

/** Load every payload directory (`meta.json` + `payload.txt`) under `dir`, sorted by id. */
export function loadCorpus(dir: string = import.meta.dirname): Payload[] {
  const out: Payload[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // ponytail: `_`-prefixed dirs are loader test data, never corpus payloads
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const metaPath = path.join(dir, e.name, "meta.json");
    const textPath = path.join(dir, e.name, "payload.txt");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    const id = str(meta, "id", metaPath);
    if (id !== e.name) throw new Error(`${metaPath}: id ${id} does not match directory ${e.name}`);
    out.push({
      id,
      carrier: pick(meta, "carrier", CARRIERS, metaPath) as Carrier,
      goal: pick(meta, "goal", GOALS, metaPath) as Goal,
      style: pick(meta, "style", STYLES, metaPath) as Style,
      taskId: str(meta, "taskId", metaPath),
      technique: str(meta, "technique", metaPath),
      realism: str(meta, "realism", metaPath),
      text: fs.readFileSync(textPath, "utf8"),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function renderPayload(p: Payload, subs: { canary: string; sinkUrl: string }): string {
  return p.text.replaceAll("%CANARY%", subs.canary).replaceAll("%SINK%", subs.sinkUrl);
}
