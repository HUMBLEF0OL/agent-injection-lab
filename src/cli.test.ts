import { test, expect } from "vitest";
import { planCells } from "./cli.js";
test("plan includes potency, headline, baseline, persistence, deputy cells", () => {
  const cells = planCells({ headlineN: 4, reps: 2 } as any);
  const kinds = new Set(cells.map(c => c.kind));
  expect(kinds).toContain("potency"); expect(kinds).toContain("headline");
  expect(kinds).toContain("baseline"); expect(kinds).toContain("persistence");
});
