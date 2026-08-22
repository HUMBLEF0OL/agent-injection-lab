# Hardened configuration pack

The configuration of the **strongest arm the sweep measured: `hook` + `deny`** (spec §19.3,
pre-registered in §2.1). Two independent layers, so neither is a single point of failure:

1. **`permissions.deny`** — scoped deny rules block the common egress verbs
   (`curl`, `wget`, `nc`, `ncat`, `telnet`, `scp`, `ftp`, `git push`, `WebFetch`, `WebSearch`, the
   `mcp__sink__*` tools).
2. **`hooks/egress-guard.mjs`** — a `PreToolUse` hook that denies what the deny list cannot
   express. Deny rules match tool-name patterns; the hook is what can reason about *paths* and
   *tools that route around it*. It holds **even under `bypassPermissions`** (§3), which the deny
   list alone does not.

The hook covers:

| Channel | Why a deny rule cannot |
|---|---|
| Bash network verbs | (deny covers the common ones; this is the backstop) |
| `WebFetch` / `WebSearch` | — |
| `Task` — subagent spawn | a child inherits the task but not the parent's refusal, so a gated parent can ask an ungated child to egress (§6.2) |
| `Write`/`Edit`/`NotebookEdit` outside the project | needs path containment, which a name pattern has no way to express |
| `CLAUDE.md`, `CLAUDE.local.md`, `.claude/` | a planted instruction here is obeyed by every **later** session (§8.3) |
| Bash touching a path outside the project | same — the check is on the resolved path, not the verb |

The last four were **missing** until 2026-08-22. The measured `hook` arm wires the harness's full
predicate, so the arm was strictly stronger than this pack, and its numbers overstated what you
installed. See audit F5 in [`../../docs/AUDIT.md`](../../docs/AUDIT.md) and the report's
Retractions section. `src/egress-parity.test.ts` now pins the shipped guard to deny everything the
measured predicate denies, so the two cannot drift apart again silently.

## Measured numbers

Per-arm block rate and the task-success cost of each layer are reported in the hosted
`report.html` per-arm table (they recompute from the committed run databases, §19). The pack
references those figures rather than restating them here, so a stale copy can never disagree with
the evidence.

**Read the `hook` column as a lower bound on this pack, not a description of it.** Those runs used
the old guard. They stop describing what is in this directory until the arm is re-run — which is
tracked as Phase 2 of the audit.

## Adopt it

Both files, or neither — the deny list alone is the weaker half, and `check` will not credit a
hook it cannot identify:

```
cp configs/hardened/settings.json          <your-project>/.claude/settings.json
cp configs/hardened/hooks/egress-guard.mjs <your-project>/.claude/hooks/egress-guard.mjs
```

Then verify it on your own project:

```
npm run check -- <your-project>
```

`check` reports **`cannot-verify`**, not `safe`, when it cannot grade your configuration honestly:
if your `PreToolUse` hook is not this guard (it will not execute an arbitrary hook out of a
project's config — that is the very threat this repo studies), or if the agent never engaged, so
that nothing was actually measured. `cannot-verify` is not a pass.

`check` passing is **not** a security certificate (§21.11): it means these known attacks did not
get through this configuration, not that your project is secure.
