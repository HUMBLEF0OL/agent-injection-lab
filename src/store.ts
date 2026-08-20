// Adapted from the sibling `agent-eval-harness` (MIT) — src/store.ts. The WAL setup,
// the transactional SCHEMA exec, the UNIQUE(run_id, seq) index, the read-only guard,
// the supersede transaction and integrity() are its work; the column set is this
// project's (§9: attack, persistence and version columns).
import Database from "better-sqlite3";
import type { EventInput } from "./types.js";

export interface RunRow {
  id: string; taskId: string; payloadId: string | null;
  carrier: string | null; goal: string | null; arm: string;
  session: "A" | "B" | null; parentRunId: string | null;
  model: string; rep: number; startedAt: string; endedAt: string | null;
  stop: string | null; turns: number | null;
  outcome: string | null; carrierRead: number | null; egressAttempted: number | null;
  attackChannel: string | null; blockedBy: string | null; canarySightings: string | null;
  taskPassed: number | null; tampered: number | null;
  persistPlanted: number | null; persistFired: number | null; deputyRouted: number | null;
  inputTokens: number; cacheReadTokens: number; outputTokens: number;
  costUsd: number; wallMs: number; agentVersion: string | null; sdkVersion: string | null;
  error: string | null;
}

export interface StoredEvent {
  seq: number; type: string; name: string | null; payload: string | null;
  permissionDecision: string | null; blockedBy: string | null;
  inTok: number | null; cwTok: number | null; crTok: number | null; outTok: number | null;
  ts: string;
}

// NOT NULL mirrors RunRow's non-nullable fields: for a tracked evidence database the
// schema is the last line of defence behind the TypeScript types. superseded_runs shares
// this string and is fed by copies out of runs, so it satisfies the same constraints.
const RUN_COLUMNS = `
  id TEXT NOT NULL, task_id TEXT NOT NULL, payload_id TEXT, carrier TEXT, goal TEXT,
  arm TEXT NOT NULL, session TEXT, parent_run_id TEXT, model TEXT NOT NULL,
  rep INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, stop TEXT, turns INTEGER,
  outcome TEXT, carrier_read INTEGER, egress_attempted INTEGER, attack_channel TEXT, blocked_by TEXT,
  canary_sightings TEXT, task_passed INTEGER, tampered INTEGER,
  persist_planted INTEGER, persist_fired INTEGER, deputy_routed INTEGER,
  input_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, wall_ms INTEGER NOT NULL,
  agent_version TEXT, sdk_version TEXT, error TEXT`;

const EVENT_COLUMNS = `
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, name TEXT, payload TEXT,
  permission_decision TEXT, blocked_by TEXT,
  in_tok INTEGER, cw_tok INTEGER, cr_tok INTEGER, out_tok INTEGER, ts TEXT NOT NULL`;

// superseded_runs/superseded_events mirror runs/events column-for-column with an
// `attempt` prepended, which is what lets supersede() archive with
// `INSERT INTO superseded_x SELECT ?, * FROM x` instead of restating every column.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (${RUN_COLUMNS}, PRIMARY KEY (id));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ${EVENT_COLUMNS});
CREATE TABLE IF NOT EXISTS superseded_runs (attempt INTEGER NOT NULL, ${RUN_COLUMNS});
CREATE TABLE IF NOT EXISTS superseded_events (
  attempt INTEGER NOT NULL, id INTEGER, ${EVENT_COLUMNS});
-- UNIQUE, not merely indexed: the sibling shipped three trajectories holding events
-- from TWO executions under one run_id because two sweep processes wrote the same
-- database at once and nothing in the schema objected. Now the second writer fails on
-- its first colliding seq instead of silently interleaving.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique ON events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_runs_arm ON runs(arm, task_id);
CREATE INDEX IF NOT EXISTS idx_superseded_events_run ON superseded_events(run_id, attempt, seq);
`;

const RUN_SELECT = `
    id, task_id AS taskId, payload_id AS payloadId, carrier, goal, arm, session,
    parent_run_id AS parentRunId, model, rep, started_at AS startedAt, ended_at AS endedAt,
    stop, turns, outcome, carrier_read AS carrierRead, egress_attempted AS egressAttempted,
    attack_channel AS attackChannel,
    blocked_by AS blockedBy, canary_sightings AS canarySightings, task_passed AS taskPassed,
    tampered, persist_planted AS persistPlanted, persist_fired AS persistFired,
    deputy_routed AS deputyRouted, input_tokens AS inputTokens,
    cache_read_tokens AS cacheReadTokens, output_tokens AS outputTokens,
    cost_usd AS costUsd, wall_ms AS wallMs, agent_version AS agentVersion,
    sdk_version AS sdkVersion, error`;

const EVENT_SELECT = `
    seq, type, name, payload, permission_decision AS permissionDecision,
    blocked_by AS blockedBy, in_tok AS inTok, cw_tok AS cwTok, cr_tok AS crTok,
    out_tok AS outTok, ts`;

export interface StoreIntegrity {
  /** (run_id, seq) pairs holding more than one event: two executions commingled under
   *  one run id. Structurally impossible under the UNIQUE index above, so this is a
   *  measured number for databases that predate it rather than an assumption. */
  duplicateSeqGroups: number;
  /** Run rows with no trajectory at all. The event TOTAL can reconcile while an
   *  individual run's stream has gone. */
  runsWithoutEvents: number;
  /** Distinct run_ids in events with no matching run row. */
  orphanEventRuns: number;
  /** False for a database written before the archive tables existed. There "zero
   *  superseded attempts" is the absence of a place to record them, not a fact about
   *  re-runs, and the evidence gate must not report the two alike. */
  archiveTablesPresent: boolean;
}

export interface StoreOptions {
  /** Opens without creating, without setting a journal mode, and without running
   *  SCHEMA. Published sweep databases are TRACKED EVIDENCE and all three of those
   *  write to the file (§9). Readers must not be able to change a byte. */
  readonly?: boolean;
}

export interface Store {
  upsertRun(r: RunRow): void;
  insertEvent(runId: string, e: EventInput): void;
  /** Archives a cell's current row and trajectory into the superseded_* tables, then
   *  removes BOTH from the live view, so an in-flight re-run looks exactly like a cell
   *  that has not run yet instead of pairing old metrics with a partial new stream.
   *  Returns the attempt number written, or 0 when there was nothing to archive. */
  supersede(runId: string): number;
  allRuns(): RunRow[];
  eventsForRun(runId: string): StoredEvent[];
  /** Structural facts about the stored corpus, for the evidence gate. Counting runs
   *  and summing costs cannot see any of these. */
  integrity(): StoreIntegrity;
  close(): void;
}

export function openStore(dbPath: string, opts: StoreOptions = {}): Store {
  const db = new Database(dbPath, { readonly: opts.readonly === true });
  if (!opts.readonly) {
    db.pragma("journal_mode = WAL");   // concurrent sweep writers
    try {
      // In a transaction: db.exec runs the statements one at a time, so a database that
      // fails on the UNIQUE index below would otherwise KEEP the tables created before
      // it — the open is refused and the file has still been changed.
      db.transaction(() => db.exec(SCHEMA))();
    } catch (e) {
      db.close();
      if (/UNIQUE constraint failed: events/.test((e as Error).message)) {
        throw new Error(
          `${dbPath} already holds two executions under one run id — it has duplicate ` +
          `(run_id, seq) events, so the UNIQUE index this schema requires cannot be built. ` +
          `That database is evidence of an interleaved write and must not be written to ` +
          `again; open it read-only, or sweep into a new file. ` +
          `Original: ${(e as Error).message}`);
      }
      throw e;
    }
  }

  /** A database written before superseded_* existed has no such table, and it is read
   *  rather than migrated — a query against it must return empty, not throw at prepare
   *  time. */
  const hasTable = (name: string) => db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;

  const ins = db.prepare(`INSERT OR REPLACE INTO runs VALUES (
    @id,@taskId,@payloadId,@carrier,@goal,@arm,@session,@parentRunId,@model,@rep,
    @startedAt,@endedAt,@stop,@turns,@outcome,@carrierRead,@egressAttempted,@attackChannel,@blockedBy,
    @canarySightings,@taskPassed,@tampered,@persistPlanted,@persistFired,@deputyRouted,
    @inputTokens,@cacheReadTokens,@outputTokens,@costUsd,@wallMs,@agentVersion,
    @sdkVersion,@error)`);

  const insEv = db.prepare(`INSERT INTO events
    (run_id,seq,type,name,payload,permission_decision,blocked_by,
     in_tok,cw_tok,cr_tok,out_tok,ts)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  const selRuns = db.prepare(`SELECT ${RUN_SELECT} FROM runs`);
  // ORDER BY id, not seq: for a stream written by one execution the two are identical,
  // and where a stream is commingled `ORDER BY seq` interleaves two executions with
  // ties broken arbitrarily. Insertion order is always well-defined, and a seq that
  // goes BACKWARDS in it marks the boundary between executions.
  const selEvents = db.prepare(`SELECT ${EVENT_SELECT} FROM events WHERE run_id = ? ORDER BY id`);

  const supersede = opts.readonly ? undefined : db.transaction((runId: string): number => {
    const attempt = (db.prepare(
      `SELECT COALESCE(MAX(attempt), 0) + 1 AS n FROM superseded_runs WHERE id = ?`)
      .get(runId) as { n: number }).n;
    const runs = db.prepare(`INSERT INTO superseded_runs SELECT ?, * FROM runs WHERE id = ?`)
      .run(attempt, runId).changes;
    const events = db.prepare(`INSERT INTO superseded_events SELECT ?, * FROM events WHERE run_id = ?`)
      .run(attempt, runId).changes;
    db.prepare(`DELETE FROM events WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM runs WHERE id = ?`).run(runId);
    return runs + events > 0 ? attempt : 0;
  });

  return {
    upsertRun: (r) => { ins.run(r as unknown as Record<string, unknown>); },
    insertEvent: (runId, e) => {
      const u = e.usage;
      insEv.run(runId, e.seq, e.type, e.name ?? null,
        e.payload === undefined ? null : JSON.stringify(e.payload),
        e.permissionDecision ?? null, e.blockedBy ?? null,
        u?.inputTokens ?? null, u?.cacheWriteTokens ?? null, u?.cacheReadTokens ?? null,
        u?.outputTokens ?? null, new Date().toISOString());
    },
    supersede: (runId) => {
      if (!supersede) throw new Error(`store opened read-only: cannot supersede ${runId}`);
      return supersede(runId);
    },
    allRuns: () => selRuns.all() as RunRow[],
    eventsForRun: (runId) => selEvents.all(runId) as StoredEvent[],
    integrity: () => ({
      duplicateSeqGroups: (db.prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT run_id FROM events GROUP BY run_id, seq HAVING COUNT(*) > 1)`)
        .get() as { c: number }).c,
      runsWithoutEvents: (db.prepare(
        `SELECT COUNT(*) AS c FROM runs r
         WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.run_id = r.id)`)
        .get() as { c: number }).c,
      orphanEventRuns: (db.prepare(
        `SELECT COUNT(DISTINCT run_id) AS c FROM events e
         WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.id = e.run_id)`)
        .get() as { c: number }).c,
      archiveTablesPresent: hasTable("superseded_runs") && hasTable("superseded_events"),
    }),
    close: () => db.close(),
  };
}
