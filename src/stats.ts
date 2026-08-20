// Lifted from agent-eval-harness (MIT). See docs spec §5.

/**
 * Paired statistics over a sweep.
 *
 * Every comparison this harness publishes is PAIRED BY FIXTURE, and that is the only
 * design that makes n=8 or n=23 worth reporting at all: the fixtures differ from each
 * other far more than the arms differ from each other, so an unpaired test spends all
 * its power on between-fixture variance.
 */

/** Exact binomial tail P(X >= k) for n trials at p = 0.5, in integers.
 *  BigInt rather than a normal approximation: n is 8-23 here, which is exactly the
 *  range where the approximation is worst and where a wrong p-value would be believed. */
export function binomialTailAtLeast(k: number, n: number): number {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0) {
    throw new Error(`binomialTailAtLeast needs non-negative integers, got k=${k}, n=${n}`);
  }
  if (n > 1000) throw new Error(`n=${n} overflows the exact tail; use a normal approximation`);
  if (k > n) return 0;
  let sum = 0n;
  let c = 1n;                                   // C(n, 0)
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c;
    c = (c * BigInt(n - i)) / BigInt(i + 1);     // exact: C(n,i+1) from C(n,i)
  }
  return Number(sum) / Number(2n ** BigInt(n));
}

export interface SignTest {
  /** Pairs where A's value was HIGHER than B's, where it was lower, and where they
   *  tied. Deliberately not a direction word: higher is better for some metrics and
   *  worse for others. Ties are EXCLUDED from the test, which is what the
   *  "n discordant pairs" language means. */
  higher: number; lower: number; ties: number;
  /** P(at least this many on the majority side) under the null that either direction
   *  likely — the direction the effect actually went, not a direction chosen first. */
  oneSided: number;
  /** Two-sided, capped at 1. Report this unless a direction was predicted in advance. */
  twoSided: number;
}

export function signTest(higher: number, lower: number, ties = 0): SignTest {
  const n = higher + lower;
  const oneSided = n === 0 ? 1 : binomialTailAtLeast(Math.max(higher, lower), n);
  return { higher, lower, ties, oneSided, twoSided: Math.min(1, 2 * oneSided) };
}

/** Wilson score interval for a binomial proportion. Returns [lo, hi] in [0,1]. */
export function wilson(successes: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const lo = Math.max(0, (centre - half) / denom), hi = Math.min(1, (centre + half) / denom);
  // At p=0 and p=1 the closed form is exactly 0 and 1; the sqrt loses the last bit
  // (12/12 came back hi=0.9999999999999998). Pin the degenerate endpoints.
  return { lo: successes === 0 ? 0 : lo, hi: successes === n ? 1 : hi };
}
