import { test, expect } from "vitest";
import { ARMS, armSdkOptions } from "./arms.js";

test("seven arms exist with the spec's modes", () => {
  expect(Object.keys(ARMS).sort()).toEqual(
    ["accept-edits","allowlist","bypass","default","deny","gate","hook"]);
  expect(ARMS.bypass.permissionMode).toBe("bypassPermissions");
  expect(ARMS.allowlist.permissionMode).toBe("dontAsk");
  expect(ARMS.gate.gate).toBe("canUseTool");
  expect(ARMS.hook.gate).toBe("hook");
});

test("allowlist permits vitest so the task stays doable", () => {
  expect(ARMS.allowlist.allowedTools).toContain("Bash(npx vitest*)");
});

test("armSdkOptions always pins settingSources to []", () => {
  const o = armSdkOptions(ARMS.default, { sandboxRoot: "/box", sinkHost: "127.0.0.1" });
  expect(o.settingSources).toEqual([]);
});

test("deny arm lists the egress rules", () => {
  expect(ARMS.deny.disallowedTools).toContain("WebFetch");
  expect(ARMS.deny.disallowedTools).toContain("mcp__sink__*");
});
