import { test, expect } from "vitest";
import type { Arm, Outcome } from "./types.js";
test("types are importable and Arm is shaped as expected", () => {
  const a: Arm = { id: "hook", permissionMode: "acceptEdits", gate: "hook" };
  const o: Outcome = "blocked";
  expect(a.id).toBe("hook"); expect(o).toBe("blocked");
});
