// Deterministic headline-payload selection (spec §11). Pure — no Date.now/random, so the
// headline set is reproducible from the corpus alone and the report can cite exactly which
// 18 payloads it measured.
import type { Payload } from "./corpus/index.js";
import type { Carrier, Goal } from "./types.js";

/** Goals that are NEVER run: they write outside the sandbox or install real packages, and
 *  the `bypass` arm has no enforcement to stop them (§16). There is no flag to enable them.
 *
 *  This is the ONE definition. It used to live in cli.ts, where only the sweep could see it —
 *  so `check` selected straight from the corpus and shipped an `add-dep` payload to every
 *  consumer's machine, while the report claimed these goals were "never executed". Both
 *  selection paths now filter through `hostSafe`. */
export const HOST_RISKY: readonly Goal[] = ["persist", "write-outside", "add-dep", "postinstall"];

/** PURE. True when a payload's goal is safe to run on a developer's own machine (§16). */
export function hostSafe(p: { goal: Goal }): boolean {
  return !HOST_RISKY.includes(p.goal);
}

// The three 2026-trend carriers guaranteed a headline slot (§11).
const TREND: readonly Carrier[] = ["mcp-tool-desc", "pr-title", "issue-body"];

const cmp = (a: Payload, b: Payload): number =>
  a.carrier.localeCompare(b.carrier) || a.goal.localeCompare(b.goal) || a.id.localeCompare(b.id);

/** Pin the trend carriers, guarantee every carrier and every single-session goal (all but
 *  `persist`, which the two-session persistence sweep owns) appears, then round-robin by
 *  carrier to fill `n`. Coverage picks are inserted first, so trimming to `n` keeps them. */
export function selectHeadline(corpus: Payload[], n = 18): Payload[] {
  const sorted = [...corpus].sort(cmp);
  const chosen = new Map<string, Payload>();                 // id -> payload, insertion-ordered
  const add = (p: Payload | undefined): void => { if (p && !chosen.has(p.id)) chosen.set(p.id, p); };

  for (const c of TREND) add(sorted.find((p) => p.carrier === c));          // pin trend carriers
  const carriers = [...new Set(sorted.map((p) => p.carrier))].sort();
  for (const c of carriers) add(sorted.find((p) => p.carrier === c));       // every carrier once
  const goals = [...new Set(sorted.map((p) => p.goal))].filter((g) => g !== "persist").sort();
  for (const g of goals) add(sorted.find((p) => p.goal === g));             // every single-session goal

  const byCarrier = new Map<string, Payload[]>();
  for (const p of sorted) {
    const list = byCarrier.get(p.carrier) ?? [];
    if (list.length === 0) byCarrier.set(p.carrier, list);
    list.push(p);
  }
  for (let progress = true; chosen.size < n && progress;) {
    progress = false;
    for (const c of carriers) {
      if (chosen.size >= n) break;
      const nextP = (byCarrier.get(c) ?? []).find((p) => !chosen.has(p.id));
      if (nextP) { add(nextP); progress = true; }
    }
  }
  return [...chosen.values()].slice(0, n).sort(cmp);
}
