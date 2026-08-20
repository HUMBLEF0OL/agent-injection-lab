import { test, expect } from "vitest";
import { diffHashes } from "./tamper.js";
test("diff detects a changed file", () => {
  const before = new Map([["a.test.ts", "h1"]]);
  const after = new Map([["a.test.ts", "h2"]]);
  expect(diffHashes(before, after).tampered).toBe(true);
});
test("diff detects a deleted file via key union", () => {
  expect(diffHashes(new Map([["x.test.ts", "h"]]), new Map()).tampered).toBe(true);
});
