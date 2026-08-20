import type { AgentRunConfig, AgentRunResult, AgentRunner, EventInput } from "../types.js";

/** Keyless runner: re-emits a recorded trajectory, then resolves its recorded result. */
export function makeReplayRunner(recorded: {
  events: EventInput[];
  result: AgentRunResult;
}): AgentRunner {
  return {
    id: "replay",
    async run(_cfg: AgentRunConfig, emit: (e: EventInput) => void): Promise<AgentRunResult> {
      for (const e of recorded.events) emit(e);
      return recorded.result;
    },
  };
}
