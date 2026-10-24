import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { RpcRequest } from './core'
import type { OrcaRuntimeService } from '../orca-runtime'
import { TERMINAL_METHODS } from './methods/terminal'
import { OrchestrationDb } from '../orchestration/db'
import { reconcileLifecycleMessage } from '../orchestration/lifecycle-reconciliation'
import { SUCCESS_ENVELOPE } from '../orchestration/worker-done-envelope-fixture'

// ORCA-779: `game push` reaches a member through this route, so the renewal of its completed
// Dispatch must follow a delivered prompt and must never cost the prompt itself.
const HANDLE = 'term_member'
const PANE = 'tab_w:77777777-7777-4777-8777-777777777777'

describe('terminal.send follow-up renewal', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function completedDispatch(): string {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, HANDLE, PANE)
    db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'inc_1'
    })
    const done = db.insertMessage({
      from: HANDLE,
      to: 'term_lead',
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
    return dispatch.id
  }

  function runtimeWith(
    orchestrationDb: () => OrchestrationDb,
    accepted: boolean
  ): OrcaRuntimeService {
    return {
      getRuntimeId: () => 'test-runtime',
      resolveLiveLeafForHandle: () => null,
      getDriver: () => null,
      getOrchestrationDb: orchestrationDb,
      getTerminalPaneKey: () => PANE,
      sendTerminal: vi.fn(),
      sendTerminalAgentPrompt: vi
        .fn()
        .mockResolvedValue({ handle: HANDLE, accepted, bytesWritten: accepted ? 12 : 0 })
    } as unknown as OrcaRuntimeService
  }

  async function push(runtime: OrcaRuntimeService) {
    const request: RpcRequest = {
      id: 'req-1',
      authToken: 'tok',
      method: 'terminal.send',
      params: {
        terminal: HANDLE,
        text: 'address the review',
        enter: true,
        agentPrompt: true,
        client: { id: 'orca-cli', type: 'desktop' }
      }
    }
    return await new RpcDispatcher({ runtime, methods: TERMINAL_METHODS }).dispatch(request)
  }

  it('renews the completed Dispatch once the follow-up prompt is accepted', async () => {
    const dispatchId = completedDispatch()
    const live = db as OrchestrationDb

    const response = await push(runtimeWith(() => live, true))

    expect(response.ok).toBe(true)
    expect(live.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
    expect(live.getDispatchContextById(dispatchId)?.capability_revoked_at).toBeNull()
  })

  it('leaves the Dispatch completed when the prompt was not delivered', async () => {
    const dispatchId = completedDispatch()
    const live = db as OrchestrationDb

    await push(runtimeWith(() => live, false))

    expect(live.getDispatchContextById(dispatchId)?.status).toBe('completed')
  })

  it('still delivers the prompt when the renewal cannot run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtime = runtimeWith(() => {
      throw new Error('orchestration db unavailable')
    }, true)

    const response = await push(runtime)

    expect(response.ok).toBe(true)
    expect(runtime.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
