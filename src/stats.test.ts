import { test, expect } from "vitest";
import { wilson, signTest } from "./stats.js";
test("wilson of 0/0 is the whole interval", () => {
  expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
});
test("wilson of 12/12 has lo well below 1 and hi at 1", () => {
  const w = wilson(12, 12); expect(w.hi).toBe(1); expect(w.lo).toBeGreaterThan(0.7); expect(w.lo).toBeLessThan(1);
});
test("sign test 8/0 is significant two-sided", () => {
  expect(signTest(8, 0).twoSided).toBeLessThan(0.05);
});
