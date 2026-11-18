import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { listOpenFederatedGameMembers } from './orchestrator-game-federated-members'

function startOnM1(d: OrchestrationDb, runId: string, title: string, leadWorktreeId: string) {
  const task = d.createTask({ spec: title, taskTitle: title, runId })
  return d.createStartingWorkerDispatch({
    taskId: task.id,
    startOptions: { on: 'env_m1', serverName: 'm1', leadWorktreeId },
    federation: {
      environmentId: 'env_m1',
      environmentName: 'm1',
      peerFingerprint: 'fp_m1',
      protocolVersion: 1
    }
  }).dispatch.id
}

// ORCA-1284: every lead runs in one Orca, so its DB holds what each project placed on m1.
describe('open members this Orca placed on paired hosts', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it('lists every Run’s open ones with their host and lead worktree, not settled or stopped ones', () => {
    db = new OrchestrationDb(':memory:')
    const orca = db.createRun({
      objective: 'orca lead',
      coordinatorHandle: 'term_orca',
      coordinatorPaneKey: 'tab_orca:11111111-1111-4111-8111-111111111111'
    })
    const cineco = db.createRun({
      objective: 'cineco lead',
      coordinatorHandle: 'term_cin',
      coordinatorPaneKey: 'tab_cin:22222222-2222-4222-9222-222222222222'
    })
    const own = startOnM1(db, orca.id, 'ORCA-1', 'wt-orca')
    const open = startOnM1(db, cineco.id, 'CIN-1', 'wt-cineco')
    const completed = startOnM1(db, cineco.id, 'CIN-2', 'wt-cineco')
    const stopped = startOnM1(db, cineco.id, 'CIN-3', 'wt-cineco')
    const local = db.createTask({ spec: 'local', runId: cineco.id })
    db.createStartingWorkerDispatch({ taskId: local.id, startOptions: {} })
    const sqlite = (db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
    sqlite
      .prepare(`UPDATE dispatch_contexts SET status = 'completed' WHERE id = '${completed}'`)
      .run()
    sqlite
      .prepare(`UPDATE worker_dispatches SET state = 'stopped' WHERE dispatch_id = '${stopped}'`)
      .run()

    expect(listOpenFederatedGameMembers(db)).toEqual([
      { dispatchId: own, host: 'm1', leadWorktreeId: 'wt-orca' },
      { dispatchId: open, host: 'm1', leadWorktreeId: 'wt-cineco' }
    ])
  })
})
