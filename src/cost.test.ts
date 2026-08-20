import { test, expect } from "vitest";
import { zeroUsage, accumulate } from "./cost.js";
test("accumulate sums fields", () => {
  const a = zeroUsage(); accumulate(a, { inputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 3 });
  expect(a.inputTokens).toBe(5); expect(a.outputTokens).toBe(3);
});
