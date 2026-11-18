import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { liveFederatedGameMembersOf } from './orchestrator-game-federated-members'
import type { RemoteHostSessions } from './orchestrator-game-remote-found'

function startOnM1(d: OrchestrationDb, runId: string, title: string, leadWorktreeId: string) {
  const task = d.createTask({ spec: title, taskTitle: title, runId })
  const id = d.createStartingWorkerDispatch({
    taskId: task.id,
    startOptions: { on: 'env_m1', serverName: 'm1', leadWorktreeId },
    federation: {
      environmentId: 'env_m1',
      environmentName: 'm1',
      peerFingerprint: 'fp_m1',
      protocolVersion: 1
    }
  }).dispatch.id
  d.updateFederatedDispatchResources({
    dispatchId: id,
    remoteRuntimeEpoch: 'epoch_m1',
    worktreeId: `wt-${title}`,
    terminalHandle: `term_${title}`
  })
  return id
}

const runOf = (d: OrchestrationDb, name: string, n: number) =>
  d.createRun({
    objective: `${name} lead`,
    coordinatorHandle: `term_${name}`,
    coordinatorPaneKey: `tab_${name}:${String(n).repeat(8)}-1111-4111-8111-111111111111`
  })

// ORCA-1284: every lead runs in one Orca, so its DB holds what each project placed on m1.
describe('open members this Orca placed on paired hosts', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it('lists every Run’s open federated dispatches, never settled or stopped ones', () => {
    db = new OrchestrationDb(':memory:')
    const orca = runOf(db, 'orca', 1)
    const cineco = runOf(db, 'cineco', 2)
    const own = startOnM1(db, orca.id, 'ORCA-1', 'wt-orca')
    const open = startOnM1(db, cineco.id, 'CIN-1', 'wt-cineco')
    const completed = startOnM1(db, cineco.id, 'CIN-2', 'wt-cineco')
    const stopped = startOnM1(db, cineco.id, 'CIN-3', 'wt-cineco')
    const failed = startOnM1(db, cineco.id, 'CIN-4', 'wt-cineco')
    const local = db.createTask({ spec: 'local', runId: cineco.id })
    db.createStartingWorkerDispatch({ taskId: local.id, startOptions: {} })
    const sqlite = (db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
    sqlite
      .prepare(`UPDATE dispatch_contexts SET status = 'completed' WHERE id = '${completed}'`)
      .run()
    sqlite
      .prepare(`UPDATE worker_dispatches SET state = 'stopped' WHERE dispatch_id = '${stopped}'`)
      .run()
    sqlite
      .prepare(`UPDATE worker_dispatches SET state = 'failed' WHERE dispatch_id = '${failed}'`)
      .run()

    expect(db.listOpenFederatedDispatches()).toEqual([
      {
        dispatchId: own,
        environmentId: 'env_m1',
        remoteWorktreeId: 'wt-ORCA-1',
        leadWorktreeId: 'wt-orca'
      },
      {
        dispatchId: open,
        environmentId: 'env_m1',
        remoteWorktreeId: 'wt-CIN-1',
        leadWorktreeId: 'wt-cineco'
      }
    ])
  })

  it('counts an open dispatch only while its worktree runs an agent on the host now', () => {
    db = new OrchestrationDb(':memory:')
    const cineco = runOf(db, 'cineco', 2)
    // Why: the lead machine's real DB held 24 such rows back to Oct 27; dispatches there are never closed.
    const stale = ['CIN-1', 'CIN-2', 'CIN-3'].map((title) =>
      startOnM1(db!, cineco.id, title, 'wt-cineco')
    )
    const live = startOnM1(db, cineco.id, 'CIN-4', 'wt-cineco')
    const sqlite = (db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
    sqlite.prepare("UPDATE worker_dispatches SET state = 'ready', stage = 'input_accepted'").run()
    const m1 = (worktrees: { id: string; agents: number }[]): RemoteHostSessions =>
      ({
        environmentId: 'env_m1',
        host: 'm1',
        worktrees: worktrees.map(({ id, agents }) => ({
          worktreeId: id,
          agents: Array.from({ length: agents }, (_, n) => ({ paneKey: `${id}:${n}` }))
        }))
      }) as unknown as RemoteHostSessions
    const rows = db.listOpenFederatedDispatches()
    expect(rows.map((one) => one.dispatchId)).toEqual([...stale, live])

    expect(
      liveFederatedGameMembersOf(rows, [
        m1([
          { id: 'wt-CIN-1', agents: 0 },
          { id: 'wt-CIN-4', agents: 1 }
        ])
      ])
    ).toEqual([{ dispatchId: live, host: 'm1', leadWorktreeId: 'wt-cineco' }])
    // Why: a silent host lists no worktrees, and that must read as nothing running, not everything.
    expect(liveFederatedGameMembersOf(rows, [m1([])])).toEqual([])
    expect(liveFederatedGameMembersOf(rows, [])).toEqual([])
  })
})
