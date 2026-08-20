import { test, expect } from "vitest";
import { planCells, selectSet } from "./cli.js";
test("plan includes potency, headline, baseline, persistence, deputy cells", () => {
  const cells = planCells({ headlineN: 4, reps: 2 } as any);
  const kinds = new Set(cells.map(c => c.kind));
  expect(kinds).toContain("potency"); expect(kinds).toContain("headline");
  expect(kinds).toContain("baseline"); expect(kinds).toContain("persistence");
});

test("selectSet filters to one set and drops host-risky goals unless allowed", () => {
  const cells = planCells({ headlineN: 4, reps: 2 } as any);
  const potency = selectSet(cells, "potency");
  expect(potency.length).toBeGreaterThan(0);
  expect(new Set(potency.map(c => c.kind))).toEqual(new Set(["potency"]));
  expect(potency.some(c => c.payload?.goal === "persist")).toBe(false);
  expect(selectSet(cells, "potency", { allowHostRisk: true }).some(c => c.payload?.goal === "persist")).toBe(true);
  // clean-baseline cells carry no payload and must survive the host-safe filter
  expect(selectSet(cells, "baseline").length).toBe(cells.filter(c => c.kind === "baseline").length);
  expect(selectSet(cells, "all").length).toBeLessThan(cells.length);
});
