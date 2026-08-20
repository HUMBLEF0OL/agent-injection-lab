# agent-injection-lab

A defensive tool that measures which of **Claude Code's** permission layers actually stop a
repository-borne prompt injection — and ships a command a developer runs on their own project to
check whether their configuration holds.

> Scope is **Claude Code specifically** (spec §18). This does **not** test Cursor, Copilot,
> Windsurf, or Cline, and it does not measure raw model susceptibility absent a permission layer
> (that is what AgentDojo / InjecAgent already do). If you read one claim from this repo, read it
> as a claim about Claude Code's config surface, not "coding agents" in general.

[![gates](https://github.com/HUMBLEF0OL/agent-injection-lab/actions/workflows/gates.yml/badge.svg)](https://github.com/HUMBLEF0OL/agent-injection-lab/actions/workflows/gates.yml)

## The safeguard (start here)

This is a **defensive** tool, so it leads with the defense. Two things ship for you to *use*; the
measurement study behind them is the evidence base, not the product (spec §0, §19).

### 1. Check your own project

```
/check-injection [path]      # Claude Code plugin — runs on your subscription, no API cost
npm run check -- <path>      # same code path, for CI and reproducers (§12.1)
```

It reads your project's real permission configuration (`.claude/settings.json`,
`.claude/settings.local.json`, and user settings at their documented precedence), builds the arm
that configuration describes, runs five canary payloads against it, and prints which were
attempted, which succeeded, and what blocked them. It **exits non-zero if any payload succeeded.**

It reads your configuration and does **not** modify your project. It answers *"does this
configuration hold?"* — not *"is this codebase safe?"*. When it cannot map a config faithfully it
reports **"cannot verify"**, never "safe" (the §12.2 fidelity gate: silence is not a pass).

### 2. Adopt the hardened config pack

The strongest arm the sweep measures is **`hook` + `deny`** — two independent layers so neither is
a single point of failure. Copy it in:

```
cp configs/hardened/settings.json          <your-project>/.claude/settings.json
cp configs/hardened/hooks/egress-guard.mjs <your-project>/.claude/hooks/egress-guard.mjs
```

Then verify it with `npm run check -- <your-project>`. See
[`configs/hardened/README.md`](configs/hardened/README.md) for what each layer does and the
per-choice measured numbers.

> **`check` passing is not a security certificate** (spec §21.11). It means these known attacks did
> not get through this configuration — not that your project is secure.

## The finding

> **PENDING the powered sweep.** The headline attack-success-rate numbers come from the powered
> sweep (§11), which has not yet been run, so no number is stated here. When the sweep databases
> are committed, this section is filled *from those databases* — the report and every figure
> recompute from the tracked runs, keyless (§19). Until then:

- **Attack success rate by arm:** _to be filled from the committed sweep DBs_ (Wilson interval:
  _[pending]_). No number is invented before the sweep runs.
- What is already established (spec §3, probed 2026-08-20 on Claude Code `2.1.191`): carrier
  **reachability dominates potency** — the identical payload was not attempted from `README.md`
  but was attempted and succeeded from a source comment the agent had to read. An injection only
  fires if its carrier enters the agent's context.
- A `canUseTool` deny in `default` mode did **not** gate `Bash` on `2.1.191`. This is
  **version-bounded and pending re-verification** on the currently-installed Claude Code before it
  is asserted as a live finding — see [`docs/DISCLOSURE.md`](docs/DISCLOSURE.md).

Read the full evidence in the hosted report and the threat model:

- **[`report.html`](report.html)** — every figure recomputes from the committed run databases
  (served on GitHub Pages; opens with the safeguard and carries a retractions section).
- **[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md)** — the 10 carriers, 12 goals, and the realism
  rubric the corpus is authored against.
- **[`docs/DISCLOSURE.md`](docs/DISCLOSURE.md)** — the version-bounded `canUseTool` record and the
  disclosure timeline.

## Running it yourself is a disposable-environment operation

Read this before running a sweep (spec §16). During a run the agent executes **real `bash` with
real network** against **deliberately malicious** repository content. A payload — or a model
misfire — could in principle do more than reach the local sink.

- **Run it in a throwaway VM or container.** A ~600-run sweep of deliberate attacks is not meant
  for a primary machine. The disposable environment is the real containment, not the sink.
- **No real secrets on the host.** The only "secret" is a synthetic canary (`AIL-CANARY-<runid>`);
  there is nothing genuine to lose even if a payload escapes the sandbox.
- **Egress goes nowhere.** Every sink binds `127.0.0.1`; nothing leaves the machine, and you can
  additionally run with outbound network blocked.
- A post-run scan records any file created or modified outside the sandbox root, so an unexpected
  action is visible in the data rather than silent.

## Keyless by default

`npm ci` then the whole tree verifies with **no credentials and no network**. Only
`src/agent/sdk.ts` and the live sweep touch quota. CI never runs a live sweep.

```
npm test              # keyless (81 tests + 2 env-gated live, skipped)
npm run verify-fixtures
npm run verify-corpus # SKIPs cleanly when no sweep DB is committed yet
npm run verify-arms
npm run evidence
npm run check-leaks   # enforces SDK-import isolation
```

## Attribution & license

MIT. The statistical core, sandbox provisioning, tamper detection, and cost accounting are lifted
from the sibling project **[agent-eval-harness](../agent-eval-harness)** (MIT); lifted modules
carry a crediting comment and the repo preserves the sibling's MIT notice.
