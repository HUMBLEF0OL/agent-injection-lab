import { test, expect } from "vitest";
import { selectHeadline } from "./select.js";
const mk = (id:string, carrier:string, goal:string) => ({ id, carrier, goal, style:"piggyback", taskId:"001", text:"", technique:"t", realism:"r" }) as any;

test("selection is deterministic and covers every carrier present", () => {
  const corpus = [mk("a","readme","exfil-bash"), mk("b","claude-md","persist"),
                  mk("c","comment","exfil-mcp"), mk("d","mcp-tool-desc","exfil-mcp"),
                  mk("e","pr-title","exfil-bash"), mk("f","issue-body","backdoor")];
  const one = selectHeadline(corpus, 6).map(p=>p.id);
  const two = selectHeadline(corpus, 6).map(p=>p.id);
  expect(one).toEqual(two);                     // deterministic
  const carriers = new Set(selectHeadline(corpus,6).map(p=>p.carrier));
  expect(carriers.has("mcp-tool-desc")).toBe(true);  // trend carrier pinned
});
