// Lifted from the sibling `agent-eval-harness` (scripts/verify-fixtures.mjs, MIT).
// Adapted: sandbox base renamed .aeh-tmp -> .ail-tmp, and the 9xx control-fixture
// branches removed — this lab lifts only the 23 solvable fixtures (spec "Out of
// scope": the sibling's impossible/control tier is not used here).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Inline copy of src/sandbox.ts's makeSandbox/runVitest — a .mjs script cannot
// import the .ts helper. See src/sandbox.ts for the full rationale: sandboxes
// must live on the harness's own drive (not os.tmpdir(), which is C: while
// this repo is on E:), and vitest is always run with --root pointed at the
// sandbox while resolving from the harness's single root install.
const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function makeSandbox(prefix) {
  const base = join(HARNESS_ROOT, ".ail-tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

const VITEST_CLI = join(HARNESS_ROOT, "node_modules", "vitest", "vitest.mjs");

function runVitest(root, timeoutMs) {
  // No shell, for the reasons src/sandbox.ts spells out: with `shell: true` the
  // timeout kills cmd.exe and leaves the real vitest process tree orphaned, and
  // the same 120s timeout below made this script leak them too.
  return spawnSync(process.execPath, [VITEST_CLI, "run", "--root", root, "--reporter=basic"], {
    cwd: HARNESS_ROOT, encoding: "utf8", timeout: timeoutMs,
  });
}

const vitestStatus = (root) => runVitest(root, 120_000).status;

// Mirror of isGuarded in src/score/tamper.ts — same reason as the sandbox
// helpers above: a .mjs script cannot import the .ts source. Kept deliberately
// literal rather than clever so a drift between the two is easy to spot.
const isGuarded = (rel) => {
  const base = rel.split("/").pop();
  return /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(base) || base === "package.json"
    || base.startsWith("vitest.config.") || base.startsWith("vite.config.");
};

function walkRel(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const abs = join(dir, e.name);
    return e.isDirectory() ? walkRel(abs, base) : [relative(base, abs).split(sep).join("/")];
  });
}

let failures = 0;
let naives = 0;
const ids = readdirSync(join(HARNESS_ROOT, "fixtures"));
for (const id of ids) {
  // One broken fixture (bad meta.json, missing fixed/ file, stray non-directory)
  // must not abort the sweep or strand its sandbox — report it and keep going.
  let tmp;
  try {
    const meta = JSON.parse(readFileSync(join(HARNESS_ROOT, "fixtures", id, "meta.json"), "utf8"));

    tmp = makeSandbox("ail-verify-");
    cpSync(join(HARNESS_ROOT, "fixtures", id, "repo"), tmp, { recursive: true });

    const before = vitestStatus(tmp);
    const patched = readFileSync(join(HARNESS_ROOT, "fixtures", id, "fixed", meta.brokenFile), "utf8");
    writeFileSync(join(tmp, meta.brokenFile), patched);
    const after = vitestStatus(tmp);

    const ok = before !== 0 && after === 0;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${id}  before=${before} after=${after}`);

    // The hard tier's whole claim is that the TEMPTING fix breaks a sibling test, so
    // guess-and-check cannot pass it. That claim was prose — "verified by applying
    // that naive fix and observing a red suite" — with no artifact anyone could
    // re-run. naive-fix/ is that artifact: the fix `naiveFixThatFails` describes,
    // applied here, and required to leave the suite RED. It is a directory overlay
    // rather than a single file because the tempting fix is not always in
    // meta.brokenFile (103's is in the CALLER, which is the point of the fixture).
    const naiveDir = join(HARNESS_ROOT, "fixtures", id, "naive-fix");
    const hasNaive = existsSync(naiveDir);
    // Absence is a failure only for the hard tier, which is where the claim lives.
    // Without this, adding a ninth hard fixture would quietly un-verify the README.
    if (meta.difficulty === "hard" && !hasNaive) {
      failures++;
      console.log(`FAIL ${id}  hard fixture has no naive-fix/ — its "tempting fix fails" claim is unverified`);
    }
    if (hasNaive) {
      const guarded = walkRel(naiveDir).filter(isGuarded);
      cpSync(join(HARNESS_ROOT, "fixtures", id, "repo"), tmp, { recursive: true });  // undo the real fix
      cpSync(naiveDir, tmp, { recursive: true });
      const red = vitestStatus(tmp);
      // A naive fix that edited a test would be red for the wrong reason, and a
      // green one means the fixture no longer punishes guess-and-check.
      const naiveOk = red !== 0 && guarded.length === 0;
      if (!naiveOk) failures++; else naives++;
      console.log(`${naiveOk ? "ok  " : "FAIL"} ${id}/naive-fix  red=${red !== 0}` +
        (guarded.length ? `  naive fix touches guarded file(s): ${guarded.join(", ")}`
          : red !== 0 ? "  tempting fix leaves the suite red, no guarded file touched"
            : "  tempting fix PASSES — the fixture does not punish guess-and-check"));
    }
  } catch (e) {
    failures++;
    console.log(`FAIL ${id}  ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

// 24 = the 23 lifted solvable fixtures + 109-history-context, added so the commit-msg carrier
// has a task class that opens git log (docs/AUDIT.md Phase 2, docs/NOTES.md cut-list).
if (ids.length !== 24) {
  console.error(`expected 24 solvable fixtures, found ${ids.length} — the sweep matrix would silently shrink`);
  process.exit(1);
}
if (failures) { console.error(`${failures} fixture(s) invalid`); process.exit(1); }
console.log(`all fixtures fail before and pass after, and all ${naives} documented naive fix(es) leave their suite red`);
