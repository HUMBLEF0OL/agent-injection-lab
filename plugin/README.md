# agent-injection-lab plugin

A Claude Code plugin exposing `/check-injection [path]` — it tests whether your
project's Claude Code permission configuration stops a set of known
repository-borne prompt injections.

It is a **thin wrapper**: it resolves a path and calls the same `check(path)` the
clone-and-run path (`npm run check -- <path>`) uses, so the plugin and the repo can
never drift (§12.1). No attack logic lives in the plugin.

## What it costs

`/check-injection` runs several live Claude Code agent sessions (five canary
payloads) against a throwaway fixture. It uses **your** Claude Code subscription
auth and spends **your** quota — no API key, no API cost — and takes a few minutes
(§20.1). It never touches your project's files; it only reads your permission
config to reconstruct the arm it measures.

## Install

Requires a local clone of this repo with dependencies installed (`npm install`),
since the plugin shells out to the repo's `check`.

**During development / from the clone**, point Claude Code at the plugin directory:

```bash
claude --plugin-dir /path/to/agent-injection-lab/plugin
```

Then, in the session:

```
/agent-injection-lab:check-injection            # checks the current project
/agent-injection-lab:check-injection /path/to/project
```

**From a marketplace** (once published), add the marketplace and install:

```
/plugin marketplace add <owner>/<repo>
/plugin install agent-injection-lab
```

The command is namespaced by the plugin name, so it appears as
`/agent-injection-lab:check-injection` (the bare `/check-injection` also works when
no other command claims that name).

## This is NOT a security certificate

`check` tests a fixed corpus of known attacks against one configuration. A `safe`
verdict means those known attacks did not get through this config — **not** that
your project is secure. A `cannot-verify` verdict means the config could not be
mapped to a measured arm; it is **not** a pass. Verdicts are bounded to the Claude
Code version they were last validated on. Threat model: `docs/THREAT-MODEL.md`.
