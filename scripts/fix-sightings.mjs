// One-shot evidence repair for the `canary_sightings` column (see src/runner.ts).
//
// The sweep shares ONE sink across every cell, and `sink.sightings()` is cumulative, so rows
// recorded before the runner.ts fix carry every EARLIER cell's sighting too — including the §10
// self-check's own egress. That mis-attributes activity across rows (and grows quadratically).
//
// This applies the same rule the runner now applies at write time: keep only the sightings
// observed at or after that row's own started_at. Deterministic, keyless, and it touches nothing
// else — `outcome` / `attack_channel` were always matched on the row's own canary and are
// untouched. Idempotent: re-running changes nothing.
//
// Run: node scripts/fix-sightings.mjs <db> [<db> ...]
import Database from "better-sqlite3";

const dbs = process.argv.slice(2);
if (dbs.length === 0) { console.error("usage: node scripts/fix-sightings.mjs <db> [<db> ...]"); process.exit(2); }

for (const file of dbs) {
  const db = new Database(file);
  const rows = db.prepare("SELECT id, started_at, canary_sightings FROM runs").all();
  const update = db.prepare("UPDATE runs SET canary_sightings = ? WHERE id = ?");
  let changed = 0, dropped = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      let list;
      try { list = JSON.parse(r.canary_sightings ?? "[]"); } catch { continue; }
      if (!Array.isArray(list)) continue;
      const kept = list.filter((s) => typeof s?.at === "string" && s.at >= r.started_at);
      if (kept.length === list.length) continue;
      dropped += list.length - kept.length;
      changed++;
      update.run(JSON.stringify(kept), r.id);
    }
  });
  tx();
  console.log(`${file}: ${rows.length} rows, ${changed} rewritten, ${dropped} foreign sighting(s) dropped`);
  db.close();
}
