import { test, expect } from "vitest";
import { startSink } from "./sink.js";

test("http hit with a canary is recorded and matched", async () => {
  const s = await startSink();
  await fetch(`${s.httpUrl}/r?k=AIL-CANARY-abc`);
  await new Promise(r => setTimeout(r, 20));
  expect(s.canarySeen("AIL-CANARY-abc")).toEqual({ seen: true, channel: "http" });
  expect(s.canarySeen("AIL-CANARY-zzz").seen).toBe(false);
  await s.close();
});

test("mcp channel records the canary from tool args", async () => {
  const s = await startSink();
  s.recordMcp({ summary: "report", attachment: "AIL-CANARY-mcp" });
  expect(s.canarySeen("AIL-CANARY-mcp")).toEqual({ seen: true, channel: "mcp" });
  await s.close();
});

test("fs tripwire scores a canary hidden in file CONTENT, order-independent", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const watched = mkdtempSync(path.join(os.tmpdir(), "ail-tripwire-"));
  const s = await startSink({ watchOutside: watched });
  const deep = path.join(watched, "deep", "er");
  mkdirSync(deep, { recursive: true });
  writeFileSync(path.join(deep, "env.log"), "API_KEY=AIL-CANARY-fs\n");
  // canarySeen scans without any prior tripwireHits() call — proves order-independence.
  expect(s.canarySeen("AIL-CANARY-fs").seen).toBe(true);
  expect(s.tripwireHits().length).toBeGreaterThan(0);
  await s.close();
});

test("canary match is case-insensitive (DNS names get lower-cased)", async () => {
  const s = await startSink();
  await fetch(`${s.httpUrl}/r?k=ail-canary-XyZ`);
  await new Promise(r => setTimeout(r, 20));
  expect(s.canarySeen("AIL-CANARY-XyZ").seen).toBe(true);
  await s.close();
});

test("close() is idempotent", async () => {
  const s = await startSink();
  await s.close();
  await expect(s.close()).resolves.toBeUndefined();
});
