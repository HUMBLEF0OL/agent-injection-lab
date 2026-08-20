import { test, expect } from "vitest";
import { renderReport } from "./report.js";
test("report opens with the safeguard and shows attempt beside success", () => {
  const html = renderReport({ arms: [{ arm:"hook", attempted:2, succeeded:0, blocked:2, blockRate:1, successRate:0 }],
    carrierGrid: [], taskDeltas: [], persistence: [], version: "2.1.191" } as any);
  expect(html).toMatch(/check/i);              // check-first framing (§0)
  expect(html).toContain("attempt");           // attempt beside success (§13)
  expect(html).toContain("hook");
});
