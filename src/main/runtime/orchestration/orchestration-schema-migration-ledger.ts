// The orchestration schema ladder, declared. Read this before renumbering.
//
// 23, 24, 25 and 26 mean different migrations on the two lineages (upstream:
// terminal ownership, creator-incarnation, active-handle index, indexed receipt
// capacity; lab: envelope contract, terminal ownership, first-signal deadline,
// turn_accepted_at). A stamped user_version is the only thing migrate() consults,
// so landing an incoming step under a number the lab already shipped silently
// skips it on every database a lab build stamped, and the code then reads a
// column that was never added. Both builds share appId com.stablyai.orca, so
// they write the same userData/orchestration.db — the skew is reachable.
//
// Nothing marks that collision in a merge: the two lineages write the same
// number in different places. Declaring every divergent step here turns it into
// a failing test (orchestration-schema-migration-ledger.test.ts) instead of a
// comment somebody has to notice mid-merge.
//
// To land an incoming upstream migration: give it max(version) + 1, add it below
// with its effects and the number upstream shipped it under, and bump
// ORCHESTRATION_SCHEMA_VERSION. Never reuse a number that already appears here.

export type OrchestrationMigrationLineage = 'lab' | 'upstream-renumbered'

export type OrchestrationMigrationStep = {
  /** The `if (current < version)` gate in OrchestrationDb.migrate(). */
  readonly version: number
  readonly lineage: OrchestrationMigrationLineage
  readonly summary: string
  /** Only for 'upstream-renumbered': the number upstream shipped this step under. */
  readonly upstreamVersion?: number
  /**
   * What the gate body does, as `column:table.name`, `index:name`, `table:name`,
   * `drop:name`, `rename:from>to` or `step:function`. The ledger test re-derives
   * these from db.ts, so a step gaining an effect under an existing number fails.
   */
  readonly effects: readonly string[]
}

export const ORCHESTRATION_SCHEMA_VERSION = 29

/**
 * Below this the two lineages agree step for step, and neither adds anything
 * new there again — so the ledger only declares the divergent range.
 */
export const ORCHESTRATION_LEDGER_FIRST_DECLARED_VERSION = 23

export const ORCHESTRATION_SCHEMA_MIGRATION_LEDGER: readonly OrchestrationMigrationStep[] = [
  {
    version: 23,
    lineage: 'lab',
    summary: 'worker_done envelope contract and correction attempts',
    effects: [
      'column:dispatch_contexts.envelope_contract',
      'column:dispatch_contexts.envelope_correction_attempts'
    ]
  },
  {
    version: 24,
    lineage: 'upstream-renumbered',
    upstreamVersion: 23,
    summary: 'worker terminal resource ownership',
    effects: ['step:backfillWorkerTerminalResources']
  },
  {
    version: 25,
    lineage: 'lab',
    summary: 'dispatch first-signal deadline',
    effects: [
      'column:dispatch_contexts.first_lifecycle_signal_at',
      'column:dispatch_contexts.monitor_deadline_at',
      'index:idx_dispatch_monitor_deadline'
    ]
  },
  {
    version: 26,
    lineage: 'lab',
    summary: 'turn_accepted_at',
    effects: ['column:dispatch_contexts.turn_accepted_at']
  },
  {
    version: 27,
    lineage: 'lab',
    summary: 'composer_ready_proven',
    effects: ['column:dispatch_contexts.composer_ready_proven']
  },
  {
    version: 28,
    lineage: 'upstream-renumbered',
    upstreamVersion: 24,
    summary: 'creator-incarnation authority',
    effects: [
      'column:tasks.created_by_pane_key',
      'column:tasks.created_by_process_incarnation',
      'column:tasks.created_by_run_generation'
    ]
  },
  {
    version: 29,
    lineage: 'upstream-renumbered',
    upstreamVersion: 25,
    summary: 'active Dispatch handle lookup',
    effects: ['index:idx_dispatch_active_assignee_handle']
  }
]
