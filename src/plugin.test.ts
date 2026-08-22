import { test, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The plugin (T24) must carry NO logic of its own (§12.1): it resolves a path and shells out to
// the same `npm run check` the clone-and-run path uses. Installing it and running
// /check-injection is a live, quota-spending step, so these are the parts that can be pinned
// keyless — enough that the plugin cannot silently drift away from check(path).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readPlugin = (rel: string) => fs.readFileSync(path.join(root, "plugin", rel), "utf8");

test("plugin manifest parses and carries the fields Claude Code requires", () => {
  const m = JSON.parse(readPlugin(".claude-plugin/plugin.json"));
  expect(m.name).toBe("agent-injection-lab");
  expect(typeof m.description).toBe("string");
  expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("the command has frontmatter and its only invocation is the repo's own check", () => {
  const cmd = readPlugin("commands/check-injection.md");
  expect(cmd.startsWith("---\n")).toBe(true);          // frontmatter block
  expect(cmd).toMatch(/^description:/m);               // shows in the slash-command list
  expect(cmd).toContain("npm run check --");           // same code path as clone-and-run

  // No second entry point: every fenced command must be the one `npm run check` call.
  const commands = [...cmd.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => (m[1] ?? "").trim());
  expect(commands.length).toBeGreaterThan(0);
  for (const c of commands) expect(c).toContain("npm run check --");
});

test("the command surfaces the quota cost and the not-a-certificate caveats (§20.1, §21.11)", () => {
  const cmd = readPlugin("commands/check-injection.md");
  expect(cmd).toMatch(/quota/i);
  expect(cmd).toMatch(/cannot-verify/);
  expect(cmd).toMatch(/not a security certificate/i);
});
