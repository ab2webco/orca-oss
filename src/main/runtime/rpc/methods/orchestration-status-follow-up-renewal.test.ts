import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { reconcileLifecycleMessage } from '../../orchestration/lifecycle-reconciliation'
import { SUCCESS_ENVELOPE } from '../../orchestration/worker-done-envelope-fixture'

// ORCA-1177: a lead that hands a reported member more work by orchestration mail, not a
// terminal push, must leave that member able to report it with worker_done.
describe('orchestration.send status follow-up to a reported member', () => {
  const h = createOrchestrationRpcHarness()
  const PANE = 'tab_worker:leaf_worker'
  const PEER_PANE = 'tab_peer:leaf_peer'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let taskId: string
  let dispatchId: string
  let capability: string

  afterEach(() => h.cleanup())

  function reportedMember(): void {
    const state = h.setup()
    db = state.db
    runtime = state.runtime
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_worker'
        ? PANE
        : handle === 'term_coord'
          ? h.coordinatorPaneKey
          : handle === 'term_peer'
            ? PEER_PANE
            : null
    )
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    const task = db.createTask({
      spec: 'Work on ORCA-1177',
      taskTitle: 'ORCA-1177'
    })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    capability = db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'runtime_test:term_worker:1'
    })
    taskId = task.id
    dispatchId = dispatch.id
    const done = db.insertMessage({
      from: 'term_worker',
      to: 'term_coord',
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
    expect(reconcileLifecycleMessage(db, done).action).toBe('completed')
  }

  function mail(from: string, type = 'status') {
    return h.call(
      'orchestration.send',
      {
        from,
        to: 'term_worker',
        type,
        subject: 'Next',
        body: 'Address the review too.'
      },
      { runtime }
    )
  }

  function workerDone(): Promise<unknown> {
    const ctx: RpcContext = { runtime, orchestrationCapability: capability }
    return h.call(
      'orchestration.send',
      {
        from: 'term_worker',
        type: 'worker_done',
        subject: 'Review addressed',
        payload: JSON.stringify({
          taskId,
          dispatchId,
          outcome: 'succeeded',
          envelope: SUCCESS_ENVELOPE
        })
      },
      ctx
    )
  }

  it("records the member's next worker_done once its lead sent follow-up work", async () => {
    reportedMember()

    await mail('term_coord')
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('dispatched')

    const result = (await workerDone()) as { lifecycle?: { action: string } }
    expect(result.lifecycle?.action).toBe('completed')
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(db.getTask(taskId)?.status).toBe('completed')
  })

  it('records one done per follow-up, never a second for the same round', async () => {
    reportedMember()
    await mail('term_coord')
    await workerDone()

    const again = (await workerDone()) as { lifecycle?: { action: string } }
    expect(again.lifecycle?.action).not.toBe('completed')
  })

  // THE control: only the member's own lead reopens it; a peer's mail does not.
  it("leaves the Dispatch settled when the mail is not from the member's lead", async () => {
    reportedMember()

    await mail('term_peer')

    expect(db.getDispatchContextById(dispatchId)?.status).toBe('completed')
  })

  it('leaves the Dispatch settled once another process holds the member pane', async () => {
    reportedMember()
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue('runtime_test:term_worker:2')

    await mail('term_coord')

    expect(db.getDispatchContextById(dispatchId)?.status).toBe('completed')
  })

  it('leaves the Dispatch settled for mail that hands over no work', async () => {
    reportedMember()

    await mail('term_coord', 'escalation')

    expect(db.getDispatchContextById(dispatchId)?.status).toBe('completed')
  })
})
