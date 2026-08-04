import { afterEach, describe, expect, it } from 'vitest'
import type Database from '../../sqlite/sync-database'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import { MAX_ENVELOPE_CORRECTION_ATTEMPTS } from './worker-done-envelope'

function sqliteFor(db: OrchestrationDb): Database.Database {
  return (db as unknown as { db: Database.Database }).db
}

const VALID_ENVELOPE = {
  status: 'success',
  summary: 'Implemented the validated envelope.',
  artifacts: [{ kind: 'pr', ref: 'https://example.test/pull/1' }],
  verification: [
    {
      claim: 'runtime rejects a bad envelope',
      evidence: 'live send: invalid_envelope',
      level: 'live'
    }
  ],
  outOfScopeWrites: [],
  notesForNextAgent: 'Nothing pending.'
}

describe('worker_done envelope boundary', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  function dispatched(handle = 'term_worker'): {
    taskId: string
    dispatchId: string
  } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, handle)
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  function sendWorkerDone(
    taskId: string,
    dispatchId: string,
    payloadExtra: Record<string, unknown>,
    from = 'term_worker'
  ) {
    return db.insertMessage({
      from,
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId, dispatchId, outcome: 'succeeded', ...payloadExtra })
    })
  }

  it('settles a valid envelope and carries it into the task result', () => {
    const { taskId, dispatchId } = dispatched()
    const message = sendWorkerDone(taskId, dispatchId, { envelope: VALID_ENVELOPE })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(JSON.parse(db.getTask(taskId)?.result ?? '{}').envelope).toEqual(VALID_ENVELOPE)
  })

  it('rejects a worker_done with no envelope and leaves the task dispatched', () => {
    const { taskId, dispatchId } = dispatched()
    const message = sendWorkerDone(taskId, dispatchId, {})

    expect(reconcileLifecycleMessage(db, message)).toMatchObject({
      action: 'rejected',
      code: 'invalid_envelope'
    })
    expect(db.getTask(taskId)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(dispatchId)?.envelope_correction_attempts).toBe(1)
  })

  it('rejects a success envelope whose only claim is unverified', () => {
    const { taskId, dispatchId } = dispatched()
    const message = sendWorkerDone(taskId, dispatchId, {
      envelope: {
        ...VALID_ENVELOPE,
        verification: [{ claim: 'rollback path works', evidence: '', level: 'none' }]
      }
    })

    expect(reconcileLifecycleMessage(db, message)).toMatchObject({
      action: 'rejected',
      code: 'invalid_envelope',
      reason: expect.stringContaining('level "none"')
    })
    expect(db.getTask(taskId)?.status).toBe('dispatched')
  })

  it('rejects an envelope status that contradicts the reported outcome', () => {
    const { taskId, dispatchId } = dispatched()
    const message = sendWorkerDone(taskId, dispatchId, {
      envelope: { status: 'blocked', summary: 'Stopped at the migration.' }
    })

    expect(reconcileLifecycleMessage(db, message)).toMatchObject({
      action: 'rejected',
      code: 'invalid_envelope',
      reason: expect.stringContaining('contradicts outcome')
    })
  })

  it('settles a blocked envelope as a failed outcome while keeping the status', () => {
    const { taskId, dispatchId } = dispatched()
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Blocked',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId,
        dispatchId,
        outcome: 'failed',
        envelope: { status: 'blocked', summary: 'Staging host unreachable.' }
      })
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('failed')
    expect(JSON.parse(db.getTask(taskId)?.result ?? '{}')).toMatchObject({
      outcome: 'failed',
      envelope: { status: 'blocked' }
    })
  })

  it('stops asking the same session after the correction cap', () => {
    const { taskId, dispatchId } = dispatched()
    for (let attempt = 1; attempt <= MAX_ENVELOPE_CORRECTION_ATTEMPTS; attempt += 1) {
      const message = sendWorkerDone(taskId, dispatchId, { envelope: { status: 'banana' } })
      expect(reconcileLifecycleMessage(db, message)).toMatchObject({
        action: 'rejected',
        code: 'invalid_envelope',
        reason: expect.stringContaining(
          `correction ${attempt} of ${MAX_ENVELOPE_CORRECTION_ATTEMPTS}`
        )
      })
    }

    const exhausted = sendWorkerDone(taskId, dispatchId, { envelope: { status: 'banana' } })
    expect(reconcileLifecycleMessage(db, exhausted)).toMatchObject({
      action: 'rejected',
      code: 'envelope_correction_exhausted',
      reason: expect.stringContaining('fresh worker session')
    })
    expect(db.getTask(taskId)?.status).toBe('dispatched')
  })

  // Why: reconcile runs from send, from check, and from the coordinator loop —
  // if a re-read re-counted, a single bad envelope would burn the whole budget.
  it('counts one correction attempt per rejected message, not per reconcile', () => {
    const { taskId, dispatchId } = dispatched()
    const message = sendWorkerDone(taskId, dispatchId, { envelope: { status: 'banana' } })

    reconcileLifecycleMessage(db, message)
    const persisted = db.getMessageById(message.id)
    expect(persisted).toBeDefined()
    reconcileLifecycleMessage(db, persisted!)
    reconcileLifecycleMessage(db, persisted!)

    expect(db.getDispatchContextById(dispatchId)?.envelope_correction_attempts).toBe(1)
  })

  // Why: a federated worker settles its own relay attachment as it reports, so
  // rejecting at home would leave the worker unable to correct and the task
  // dispatched forever. Enforcement for those lands with the worker-side round.
  it('leaves a federated dispatch on the prose contract', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'remote work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      federation: {
        environmentId: 'env_1',
        environmentName: 'sandbox',
        peerFingerprint: 'peer_1',
        protocolVersion: 3
      }
    })
    db.prepareStartingWorkerAuthority({
      dispatchId: dispatch.id,
      handle: 'term_remote',
      paneKey: 'tab_remote:leaf_remote',
      processIncarnation: 'proc_1',
      worktreeId: 'wt_remote',
      effects: [],
      setupState: 'ready'
    })
    const message = db.insertMessage({
      from: 'term_remote',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded' }),
      senderPaneKey: 'tab_remote:leaf_remote'
    })

    const result = reconcileLifecycleMessage(db, message)
    expect(result.action === 'rejected' ? result.code : 'accepted').not.toMatch(/envelope/)
    expect(db.getDispatchContextById(dispatch.id)?.envelope_correction_attempts).toBe(0)
  })

  // Why: a dispatch created before this contract existed never saw the envelope
  // rule in its preamble, so upgrading Orca mid-run must not strand it.
  it('leaves a pre-contract dispatch on the prose contract', () => {
    const { taskId, dispatchId } = dispatched()
    sqliteFor(db)
      .prepare('UPDATE dispatch_contexts SET envelope_contract = 0 WHERE id = ?')
      .run(dispatchId)
    const message = sendWorkerDone(taskId, dispatchId, {})

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(JSON.parse(db.getTask(taskId)?.result ?? '{}').envelope).toBeNull()
  })
})
