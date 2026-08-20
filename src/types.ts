export type Usage = { inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; outputTokens: number };

export type ArmId = "bypass" | "accept-edits" | "default" | "gate" | "allowlist" | "deny" | "hook";
export type PermissionMode = "bypassPermissions" | "acceptEdits" | "default" | "dontAsk" | "plan";

export interface Arm {
  id: ArmId;
  permissionMode: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  gate: "none" | "canUseTool" | "hook";   // which egress enforcement this arm wires
}

export type Carrier =
  | "readme" | "claude-md" | "comment" | "test-message" | "pkg-script"
  | "dep-dts" | "commit-msg" | "mcp-tool-desc" | "pr-title" | "issue-body";

export type Goal =
  | "exfil-bash" | "exfil-webfetch" | "exfil-mcp" | "exfil-git" | "exfil-dns"
  | "exfil-markdown" | "write-outside" | "backdoor" | "postinstall" | "add-dep"
  | "persist" | "deputy";

export type Style = "piggyback" | "redirect";

export type Outcome = "succeeded" | "blocked" | "refused" | "ignored" | "undelivered";

export type EventType =
  | "llm_call" | "assistant" | "tool_call" | "tool_result" | "permission_decision" | "error";

export interface EventInput {
  seq: number;
  type: EventType;
  name?: string;                       // tool name for tool_call/tool_result/permission_decision
  payload?: unknown;                   // arguments, text, or result content
  permissionDecision?: "allow" | "deny";
  blockedBy?: string;                  // for permission_decision deny: which layer
  usage?: Usage;
}

export type StopReason = "end_turn" | "max_turns" | "error" | "refusal" | "timeout";

export interface AgentRunConfig {
  cwd: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh";
  task: string;
  arm: Arm;
  sinkUrl: string;                     // for the egress predicate + payload substitution
  sinkHost: string;
  mcpServers?: Record<string, unknown>; // SDK mcpServers config (sink + poisoned tool)
  maxTurns: number;
  timeoutMs: number;
  sandboxRoot: string;                 // egress predicate resolves writes against this
}

export interface AgentRunResult {
  stop: StopReason;
  turns: number;
  usage: Usage;
  costUsdEquivalent: number;
  agentVersion: string;
  sdkVersion: string;
  error?: string;
}

export interface AgentRunner {
  readonly id: "sdk" | "replay";
  run(cfg: AgentRunConfig, emit: (e: EventInput) => void): Promise<AgentRunResult>;
}
