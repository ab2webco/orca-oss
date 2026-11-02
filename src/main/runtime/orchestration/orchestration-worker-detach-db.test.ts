import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

// Why: the lead lets go of a member without killing it; nothing may close its pane later (ORCA-943).
describe('OrchestrationDb.detachWorker', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
  })

  function readyWorker(): { d: OrchestrationDb; dispatchId: string; taskId: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'worker' })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'claude' }
    })
    db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: 'term_worker',
      paneKey: 'tab_worker:leaf_worker',
      processIncarnation: 'runtime:pty:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      terminalOwnership: 'created',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }]
    })
    db.markWorkerDispatchReady(started.dispatch.id)
    return { d: db, dispatchId: started.dispatch.id, taskId: task.id }
  }

  it('settles a live dispatch as detached and hands its terminal to the user', () => {
    const { d, dispatchId } = readyWorker()

    expect(d.detachWorker(dispatchId)).toMatchObject({
      disposition: 'detached',
      worker: { state: 'stopped', stage: 'detached' }
    })
    expect(d.getDispatchContextById(dispatchId)).toMatchObject({
      status: 'failed',
      last_failure: 'detached'
    })
    expect(d.getDispatchContextById(dispatchId)?.capability_revoked_at).not.toBeNull()
    expect(d.getWorkerTerminalResourceByOwner(dispatchId)).toMatchObject({
      ownership_state: 'user_owned',
      release_state: 'retained'
    })
    expect(d.requestWorkerTerminalRelease(dispatchId)).toMatchObject({ disposition: 'retained' })
  })

  it('leaves a settled dispatch as it is', () => {
    const { d, dispatchId } = readyWorker()
    d.beginWorkerStop(dispatchId)
    d.settleWorkerStop(dispatchId)

    expect(d.detachWorker(dispatchId)).toMatchObject({
      disposition: 'already_settled',
      worker: { state: 'stopped', stage: 'process_stopped' }
    })
  })
})
