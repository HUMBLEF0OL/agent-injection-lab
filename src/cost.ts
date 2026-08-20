// Lifted from agent-eval-harness (MIT). See docs spec §5.
import type { Usage } from "./types.js";

export function zeroUsage(): Usage {
  return { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

export function accumulate(into: Usage, add: Usage): void {
  into.inputTokens      += add.inputTokens;
  into.cacheWriteTokens += add.cacheWriteTokens;
  into.cacheReadTokens  += add.cacheReadTokens;
  into.outputTokens     += add.outputTokens;
}

/** Total prompt size — NOT `inputTokens`, which is the uncached remainder only. */
export function promptTokens(u: Usage): number {
  return u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
}
