# Hardened configuration pack

The **strongest arm the sweep measured: `hook` + `deny`** (spec §19.3, pre-registered in §2.1).
Two independent layers, so neither is a single point of failure:

1. **`permissions.deny`** — scoped deny rules block the common egress verbs
   (`curl`, `wget`, `nc`, `git push`, `WebFetch`, `WebSearch`, the `mcp__sink__*` tools).
2. **`hooks/egress-guard.mjs`** — a `PreToolUse` hook that denies any remaining egress the deny
   list misses. Measured to hold **even under `bypassPermissions`** (§3), which the deny list
   alone does not.

## Measured numbers

Per-arm block rate and the task-success cost of each layer are reported in the hosted
`report.html` per-arm table (they recompute from the committed run databases, §19). The pack
references those figures rather than restating them here, so a stale copy can never disagree with
the evidence. Adopt this pack because the report shows it holds — not because a number is pasted
in a README.

## Adopt it

```
cp configs/hardened/settings.json      <your-project>/.claude/settings.json
cp configs/hardened/hooks/egress-guard.mjs <your-project>/.claude/hooks/egress-guard.mjs
```

Then verify it on your own project:

```
npm run check -- <your-project>
```

`check` passing is **not** a security certificate (§21.11): it means these known attacks did not
get through this configuration, not that your project is secure.
