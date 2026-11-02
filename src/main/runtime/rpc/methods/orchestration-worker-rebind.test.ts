import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { SUCCESS_ENVELOPE } from '../../orchestration/worker-done-envelope-fixture'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'

const PANES: Record<string, string> = {
  term_old: 'tab_old:leaf_old',
  term_new: 'tab_new:leaf_new'
}

// `orca game rebind`'s sequence on a member whose terminal was replaced (CIN-1297, ORCA-914).
describe('rebinding a member to the terminal that replaced its own', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  const gone = new Set<string>()
  const prompts: [string, string][] = []

  afterEach(() => {
    gone.clear()
    prompts.length = 0
    h.cleanup()
  })

  function setup(): void {
    ;({ db, runtime, ctx } = h.setup())
    vi.mocked(runtime.getTerminalPaneKey).mockImplementation((handle) =>
      handle === 'term_coord' ? h.coordinatorPaneKey : (PANES[handle] ?? null)
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockImplementation(async (handle) => {
      if (gone.has(handle)) {
        throw new Error('terminal_handle_stale')
      }
      return { handle, worktreeId: 'repo::worktree', status: 'running' } as never
    })
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({ id: 'repo::worktree' } as never)
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::worktree'
    } as never)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    vi.spyOn(runtime, 'waitForTerminal').mockImplementation(async (handle) => ({
      handle,
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    }))
    vi.spyOn(runtime, 'waitForAgentComposerReady').mockResolvedValue({
      ready: true,
      proven: true,
      state: 'ready',
      signal: 'codex-composer-prompt',
      waitedMs: 1
    })
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockImplementation(async (handle, prompt) => {
      prompts.push([handle, prompt])
      return { handle, accepted: true, bytesWritten: prompt.length }
    })
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
  }

  const call = (name: string, params: Record<string, unknown>, context = ctx) =>
    h.call(name, params, context) as Promise<Record<string, unknown>>

  const capabilityTypedInto = (handle: string): string => {
    const prompt = prompts.findLast(([to]) => to === handle)?.[1] ?? ''
    return /--dispatch-capability (\S+)/.exec(prompt)?.[1] ?? ''
  }

  const done = (dispatchId: string, taskId: string, capability: string) =>
    call(
      'orchestration.send',
      {
        from: 'term_new',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId,
          dispatchId,
          outcome: 'succeeded',
          envelope: SUCCESS_ENVELOPE
        })
      },
      { runtime, orchestrationCapability: capability }
    ) as Promise<{ lifecycle?: { action?: string; code?: string } }>

  it('settles the dispatch whose terminal is gone, and the new terminal reports as the member', async () => {
    setup()
    const task = db.createTask({ spec: 'CIN-1297', taskTitle: 'CIN-1297' })
    const first = await call('orchestration.workerStart', {
      task: task.id,
      from: 'term_coord',
      terminal: 'term_old'
    })
    const oldCapability = capabilityTypedInto('term_old')
    expect(first.state).toBe('ready')
    expect(oldCapability).not.toBe('')
    gone.add('term_old')

    // Why abandon: with its terminal gone a stop cannot be proven, and a retry needs a settled prior.
    const stopped = await call('orchestration.workerStop', { dispatch: first.dispatchId })
    expect(stopped.state).toBe('stop_unknown')
    await expect(
      call('orchestration.workerStart', {
        task: task.id,
        retryOf: first.dispatchId,
        from: 'term_coord',
        terminal: 'term_new'
      })
    ).rejects.toThrow(/cannot retry/)
    const abandoned = await call('orchestration.workerAbandon', { dispatch: first.dispatchId })
    expect(abandoned.state).toBe('abandoned')
    expect(
      db.getDispatchContextById(first.dispatchId as string)?.capability_revoked_at
    ).toBeTruthy()

    const rebound = await call('orchestration.workerStart', {
      task: task.id,
      retryOf: first.dispatchId,
      from: 'term_coord',
      terminal: 'term_new'
    })
    const newCapability = capabilityTypedInto('term_new')

    expect(rebound.state).toBe('ready')
    expect(db.getActiveDispatchForTerminal('term_new')?.id).toBe(rebound.dispatchId)
    expect(db.getActiveDispatchForTerminal('term_old')).toBeUndefined()
    expect(newCapability).not.toBe(oldCapability)
    const refused = await done(rebound.dispatchId as string, task.id, oldCapability)
    expect(refused.lifecycle?.code).toBe('dispatch_capability_invalid')
    const accepted = await done(rebound.dispatchId as string, task.id, newCapability)
    expect(accepted.lifecycle?.action).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
  })
})
