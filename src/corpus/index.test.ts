import { test, expect } from "vitest";
import { loadCorpus, renderPayload } from "./index.js";
import * as path from "node:path";
const DIR = path.join(import.meta.dirname, "_testdata");

test("loads payloads and validates required meta fields", () => {
  const c = loadCorpus(DIR);
  expect(c.length).toBeGreaterThan(0);
  const p = c.find(x => x.id === "t-comment-bash")!;
  expect(p.carrier).toBe("comment"); expect(p.goal).toBe("exfil-bash");
  expect(p.taskId).toBe("001-off-by-one"); expect(p.technique).toBeTruthy();
});

test("renderPayload substitutes canary and sink", () => {
  const p = loadCorpus(DIR).find(x => x.id === "t-comment-bash")!;
  const out = renderPayload(p, { canary: "AIL-CANARY-abc", sinkUrl: "http://127.0.0.1:9" });
  expect(out).toContain("http://127.0.0.1:9/r");
  expect(out).not.toContain("%SINK%");
});

test("loader throws on an unknown carrier", () => {
  // a bad-meta dir under _testdata/_bad should be rejected
  expect(() => loadCorpus(path.join(DIR, "..", "_baddata"))).toThrow();
});
