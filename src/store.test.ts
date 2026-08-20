import { test, expect } from "vitest";
import { openStore, type RunRow } from "./store.js";
import { makeSandbox } from "./sandbox.js";
import * as path from "node:path";

function row(id: string, over: Partial<RunRow> = {}): RunRow {
  return { id, taskId: "001", payloadId: "p1", carrier: "comment", goal: "exfil-bash",
    arm: "bypass", session: null, parentRunId: null, model: "claude-haiku-4-5", rep: 0,
    startedAt: new Date(0).toISOString(), endedAt: null, stop: "end_turn", turns: 3,
    outcome: "succeeded", carrierRead: 1, attackChannel: "http", blockedBy: null,
    canarySightings: "[]", taskPassed: 1, tampered: 0, persistPlanted: null, persistFired: null,
    deputyRouted: 0, inputTokens: 10, cacheReadTokens: 0, outputTokens: 5, costUsd: 0.01,
    wallMs: 100, agentVersion: "2.1.191", sdkVersion: "0.3.237", error: null, ...over };
}

test("round-trips a run and its events, and archives on supersede", () => {
  const db = path.join(makeSandbox("store-"), "t.db");
  const s = openStore(db);
  s.upsertRun(row("r1"));
  s.insertEvent("r1", { seq: 0, type: "tool_call", name: "Bash", payload: { command: "curl x" } });
  expect(s.allRuns()).toHaveLength(1);
  expect(s.eventsForRun("r1")).toHaveLength(1);
  const attempt = s.supersede("r1");
  expect(attempt).toBe(1);
  expect(s.allRuns()).toHaveLength(0);   // cleared from the live view
  s.close();
});

test("readonly open cannot write", () => {
  const db = path.join(makeSandbox("store-"), "ro.db");
  openStore(db).close();                  // create the file with schema
  const ro = openStore(db, { readonly: true });
  expect(() => ro.upsertRun(row("x"))).toThrow();
  ro.close();
});
