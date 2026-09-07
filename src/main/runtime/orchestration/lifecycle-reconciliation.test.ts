import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import { SUCCESS_ENVELOPE, FAILED_ENVELOPE } from './worker-done-envelope-fixture'

describe('lifecycle reconciliation', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  it('rejects handle churn when neither side has stable pane identity', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_before_restart')
    const logs: string[] = []
    const message = db.insertMessage({
      from: 'term_after_restart',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      })
    })

    expect(reconcileLifecycleMessage(db, message, (line) => logs.push(line))).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    expect(logs.some((line) => line.includes('expected handle'))).toBe(true)
  })

  // Real leaf UUIDs: pane keys are `${tabId}:${leafUuid}` and only the leaf
  // half is identity (the tab half changes on pane break-out).
  const LEAF_A = '11111111-1111-1111-8111-111111111111'
  const LEAF_B = '22222222-2222-4222-9222-222222222222'

  it('completes worker_done from the dispatched pane after a handle remint', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_before_restart', `tab_w:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_after_restart',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: `tab_w:${LEAF_A}`
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
  })

  it('fails both the dispatch and task from an authenticated failed worker report', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Failed: tests cannot start',
      body: 'I attempted the work. The required service is unavailable. No files changed.',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'failed',
        envelope: FAILED_ENVELOPE,
        filesModified: []
      }),
      senderPaneKey: `tab_w:${LEAF_A}`
    })

    expect(reconcileLifecycleMessage(db, message)).toEqual({
      action: 'failed',
      taskId: task.id,
      dispatchId: dispatch.id
    })
    expect(db.getTask(task.id)).toMatchObject({ status: 'failed' })
    expect(db.getDispatchContextById(dispatch.id)).toMatchObject({ status: 'failed' })
    expect(JSON.parse(db.getTask(task.id)?.result ?? '{}')).toMatchObject({
      provenance: 'worker_report',
      outcome: 'failed',
      messageId: message.id
    })
  })

  it('replays an identical terminal outcome without mutating settled state', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker')
    const makeMessage = () =>
      db.insertMessage({
        from: 'term_worker',
        to: 'term_coordinator',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId: task.id,
          dispatchId: dispatch.id,
          outcome: 'succeeded',
          envelope: SUCCESS_ENVELOPE
        })
      })

    expect(reconcileLifecycleMessage(db, makeMessage()).action).toBe('completed')
    const result = db.getTask(task.id)?.result
    expect(reconcileLifecycleMessage(db, makeMessage()).action).toBe('completed')
    expect(db.getTask(task.id)?.result).toBe(result)
  })

  it.each([
    { payload: undefined, code: 'invalid_payload' },
    { payload: '{', code: 'invalid_payload' },
    {
      payload: JSON.stringify({
        dispatchId: 'ctx_1',
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      code: 'missing_task_id'
    },
    {
      payload: JSON.stringify({
        taskId: 'task_1',
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      code: 'missing_dispatch_id'
    },
    {
      payload: JSON.stringify({ taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'maybe' }),
      code: 'invalid_outcome'
    }
  ])('rejects malformed worker reports with $code', ({ payload, code }) => {
    db = new OrchestrationDb(':memory:')
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload
    })

    expect(reconcileLifecycleMessage(db, message)).toMatchObject({ action: 'rejected', code })
    expect(db.getMessageById(message.id)).toMatchObject({
      priority: 'high',
      subject: 'Rejected worker_done: Done'
    })
  })

  it('completes worker_done from the same leaf after a pane break-out changed the tab half', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    // Dispatch recorded the post-break-out pane key; the worker shell still
    // holds the spawn-time key with the old tab id.
    const dispatch = db.createDispatchContext(task.id, 'term_before_restart', `tab_new:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_after_restart',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: `tab_old:${LEAF_A}`
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
  })

  it('rejects mismatched opaque pane keys instead of treating them as legacy', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_owner', `tab_w:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_reminted',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: 'tab_w:42'
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('rejected')
    expect(db.getTask(task.id)?.status).toBe('dispatched')
  })

  it('rejects worker_done from a foreign pane that claims the assignee handle', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_owner', `tab_w1:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_owner',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: `tab_w2:${LEAF_B}`
    })

    expect(reconcileLifecycleMessage(db, message)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee',
      reason: expect.stringContaining('expected handle term_owner')
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getMessageById(message.id)).toMatchObject({
      type: 'worker_done',
      priority: 'high',
      subject: 'Rejected worker_done: Done',
      body: expect.stringContaining('Orca Lab rejected this worker_done')
    })
    const persisted = db.getMessageById(message.id)
    expect(JSON.parse(persisted?.payload ?? '{}')).toMatchObject({
      taskId: task.id,
      dispatchId: dispatch.id,
      _orcaLifecycleRejection: { code: 'sender_not_assignee' }
    })
    const rereadLogs: string[] = []
    expect(
      persisted && reconcileLifecycleMessage(db, persisted, (line) => rereadLogs.push(line))
    ).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    // Why: the send-path conversion logs nothing (no-op logger), so the
    // coordinator's re-read must still surface the rejection to its log stream.
    expect(rereadLogs.some((line) => line.includes('worker_done rejected'))).toBe(true)
  })

  it('does not let a caller-supplied rejection marker turn completion into success', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE,
        _orcaLifecycleRejection: {
          code: 'sender_not_assignee',
          reason: 'caller supplied'
        }
      }),
      senderPaneKey: `tab_w:${LEAF_A}`
    })

    expect(reconcileLifecycleMessage(db, message)).toEqual({
      action: 'rejected',
      code: 'sender_not_assignee',
      reason: 'caller supplied'
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
  })

  it('rejects a coordinator completion for a pane-bound dispatch', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)
    const message = db.insertMessage({
      from: 'term_coordinator',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      })
    })

    expect(reconcileLifecycleMessage(db, message)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
  })

  it('uses exact handle equality only for a legacy dispatch without a pane key', () => {
    db = new OrchestrationDb(':memory:')
    const acceptedTask = db.createTask({ spec: 'legacy work' })
    const acceptedDispatch = db.createDispatchContext(acceptedTask.id, 'term_legacy')
    const accepted = db.insertMessage({
      from: 'term_legacy',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: acceptedTask.id,
        dispatchId: acceptedDispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      })
    })
    expect(reconcileLifecycleMessage(db, accepted).action).toBe('completed')

    const rejectedTask = db.createTask({ spec: 'other legacy work' })
    const rejectedDispatch = db.createDispatchContext(rejectedTask.id, 'term_other_legacy')
    const rejected = db.insertMessage({
      from: 'term_foreign',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: rejectedTask.id,
        dispatchId: rejectedDispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      })
    })
    expect(reconcileLifecycleMessage(db, rejected)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask(rejectedTask.id)?.status).toBe('dispatched')
  })

  it('does not release a dependent when a foreign completion wins the arrival race', () => {
    db = new OrchestrationDb(':memory:')
    const parent = db.createTask({ spec: 'parent' })
    const child = db.createTask({ spec: 'child', deps: [parent.id] })
    const dispatch = db.createDispatchContext(parent.id, 'term_worker', `tab_w:${LEAF_A}`)
    const payload = JSON.stringify({
      taskId: parent.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      envelope: SUCCESS_ENVELOPE
    })

    const foreign = db.insertMessage({
      from: 'term_coordinator',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload,
      senderPaneKey: `tab_c:${LEAF_B}`
    })
    expect(reconcileLifecycleMessage(db, foreign)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask(child.id)?.status).toBe('pending')

    const owner = db.insertMessage({
      from: 'term_worker_reminted',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload,
      senderPaneKey: `tab_w_after:${LEAF_A}`
    })
    expect(reconcileLifecycleMessage(db, owner).action).toBe('completed')
    expect(db.getTask(child.id)?.status).toBe('ready')
  })

  it('does not let a foreign replay overwrite an authorized completion', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)
    const payload = JSON.stringify({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      envelope: SUCCESS_ENVELOPE
    })
    const owner = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload,
      senderPaneKey: `tab_w:${LEAF_A}`
    })
    expect(reconcileLifecycleMessage(db, owner).action).toBe('completed')
    const result = db.getTask(task.id)?.result

    const replay = db.insertMessage({
      from: 'term_foreign',
      to: 'term_coordinator',
      subject: 'Forged replay',
      type: 'worker_done',
      payload,
      senderPaneKey: `tab_f:${LEAF_B}`
    })
    expect(reconcileLifecycleMessage(db, replay)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask(task.id)?.result).toBe(result)
  })

  it('surfaces worker_done sent from a different pane as rejected', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_owner', `tab_w1:${LEAF_A}`)
    const logs: string[] = []
    const message = db.insertMessage({
      from: 'term_other_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: `tab_w2:${LEAF_B}`
    })

    expect(reconcileLifecycleMessage(db, message, (line) => logs.push(line))).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    expect(logs.some((line) => line.includes('worker_done rejected'))).toBe(true)
  })

  it('surfaces a heartbeat sent from a different pane without recording liveness', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_owner', `tab_w1:${LEAF_A}`)
    const heartbeat = db.insertMessage({
      from: 'term_other_worker',
      to: 'term_coordinator',
      subject: 'alive',
      type: 'heartbeat',
      payload: JSON.stringify({ dispatchId: dispatch.id }),
      senderPaneKey: `tab_w2:${LEAF_B}`
    })

    expect(reconcileLifecycleMessage(db, heartbeat)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getDispatchContextById(dispatch.id)?.last_heartbeat_at).toBeNull()
    expect(db.getMessageById(heartbeat.id)).toMatchObject({
      type: 'heartbeat',
      subject: 'Rejected heartbeat: alive'
    })
    // Why: the coordinator's re-read of the already-converted heartbeat must
    // still log the rejection, since the send-path conversion logged nothing.
    const persisted = db.getMessageById(heartbeat.id)
    const rereadLogs: string[] = []
    expect(
      persisted && reconcileLifecycleMessage(db, persisted, (line) => rereadLogs.push(line))
    ).toMatchObject({
      action: 'rejected'
    })
    expect(rereadLogs.some((line) => line.includes('Heartbeat rejected'))).toBe(true)
  })

  it('surfaces a foreign heartbeat that claims the assignee handle', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_owner', `tab_w1:${LEAF_A}`)
    const heartbeat = db.insertMessage({
      from: 'term_owner',
      to: 'term_coordinator',
      subject: 'alive',
      type: 'heartbeat',
      payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id }),
      senderPaneKey: `tab_w2:${LEAF_B}`
    })

    expect(reconcileLifecycleMessage(db, heartbeat)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getDispatchContextById(dispatch.id)?.last_heartbeat_at).toBeNull()
  })

  it('records a heartbeat whose pane key drifted only in the tab half', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_owner', `tab_new:${LEAF_A}`)
    const heartbeat = db.insertMessage({
      from: 'term_owner',
      to: 'term_coordinator',
      subject: 'alive',
      type: 'heartbeat',
      payload: JSON.stringify({ dispatchId: dispatch.id }),
      senderPaneKey: `tab_old:${LEAF_A}`
    })

    expect(reconcileLifecycleMessage(db, heartbeat)).toEqual({
      action: 'heartbeat_recorded',
      dispatchId: dispatch.id
    })
    expect(db.getDispatchContextById(dispatch.id)?.last_heartbeat_at).not.toBeNull()
  })

  it('suppresses same-dispatch heartbeats once worker_done is reconciled', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker')
    const otherTask = db.createTask({ spec: 'other work' })
    const otherDispatch = db.createDispatchContext(otherTask.id, 'term_other')
    const insertHeartbeat = (dispatchId: string, from: string) =>
      db.insertMessage({
        from,
        to: 'term_coordinator',
        subject: 'alive',
        type: 'heartbeat',
        payload: JSON.stringify({ dispatchId })
      })
    const staleHeartbeat = insertHeartbeat(dispatch.id, 'term_worker')
    const otherHeartbeat = insertHeartbeat(otherDispatch.id, 'term_other')
    reconcileLifecycleMessage(db, staleHeartbeat)
    reconcileLifecycleMessage(db, otherHeartbeat)
    const done = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      })
    })

    reconcileLifecycleMessage(db, done)

    expect(db.getUnreadMessages('term_coordinator', ['heartbeat']).map((row) => row.id)).toEqual([
      otherHeartbeat.id
    ])
    const archived = db
      .getAllMessagesForHandle('term_coordinator')
      .find((row) => row.id === staleHeartbeat.id)
    expect(archived).toMatchObject({ read: 1 })
    expect(archived?.delivered_at).not.toBeNull()

    const lateHeartbeat = insertHeartbeat(dispatch.id, 'term_worker')
    expect(reconcileLifecycleMessage(db, lateHeartbeat)).toEqual({ action: 'suppressed' })
    expect(db.getMessageById(lateHeartbeat.id)).toMatchObject({ read: 1 })
    expect(db.getMessageById(lateHeartbeat.id)?.delivered_at).not.toBeNull()
  })
})

// ORCA-299: a Dispatch failed by *inferring* death from silence can be refuted
// by the worker it declared dead. One failed on evidence cannot — that is the
// distinction the whole fix rests on, so both fixtures differ only in how the
// failure was produced.
describe('reopening a Dispatch failed by inference', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  const LEAF_LIVE = '33333333-3333-4333-8333-333333333333'
  const LEAF_OTHER = '44444444-4444-4444-9444-444444444444'
  const PANE = `tab_w:${LEAF_LIVE}`

  function dispatchFailedBySilence(): { taskId: string; dispatchId: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'inc_1'
    })
    db.armDispatchLifecycleDeadline(dispatch.id, 0)
    const expired = db.expireDispatchLifecycleDeadline({
      dispatchId: dispatch.id,
      nowIso: new Date(Date.now() + 60_000).toISOString(),
      reason: 'no lifecycle signal',
      subject: 'Dispatch failed: no lifecycle signal'
    })
    expect(expired.expired).toBe(true)
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  function dispatchFailedOnEvidence(): { taskId: string; dispatchId: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'inc_1'
    })
    // The evidence path: an exit code, not a guess about silence.
    db.failDispatch(dispatch.id, 'worker exited with code 1')
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('failed')
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  function lateHeartbeat(dispatchId: string, paneKey: string = PANE) {
    return db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'still working',
      type: 'heartbeat',
      payload: JSON.stringify({ dispatchId }),
      senderPaneKey: paneKey
    })
  }

  it('reopens on a late heartbeat from the assignee', () => {
    const { taskId, dispatchId } = dispatchFailedBySilence()
    const logs: string[] = []

    const result = reconcileLifecycleMessage(db, lateHeartbeat(dispatchId), (l) => logs.push(l))

    expect(result).toMatchObject({ action: 'heartbeat_recorded', dispatchId, reopened: true })
    const reopened = db.getDispatchContextById(dispatchId)
    expect(reopened?.status).toBe('dispatched')
    expect(reopened?.last_failure).toBeNull()
    expect(reopened?.completed_at).toBeNull()
    // The field that actually gags the worker: while it is set, every heartbeat
    // and worker_done is rejected before reconciliation ever sees it.
    expect(reopened?.capability_revoked_at).toBeNull()
    // ...and the capability itself is NOT rotated: the running worker holds the
    // original and could never be handed a new one.
    expect(reopened?.capability_hash).toBe(db.getDispatchContextById(dispatchId)?.capability_hash)
    expect(db.getTask(taskId)?.status).toBe('dispatched')
    expect(logs.some((l) => l.includes('reopened dispatch'))).toBe(true)
  })

  // THE control. A Dispatch failed on evidence must stay failed, or this fix
  // turns every reported failure into a resurrectable one.
  it('does NOT reopen a Dispatch that failed on evidence', () => {
    const { taskId, dispatchId } = dispatchFailedOnEvidence()
    const logs: string[] = []

    const result = reconcileLifecycleMessage(db, lateHeartbeat(dispatchId), (l) => logs.push(l))

    expect(result).toEqual({ action: 'suppressed' })
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('failed')
    expect(db.getDispatchContextById(dispatchId)?.last_failure).toBe('worker exited with code 1')
    expect(db.getTask(taskId)?.status).not.toBe('dispatched')
    expect(logs.some((l) => l.includes('on reported evidence'))).toBe(true)
  })

  // Migration 32 adds the column with no backfill, so every Dispatch that
  // failed before it has NULL provenance. That has to read as evidence: the
  // other default would make every historical failure reopenable by one late
  // heartbeat.
  it('does NOT reopen a pre-migration failure with no recorded provenance', () => {
    const { taskId, dispatchId } = dispatchFailedBySilence()
    const sqlite = (
      db as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }
    ).db
    sqlite
      .prepare('UPDATE dispatch_contexts SET failure_provenance = NULL WHERE id = ?')
      .run(dispatchId)

    const result = reconcileLifecycleMessage(db, lateHeartbeat(dispatchId))

    expect(result).toEqual({ action: 'suppressed' })
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('failed')
    expect(db.getTask(taskId)?.status).not.toBe('dispatched')
  })

  it('does NOT reopen on a heartbeat from a different pane', () => {
    const { dispatchId } = dispatchFailedBySilence()
    const logs: string[] = []

    const result = reconcileLifecycleMessage(
      db,
      lateHeartbeat(dispatchId, `tab_w:${LEAF_OTHER}`),
      (l) => logs.push(l)
    )

    expect(result).toMatchObject({ action: 'rejected', code: 'sender_not_assignee' })
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('failed')
    expect(db.getDispatchContextById(dispatchId)?.capability_revoked_at).not.toBeNull()
  })

  it('accepts worker_done from the assignee of a Dispatch failed by silence', () => {
    const { taskId, dispatchId } = dispatchFailedBySilence()
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId,
        dispatchId,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: PANE
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(db.getTask(taskId)?.status).toBe('completed')
  })

  it('tells the coordinator why a worker_done cannot settle an evidence-failed Dispatch', () => {
    const { taskId, dispatchId } = dispatchFailedOnEvidence()
    const logs: string[] = []
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId,
        dispatchId,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: PANE
    })

    const result = reconcileLifecycleMessage(db, message, (l) => logs.push(l))

    expect(result).toMatchObject({ action: 'rejected', code: 'inactive_dispatch' })
    // Requirement 3: the reason names the provenance, so the coordinator does
    // not have to go read the Dispatch to learn nothing can be done.
    expect(logs.join('\n')).toContain('on reported evidence')
    expect(db.getTask(taskId)?.status).not.toBe('completed')
  })
})
