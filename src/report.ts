// The report (§13): report.html, regenerated from tracked databases and served on
// GitHub Pages. Check-first — it opens with the safeguard (the `check` command and the
// config pack), then the evidence. Everything rendered is deterministic so the `report`
// gate (§14) can diff the regenerated file byte-for-byte: no Date.now, no Math.random in
// the output, bootstrapCI is seeded.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openStore, type RunRow, type StoreIntegrity } from "./store.js";
import { computeFigures, type Figures, type ArmFigure } from "./evidence.js";
import { HARNESS_ROOT } from "./sandbox.js";

// bootstrapCI + mulberry32 lifted from the sibling agent-eval-harness src/report.ts
// (MIT). Seeded so a report regenerated from the same DB is byte-identical.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapCI(values: number[], resamples = 2000, seed = 42): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 0, hi: 0 };
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rand() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return { lo: means[Math.floor(0.025 * resamples)]!, hi: means[Math.floor(0.975 * resamples)]! };
}

export interface Retraction { date: string; text: string }

/** What renderReport reads. The script path passes real Figures plus the version banner,
 *  the merged integrity counters, and any retractions; the fields beyond Figures are
 *  optional so a caller with only figures still renders. */
export type ReportInput = Figures & {
  version?: string;
  integrity?: StoreIntegrity;
  retractions?: Retraction[];
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Fixed one-decimal percent — no locale, no float drift, so the output is byte-stable.
const pct = (x: number): string => (Math.round(x * 1000) / 10).toFixed(1) + "%";
const ci = (c?: { lo: number; hi: number }): string =>
  c ? `[${pct(c.lo)}, ${pct(c.hi)}]` : "—";

function dualAxisChart(arms: ArmFigure[], taskByArm: Map<string, number>): string {
  // Grouped bars per arm on one 0–100% axis: attack success (red) beside task success
  // (green). "Dual-axis" in the sense of two measured axes on shared scale (§13).
  const W = 720, H = 320, padL = 44, padB = 64, padT = 16, padR = 12;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = Math.max(arms.length, 1);
  const group = plotW / n, barW = Math.min(28, group / 3);
  const y = (v: number): number => padT + plotH * (1 - v);
  const parts: string[] = [];
  for (let g = 0; g <= 5; g++) {
    const v = g / 5, yy = y(v);
    parts.push(`<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="grid"/>`);
    parts.push(`<text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" class="ytick">${(v * 100).toFixed(0)}%</text>`);
  }
  arms.forEach((a, i) => {
    const cx = padL + group * i + group / 2;
    const atk = a.successRate, task = taskByArm.get(a.arm) ?? 0;
    const x1 = cx - barW - 2, x2 = cx + 2;
    parts.push(`<rect x="${x1.toFixed(1)}" y="${y(atk).toFixed(1)}" width="${barW.toFixed(1)}" height="${(y(0) - y(atk)).toFixed(1)}" class="atk"><title>${esc(a.arm)} attack success ${pct(atk)}</title></rect>`);
    parts.push(`<rect x="${x2.toFixed(1)}" y="${y(task).toFixed(1)}" width="${barW.toFixed(1)}" height="${(y(0) - y(task)).toFixed(1)}" class="task"><title>${esc(a.arm)} task success ${pct(task)}</title></rect>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${H - padB + 16}" class="xtick">${esc(a.arm)}</text>`);
  });
  parts.push(`<line x1="${padL}" y1="${y(0).toFixed(1)}" x2="${W - padR}" y2="${y(0).toFixed(1)}" class="axis"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Attack success vs task success per arm">${parts.join("")}</svg>`;
}

export function renderReport(figures: ReportInput): string {
  const arms = figures.arms ?? [];
  const carrierArm = figures.carrierArm ?? [];
  const taskDeltas = figures.taskDeltas ?? [];
  const taskByArm = new Map(taskDeltas.map((t) => [t.arm, t.injectedPassRate]));
  const version = figures.version ?? "unversioned";

  // Headline: the worst-case arm (highest attack success) with its Wilson interval, and
  // the mean task-success drop under injection with a seeded bootstrap interval.
  const worst = [...arms].sort((a, b) => b.successRate - a.successRate)[0];
  const drops = taskDeltas.map((t) => t.delta);
  const dropCI = bootstrapCI(drops);
  const meanDrop = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : 0;

  const armRows = arms.map((a) => `<tr>
    <td>${esc(a.arm)}</td>
    <td class="num">${a.attempted}</td>
    <td class="num">${a.succeeded}</td>
    <td class="num">${a.blocked}</td>
    <td class="num">${pct(a.successRate)}</td>
    <td class="ci">${ci(a.successRateCI)}</td>
    <td class="num">${pct(a.blockRate)}</td>
    <td class="ci">${ci(a.blockRateCI)}</td>
  </tr>`).join("\n");

  const gridRows = carrierArm.map((c) => `<tr>
    <td>${esc(c.carrier || "—")}</td>
    <td>${esc(c.arm)}</td>
    <td class="num">${c.attempted}</td>
    <td class="num">${c.succeeded}</td>
    <td class="num">${c.blocked}</td>
    <td class="num">${pct(c.blockRate)}</td>
  </tr>`).join("\n") || `<tr><td colspan="6" class="empty">No injected-carrier attempts recorded.</td></tr>`;

  const ig = figures.integrity;
  const integrityPanel = ig
    ? `<ul class="integrity">
        <li>Commingled (run_id, seq) groups: <b>${ig.duplicateSeqGroups}</b></li>
        <li>Runs without a trajectory: <b>${ig.runsWithoutEvents}</b></li>
        <li>Orphan event streams: <b>${ig.orphanEventRuns}</b></li>
        <li>Supersede archive present: <b>${ig.archiveTablesPresent ? "yes" : "no"}</b></li>
      </ul>`
    : `<p class="empty">Integrity counters unavailable (no store opened).</p>`;

  const retractions = figures.retractions ?? [];
  const retractionBlock = retractions.length
    ? `<ul>${retractions.map((r) => `<li><time>${esc(r.date)}</time> — ${esc(r.text)}</li>`).join("")}</ul>`
    : `<p class="empty">None. No published figure has been corrected or withdrawn.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-injection-lab — report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; }
  h1 { margin-bottom: 4px; }
  h2 { margin-top: 36px; border-bottom: 1px solid #8884; padding-bottom: 4px; }
  .safeguard { background: #2b7a2b18; border: 1px solid #2b7a2b55; border-radius: 8px; padding: 16px; }
  .safeguard code { background: #8882; padding: 1px 5px; border-radius: 4px; }
  .headline { font-size: 17px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 14px; }
  th, td { border: 1px solid #8884; padding: 4px 8px; text-align: left; }
  td.num, td.ci { text-align: right; font-variant-numeric: tabular-nums; }
  td.ci { color: #888; }
  td.empty, .empty { color: #888; font-style: italic; }
  svg { width: 100%; height: auto; margin-top: 8px; }
  svg .grid { stroke: #8883; } svg .axis { stroke: #888; }
  svg .atk { fill: #d24b4b; } svg .task { fill: #3a9a4a; }
  svg .ytick { fill: #888; font-size: 11px; text-anchor: end; }
  svg .xtick { fill: #888; font-size: 11px; text-anchor: middle; }
  .legend span { display: inline-block; margin-right: 16px; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
  .banner { color: #888; font-size: 13px; margin-top: 40px; border-top: 1px solid #8884; padding-top: 8px; }
</style>
</head>
<body>
<h1>agent-injection-lab</h1>

<div class="safeguard">
  <p><b>Check your own project first.</b> This is a defensive tool. Run
  <code>npx agent-injection-lab check &lt;path&gt;</code> to find out whether your Claude Code
  configuration actually stops a repository-borne prompt injection, and adopt the hardened
  config pack as a proven defense. The measurement study below is the evidence base for the
  verdicts <code>check</code> returns — the safeguard is the product; the numbers are why you
  can trust it.</p>
</div>

<h2>Headline</h2>
<p class="headline">${worst
    ? `Worst-case arm <b>${esc(worst.arm)}</b>: attack success <b>${pct(worst.successRate)}</b>
       (Wilson 95% ${ci(worst.successRateCI)}, n=${worst.attempted} attempted).`
    : `No arm figures recorded yet.`}
   Mean task-success change under injection: <b>${pct(meanDrop)}</b>
   (seeded bootstrap 95% [${pct(dropCI.lo)}, ${pct(dropCI.hi)}]).</p>

<h2>Attack vs task success per arm</h2>
<p class="legend"><span><i style="background:#d24b4b"></i>attack success rate</span><span><i style="background:#3a9a4a"></i>task success rate (injected)</span></p>
${dualAxisChart(arms, taskByArm)}

<h2>Per-arm: attempts beside successes</h2>
<p class="empty">Efficacy is conditioned on <b>attempted</b> runs (§8): refused and ignored are
never counted as a defense win, so the attempt count sits beside every success rate.</p>
<table>
  <thead><tr>
    <th>arm</th><th>attempted</th><th>succeeded</th><th>blocked</th>
    <th>success</th><th>Wilson 95%</th><th>block</th><th>Wilson 95%</th>
  </tr></thead>
  <tbody>
${armRows || `<tr><td colspan="8" class="empty">No arm figures.</td></tr>`}
  </tbody>
</table>

<h2>Per-carrier × per-arm grid</h2>
<p class="empty">Which content surfaces beat which permission layers.</p>
<table>
  <thead><tr><th>carrier</th><th>arm</th><th>attempted</th><th>succeeded</th><th>blocked</th><th>block rate</th></tr></thead>
  <tbody>
${gridRows}
  </tbody>
</table>

<h2>Integrity</h2>
${integrityPanel}

<h2>Retractions</h2>
${retractionBlock}

<p class="banner">agent under test / SDK: <b>${esc(version)}</b>.
Regenerated deterministically from tracked databases; no key, no network.
Wilson intervals from stats.ts; task-delta interval from a seeded bootstrap.</p>
</body>
</html>
`;
}

// ── CLI: regenerate report.html from the tracked databases ──────────────────
function trackedDbs(root: string): string[] {
  return fs.readdirSync(root).filter((f) => f.endsWith(".db")).map((f) => path.join(root, f)).sort();
}

function mergeIntegrity(dbs: string[]): { integrity: StoreIntegrity; version: string } {
  let acc: StoreIntegrity = { duplicateSeqGroups: 0, runsWithoutEvents: 0, orphanEventRuns: 0, archiveTablesPresent: true };
  let runs: RunRow[] = [];
  for (const p of dbs) {
    const s = openStore(p, { readonly: true });   // §9: readers never write a byte
    const i = s.integrity();
    acc = {
      duplicateSeqGroups: acc.duplicateSeqGroups + i.duplicateSeqGroups,
      runsWithoutEvents: acc.runsWithoutEvents + i.runsWithoutEvents,
      orphanEventRuns: acc.orphanEventRuns + i.orphanEventRuns,
      archiveTablesPresent: acc.archiveTablesPresent && i.archiveTablesPresent,
    };
    runs = runs.concat(s.allRuns());
    s.close();
  }
  const first = runs.find((r) => r.agentVersion || r.sdkVersion);
  const version = first ? `${first.agentVersion ?? "?"} / sdk ${first.sdkVersion ?? "?"}` : "unversioned";
  return { integrity: acc, version };
}

function main(): void {
  const root = HARNESS_ROOT;
  const dbs = trackedDbs(root);
  const figures: Figures = dbs.length
    ? computeFigures(dbs)
    : { arms: [], carrierArm: [], taskDeltas: [], persistPlanted: 0, persistFired: 0, deputy: [] };
  const extra = dbs.length ? mergeIntegrity(dbs) : { integrity: undefined, version: "unversioned" };
  const html = renderReport({ ...figures, ...extra });
  const out = path.join(root, "report.html");
  fs.writeFileSync(out, html);
  console.log(`wrote ${path.relative(root, out)} from ${dbs.length} database(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
