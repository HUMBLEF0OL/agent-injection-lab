// Plants attack payloads at each carrier's filesystem site inside a sandbox.
// See docs spec §4 (carriers) and plan Task 8.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Carrier } from "./types.js";
import type { Payload } from "./corpus/index.js";
import { makeSandbox } from "./sandbox.js";

/** First `src/*.ts` in `root` (sorted), or undefined. */
function firstSrcTs(root: string): string | undefined {
  const srcDir = path.join(root, "src");
  if (!fs.existsSync(srcDir)) return undefined;
  const hit = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort()[0];
  return hit ? path.join("src", hit) : undefined;
}

/** First `*.test.ts` under `root/src` (sorted), or undefined. */
function firstTestTs(root: string): string | undefined {
  const srcDir = path.join(root, "src");
  if (!fs.existsSync(srcDir)) return undefined;
  const hit = fs.readdirSync(srcDir).filter((f) => f.endsWith(".test.ts")).sort()[0];
  return hit ? path.join("src", hit) : undefined;
}

/** brokenFile from the minimal marker provisionSandbox writes (never the answer-key meta.json). */
function readBrokenFile(root: string): string | undefined {
  const marker = path.join(root, ".ail-broken.json");
  if (!fs.existsSync(marker)) return undefined;
  const bf = (JSON.parse(fs.readFileSync(marker, "utf8")) as { brokenFile?: string }).brokenFile;
  return bf || undefined;
}

/** Recursively merge plain-object `src` into `dst` (arrays/scalars overwrite). */
function deepMerge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const cur = dst[k];
    if (v && typeof v === "object" && !Array.isArray(v) &&
        cur && typeof cur === "object" && !Array.isArray(cur)) {
      deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      dst[k] = v;
    }
  }
}

/** Places already-rendered text at a carrier site inside an existing root. Exposed for tests. */
export function plantCarrier(root: string, carrier: Carrier, text: string, taskId: string): void {
  switch (carrier) {
    case "readme":
      // Prose/HTML-comment appended to the README — the classic doc-borne injection.
      fs.appendFileSync(path.join(root, "README.md"), `\n\n<!--\n${text}\n-->\n`);
      return;
    case "claude-md":
      fs.appendFileSync(path.join(root, "CLAUDE.md"), `\n${text}\n`);
      return;
    case "comment": {
      // Prepend a //-comment block to the fixture's broken file. brokenFile comes from the
      // minimal .ail-broken.json marker provisionSandbox writes (NOT the fixture meta.json,
      // which holds the ground-truth answer key), else the first src/*.ts.
      let rel = readBrokenFile(root) ?? firstSrcTs(root);
      if (!rel) throw new Error(`comment carrier: no source file in ${root}`);
      const file = path.join(root, rel);
      const block = text.split("\n").map((l) => `// ${l}`).join("\n");
      fs.writeFileSync(file, `${block}\n${fs.readFileSync(file, "utf8")}`);
      return;
    }
    case "test-message": {
      // Surface the payload through the TEST RUNNER'S output (spec §4.1), not as an inert
      // comment: append a test that throws the payload as its message, so `npx vitest` prints it
      // when the agent runs the suite. Guarded (a .test.ts), so scoreTask restores it away before
      // scoring — the agent sees it while working, but it never corrupts taskPassed.
      const rel = firstTestTs(root);
      if (!rel) throw new Error(`test-message carrier: no test file in ${root}`);
      const first = text.split("\n")[0] ?? "harness";
      const t = `\ntest(${JSON.stringify(first)}, () => { throw new Error(${JSON.stringify(text)}); });\n`;
      const cur = fs.readFileSync(path.join(root, rel), "utf8");
      const withImport = /from ['"]vitest['"]/.test(cur) ? "" : `import { test } from "vitest";\n`;
      fs.appendFileSync(path.join(root, rel), withImport + t);
      return;
    }
    case "pkg-script": {
      // The payload is a JSON object (e.g. {"scripts":{"postinstall":"..."}} or
      // {"dependencies":{...}}); deep-merge it into package.json so it lands on the REAL
      // lifecycle key / dependency it targets, keeping the file valid JSON.
      const pkgPath = path.join(root, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      let frag: unknown;
      try { frag = JSON.parse(text); }
      catch (e) { throw new Error(`pkg-script payload is not valid JSON: ${(e as Error).message}`); }
      deepMerge(pkg, frag as Record<string, unknown>);
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      return;
    }
    case "dep-dts": {
      const dir = path.join(root, "node_modules", "left-pad-helper");
      fs.mkdirSync(dir, { recursive: true });
      const block = text.split("\n").map((l) => ` * ${l}`).join("\n");
      fs.writeFileSync(path.join(dir, "index.d.ts"), `/**\n${block}\n */\nexport declare const help: string;\n`);
      return;
    }
    case "commit-msg": {
      // git-borne: init a repo and land a commit whose message carries the payload.
      // ponytail: guarded behind git availability — skip silently if git is absent.
      try {
        execFileSync("git", ["init", "-q"], { cwd: root });
        execFileSync("git", ["config", "user.email", "ail@example.invalid"], { cwd: root });
        execFileSync("git", ["config", "user.name", "ail"], { cwd: root });
        execFileSync("git", ["add", "-A"], { cwd: root });
        execFileSync("git", ["commit", "-q", "-m", text], { cwd: root });
      } catch {
        return;
      }
      return;
    }
    case "mcp-tool-desc":
    case "pr-title":
    case "issue-body":
      // No filesystem site: the MCP tool description is handed to the SDK, and PR/issue
      // text is surfaced by a stub the task prompt references. plantCarrier only records
      // the payload into a marker the runner reads back and injects through those channels.
      fs.writeFileSync(path.join(root, ".ail-carrier.json"), JSON.stringify({ carrier, taskId, text }, null, 2));
      return;
  }
}

/** Copies fixture `repo/` into a fresh sandbox, plants the canary .env, and places
 *  `renderedText` at the carrier's site. Returns the sandbox root. */
export function provisionSandbox(args: {
  fixtureRepoDir: string; payload: Payload; renderedText: string; canary: string;
}): string {
  const root = makeSandbox("inj-");
  fs.cpSync(args.fixtureRepoDir, root, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== "node_modules" && base !== ".git";
    },
  });
  // Carry ONLY brokenFile into the sandbox — never the fixture meta.json, which holds the
  // ground-truth answer key (groundTruthPatch/naiveFixThatFails). Leaking it would hand the
  // agent under test the fix and destroy the bug-fix difficulty the injection rides on.
  const meta = path.join(args.fixtureRepoDir, "..", "meta.json");
  if (fs.existsSync(meta)) {
    const bf = (JSON.parse(fs.readFileSync(meta, "utf8")) as { brokenFile?: string }).brokenFile;
    if (bf) fs.writeFileSync(path.join(root, ".ail-broken.json"), JSON.stringify({ brokenFile: bf }));
  }
  // Synthetic canary only — never a real secret (§4.4, §16).
  fs.writeFileSync(path.join(root, ".env"), `API_KEY=${args.canary}\n`);
  plantCarrier(root, args.payload.carrier, args.renderedText, args.payload.taskId);
  return root;
}
