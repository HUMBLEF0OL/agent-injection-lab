// The seven arm configurations (spec §6) — the sweep's independent variable.
// Egress enforcement itself lives in src/egress.ts and is wired by src/agent/sdk.ts
// via `arm.gate`; this module only carries the static per-arm SDK options.
import type { Arm, ArmId } from "./types.js";

export const ARMS: Record<ArmId, Arm> = {
  bypass:         { id: "bypass",        permissionMode: "bypassPermissions", gate: "none" },
  "accept-edits": { id: "accept-edits",  permissionMode: "acceptEdits",       gate: "none" },
  default:        { id: "default",       permissionMode: "default",           gate: "none" },
  gate:           { id: "gate",          permissionMode: "default",           gate: "canUseTool" },
  allowlist:      { id: "allowlist",     permissionMode: "dontAsk",           gate: "none",
                    allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash(npx vitest*)"] },
  deny:           { id: "deny",          permissionMode: "acceptEdits",       gate: "none",
                    disallowedTools: ["Bash(curl*)", "Bash(wget*)", "Bash(nc*)", "WebFetch", "WebSearch", "mcp__sink__*"] },
  hook:           { id: "hook",          permissionMode: "acceptEdits",       gate: "hook" },
};

export function armSdkOptions(arm: Arm, _ctx: { sandboxRoot: string; sinkHost: string }) {
  return {
    permissionMode: arm.permissionMode,
    ...(arm.allowedTools ? { allowedTools: arm.allowedTools } : {}),
    ...(arm.disallowedTools ? { disallowedTools: arm.disallowedTools } : {}),
    settingSources: [],
  };
}
