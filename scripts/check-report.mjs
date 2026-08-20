// Report-reproduction gate (§14 `report`). Regenerates report.html via the real
// report script, diffs against the committed copy byte-for-byte, and restores the
// committed bytes so the working tree is left untouched. Non-zero on drift.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "report.html");
const committed = readFileSync(target);

let regenerated;
try {
  execSync("npm run report", { cwd: root, stdio: "inherit" }); // writes report.html in place
  regenerated = readFileSync(target);
} finally {
  writeFileSync(target, committed); // restore regardless of outcome — no drift left behind
}

if (!committed.equals(regenerated)) {
  console.error("report.html drift — regenerating from the tracked databases does not");
  console.error("reproduce the committed report.html. Re-run `npm run report` and commit.");
  process.exit(1);
}
console.log("report repro ok — regenerated report.html matches the committed copy");
