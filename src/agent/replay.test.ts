import { test, expect } from "vitest";
import { makeReplayRunner } from "./replay.js";
import type { AgentRunConfig } from "../types.js";

const cfg = {} as AgentRunConfig;

test("replay re-emits recorded events in order and returns the recorded result", async () => {
  const recorded = {
    events: [{ seq: 0, type: "tool_call", name: "Bash", payload: { command: "x" } },
             { seq: 1, type: "tool_result", name: "Bash", payload: "ok" }] as any,
    result: { stop: "end_turn", turns: 1, usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
              costUsdEquivalent: 0, agentVersion: "2.1.191", sdkVersion: "0.3.237" } as any,
  };
  const runner = makeReplayRunner(recorded);
  const seen: number[] = [];
  const res = await runner.run(cfg, e => seen.push(e.seq));
  expect(runner.id).toBe("replay");
  expect(seen).toEqual([0, 1]);
  expect(res.stop).toBe("end_turn");
});
