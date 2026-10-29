import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { reconcileLifecycleMessage } from '../../orchestration/lifecycle-reconciliation'
import { SUCCESS_ENVELOPE } from '../../orchestration/worker-done-envelope-fixture'
import { gameInboxSourceOf } from '../../orchestrator-game-inbox-source'
import { gameInboxesOf } from '../../../../shared/orchestrator-game-inbox'

// ORCA-856: a member that already sent worker_done still reaches its lead with `ask`.
describe('orchestration.ask after worker_done', () => {
  const h = createOrchestrationRpcHarness()
  const PANE = 'tab_worker:leaf_worker'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let runId: string

  afterEach(() => h.cleanup())

  function settledMember(): {
    taskId: string
    dispatchId: string
    capability: string
  } {
    const state = h.setup()
    db = state.db
    runtime = state.runtime
    runId = state.activeRunId as string
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_worker' ? PANE : handle === 'term_coord' ? h.coordinatorPaneKey : null
    )
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    vi.spyOn(runtime, 'waitForMessage').mockResolvedValue('timed_out')
    const task = db.createTask({
      spec: 'Work on ORCA-856',
      taskTitle: 'ORCA-856'
    })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    const capability = db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'runtime_test:term_worker:1'
    })
    ctx = { runtime, orchestrationCapability: capability }
    const done = db.insertMessage({
      from: 'term_worker',
      to: 'term_coord',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: PANE
    })
    expect(reconcileLifecycleMessage(db, done).action).toBe('completed')
    return { taskId: task.id, dispatchId: dispatch.id, capability }
  }

  function ask(question: string) {
    return h.call('orchestration.ask', { from: 'term_worker', question, timeoutMs: 1 }, ctx)
  }

  it("reaches the lead's inbox and its waiting list", async () => {
    const { dispatchId } = settledMember()

    const result = (await ask('The owner gave me more work: may I extend the PR?')) as {
      messageId: string
      reopenedDispatchId?: string
    }

    expect(result.messageId).toMatch(/^msg_/)
    expect(result.reopenedDispatchId).toBe(dispatchId)
    expect(db.listPendingQuestions(runId).map((row) => row.id)).toEqual([result.messageId])
    const source = gameInboxSourceOf(db, {
      handle: 'term_coord',
      paneKey: h.coordinatorPaneKey
    })
    const lead = gameInboxesOf(source, {}).find((inbox) => inbox.key === 'lead')
    expect(lead?.waiting.map((row) => row.id)).toEqual([result.messageId])
  })

  it('lets the member report again once the follow-up is done', async () => {
    const { taskId, dispatchId } = settledMember()
    await ask('Proceed?')

    const again = db.insertMessage({
      from: 'term_worker',
      to: 'term_coord',
      subject: 'Done again',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId,
        dispatchId,
        outcome: 'succeeded',
        envelope: SUCCESS_ENVELOPE
      }),
      senderPaneKey: PANE
    })
    expect(reconcileLifecycleMessage(db, again).action).toBe('completed')
  })

  // THE control: only the member holding the Dispatch's capability reopens it.
  it('stays refused without the Dispatch capability', async () => {
    const { dispatchId } = settledMember()
    ctx = { runtime, orchestrationCapability: 'dcap_someone_else' }

    await expect(ask('Proceed?')).rejects.toMatchObject({
      code: 'dispatch_inactive'
    })
    expect(db.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(db.listPendingQuestions(runId)).toHaveLength(0)
  })

  it('stays refused for a failed Dispatch', async () => {
    const state = h.setup()
    db = state.db
    runtime = state.runtime
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_worker' ? PANE : null
    )
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    const capability = db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'runtime_test:term_worker:1'
    })
    db.failDispatch(dispatch.id, 'worker exited with code 1')
    ctx = { runtime, orchestrationCapability: capability }

    await expect(ask('Proceed?')).rejects.toMatchObject({
      code: 'dispatch_inactive'
    })
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('failed')
  })
})
