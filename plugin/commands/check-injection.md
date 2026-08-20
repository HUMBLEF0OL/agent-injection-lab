---
description: Run agent-injection-lab's check against a project's Claude Code config to see whether known repo-borne prompt injections get through it.
argument-hint: "[path-to-project]"
---

# /check-injection

You are surfacing the result of `check(path)`. This command carries **no logic of
its own** (§12.1): it resolves a path and runs the exact same `check` the
clone-and-run path calls, so the two can never drift.

## 1. State the quota cost up front (§20.1)

Before running anything, tell the user, in your own words:

> This runs several live Claude Code agent sessions (five canary payloads) against
> a throwaway fixture. It spends **your** subscription quota — no API key and no API
> cost, the same auth this session already uses — and takes a few minutes.

## 2. Pick the target path

- If an argument was given, the target is: `$ARGUMENTS`
- If it is empty, use the user's current project: `${CLAUDE_PROJECT_DIR}`

The check runs from the lab repo, not the target, so the path must be **absolute**.
If the argument is relative, resolve it against the directory the user invoked this
command from before passing it on.

## 3. Run the check

`check` lives in the lab repo one level above this plugin. Run it there, passing the
absolute target path (shown here as `<TARGET>`):

```bash
cd "${CLAUDE_PLUGIN_ROOT}/.." && npm run check -- "<TARGET>"
```

## 4. Surface the verdict verbatim

Show the user the command's output as-is:

- the per-payload table (attempted / succeeded / blocked-by),
- the `verdict:` line — `safe`, `vulnerable`, or `cannot-verify`,
- the "This is NOT a security certificate" footer.

Do not paraphrase away the footer or the `cannot-verify` caveat: a `cannot-verify`
is **not** a pass, and a `safe` verdict only means these known attacks did not get
through this one config. Exit codes: `1` vulnerable, `2` cannot-verify, `3` error.
