import type Database from '../../sqlite/sync-database'

const POST_V6_COLUMNS = [
  ['messages', 'run_id'],
  ['messages', 'delivery_contract'],
  ['coordinator_runs', 'scheduler_lost_at'],
  ['tasks', 'run_id'],
  ['dispatch_contexts', 'run_id'],
  ['dispatch_contexts', 'contract_version'],
  ['dispatch_contexts', 'launch_token_hash'],
  ['dispatch_contexts', 'capability_hash'],
  ['dispatch_contexts', 'process_incarnation'],
  ['dispatch_contexts', 'capability_revoked_at'],
  ['decision_gates', 'run_id'],
  ['question_threads', 'run_id'],
  ['worker_dispatches', 'runtime_epoch'],
  ['federated_dispatches', 'to_home_imported_sequence'],
  ['remote_dispatch_attachments', 'to_worker_imported_sequence'],
  ['remote_dispatch_attachments', 'protocol_version'],
  ['federation_relay_items', 'dispatch_id'],
  ['remote_questions', 'message_id'],
  ['legacy_adoptions', 'source_run_id'],
  ['legacy_compatibility_principals', 'id'],
  ['legacy_operation_receipts', 'principal_id'],
  ['legacy_mail_receipts', 'principal_id']
] as const

const POST_V6_INDEXES = [
  'idx_messages_run_sequence',
  'idx_messages_delivery_contract',
  'idx_tasks_run_status',
  'idx_dispatch_run_status',
  'idx_gates_run_status',
  'idx_runs_coordinator_pane',
  'idx_deliveries_one_outstanding',
  'idx_deliveries_run_created',
  'idx_questions_dispatch_status',
  'idx_federation_relay_pending',
  'idx_remote_questions_dispatch_status'
] as const

function hasOrchestrationColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[]
  return rows.some((row) => row.name === column)
}

function hasOrchestrationIndex(db: Database.Database, index: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)
}

function messagesAllowQuestions(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
    .get() as { sql: string } | undefined
  return !!row && row.sql.includes("'question'")
}

function hasConsistentLegacyAdoption(db: Database.Database): boolean {
  const sourceRunId = 'run_legacy_local'
  const sourceGraph = db
    .prepare(
      `SELECT 1
       WHERE EXISTS(SELECT 1 FROM tasks WHERE run_id = ?)
          OR EXISTS(SELECT 1 FROM dispatch_contexts WHERE run_id = ?)
          OR EXISTS(SELECT 1 FROM decision_gates WHERE run_id = ?)
          OR EXISTS(SELECT 1 FROM messages WHERE run_id = ?)
          OR EXISTS(SELECT 1 FROM question_threads WHERE run_id = ?)
          OR EXISTS(SELECT 1 FROM deliveries WHERE run_id = ?)`
    )
    .get(sourceRunId, sourceRunId, sourceRunId, sourceRunId, sourceRunId, sourceRunId)
  const adoption = db
    .prepare('SELECT adopted_run_id FROM legacy_adoptions WHERE source_run_id = ?')
    .get(sourceRunId) as { adopted_run_id: string } | undefined
  if (sourceGraph) {
    return false
  }
  if (adoption) {
    return Boolean(
      db.prepare('SELECT 1 FROM runs WHERE id = ? AND legacy = 0').get(adoption.adopted_run_id)
    )
  }
  return true
}

/** Last version both lineages agree on: v22 is `idx_dispatch_assignee_handle` on
 *  either side. From v23 the numbers diverge (see db.ts SCHEMA_VERSION). */
const LAST_SHARED_LINEAGE_VERSION = 22

/** The lab's v23 adds this column and nothing else does, so its absence above v22
 *  identifies a database an upstream build stamped. */
const LAB_LINEAGE_MARKER: readonly [string, string] = ['dispatch_contexts', 'envelope_contract']

function isUpstreamLineageDatabase(db: Database.Database, storedVersion: number): boolean {
  if (storedVersion <= LAST_SHARED_LINEAGE_VERSION) {
    return false
  }
  return !hasOrchestrationColumn(db, LAB_LINEAGE_MARKER[0], LAB_LINEAGE_MARKER[1])
}

function hasCompletePostV6Schema(db: Database.Database): boolean {
  return (
    POST_V6_COLUMNS.every(([table, column]) => hasOrchestrationColumn(db, table, column)) &&
    POST_V6_INDEXES.every((index) => hasOrchestrationIndex(db, index)) &&
    messagesAllowQuestions(db) &&
    hasConsistentLegacyAdoption(db)
  )
}

export function resolveOrchestrationMigrationStartVersion(
  db: Database.Database,
  storedVersion: number,
  schemaVersion: number
): number {
  // Why this runs before the newer-build guard below: both lineages ship
  // appId com.stablyai.orca, so they share userData/orchestration.db. A stamp of
  // 23–25 written by an upstream build would otherwise skip the lab's v23–v27 and
  // leave the code selecting envelope_contract, monitor_deadline_at,
  // turn_accepted_at and composer_ready_proven off tables that never got them —
  // and the failure surfaces far from the migration that caused it. Rewinding to
  // the last shared version replays the lab steps; every one is either
  // hasColumn-guarded, CREATE ... IF NOT EXISTS, or a NOT EXISTS-filtered
  // backfill, so re-running them over the upstream steps is inert.
  if (isUpstreamLineageDatabase(db, storedVersion)) {
    return Math.min(storedVersion, LAST_SHARED_LINEAGE_VERSION)
  }
  if (storedVersion > schemaVersion) {
    return storedVersion
  }
  if (hasCompletePostV6Schema(db)) {
    return storedVersion
  }
  // Why: version-skewed pre-Run databases can claim the post-v6 range while retaining v6 tables.
  return Math.min(storedVersion, schemaVersion, 6)
}
