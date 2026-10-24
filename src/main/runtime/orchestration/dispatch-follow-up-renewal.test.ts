import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import { renewDispatchForFollowUpPrompt } from './dispatch-follow-up-renewal'
import { SUCCESS_ENVELOPE } from './worker-done-envelope-fixture'

describe('renewDispatchForFollowUpPrompt', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  const LEAF = '66666666-6666-4666-8666-666666666666'
  const PANE = `tab_w:${LEAF}`
  const HANDLE = 'term_member'

  function dispatchWithCapability(): { taskId: string; dispatchId: string; capability: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, HANDLE, PANE)
    const capability = db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'inc_1'
    })
    return { taskId: task.id, dispatchId: dispatch.id, capability }
  }

  function workerDone(taskId: string, dispatchId: string) {
    return db.insertMessage({
      from: HANDLE,
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
  }

  // The same check the worker_done RPC runs before reconciliation sees the message.
  function capabilityAccepted(dispatchId: string, capability: string): boolean {
    return db.verifyDispatchCapability({
      dispatchId,
      capability,
      paneKey: PANE,
      processIncarnation: 'inc_1'
    }).valid
  }

  it('lets the member report again after a follow-up prompt, with its original capability', () => {
    const { taskId, dispatchId, capability } = dispatchWithCapability()
    expect(reconcileLifecycleMessage(db, workerDone(taskId, dispatchId)).action).toBe('completed')
    expect(capabilityAccepted(dispatchId, capability)).toBe(false)

    renewDispatchForFollowUpPrompt(db, { handle: HANDLE, paneKey: PANE })

    expect(capabilityAccepted(dispatchId, capability)).toBe(true)
    expect(reconcileLifecycleMessage(db, workerDone(taskId, dispatchId)).action).toBe('completed')
    expect(db.getTask(taskId)?.status).toBe('completed')
  })

  it('leaves an active Dispatch alone', () => {
    const { dispatchId } = dispatchWithCapability()

    expect(renewDispatchForFollowUpPrompt(db, { handle: HANDLE, paneKey: PANE })).toBeUndefined()
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
  })

  // THE control: a failed worker is not renewed by a prompt, so its failure stays a failure.
  it('leaves a failed Dispatch alone', () => {
    const { dispatchId } = dispatchWithCapability()
    db.failDispatch(dispatchId, 'worker exited with code 1')

    expect(renewDispatchForFollowUpPrompt(db, { handle: HANDLE, paneKey: PANE })).toBeUndefined()
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('failed')
  })

  it('does nothing for a terminal that never had a Dispatch', () => {
    db = new OrchestrationDb(':memory:')

    expect(
      renewDispatchForFollowUpPrompt(db, { handle: 'term_idle', paneKey: undefined })
    ).toBeUndefined()
  })
})
