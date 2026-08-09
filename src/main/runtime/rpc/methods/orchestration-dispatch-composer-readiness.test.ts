import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_METHODS } from './orchestration'
import { buildRegistry, type RpcContext } from '../core'
import { OrchestrationDb } from '../../orchestration/db'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { AgentComposerReadiness, AgentTurnAcceptance } from '../../agent-composer-readiness'

/**
 * The inject-time readiness gate (ORCA-191 slice 2).
 *
 * The incident: `terminal create --task` waits for `tui-idle`, which for Codex
 * is satisfied ~3-4 s before the composer accepts input, then injects the
 * preamble into a booting TUI that swallows it. Slice 1 made that silence
 * visible after 11 min; this gate stops it happening.
 */
describe('orchestration.dispatch composer readiness (ORCA-191)', () => {
  let db: OrchestrationDb
  let dbOpen = false
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let runId: string

  const COORD_PANE = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const WORKER = 'term_worker'

  afterEach(() => {
    if (!dbOpen) {
      return
    }
    dbOpen = false
    db.close()
  })

  function setup(): void {
    db = new OrchestrationDb(':memory:')
    dbOpen = true
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === WORKER ? `tab_worker:${WORKER}` : COORD_PANE
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation(
      (handle) => `runtime_test:${handle}:1`
    )
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    vi.spyOn(runtime, 'isTerminalBlockedOnInteractivePrompt').mockResolvedValue(false)
    runId = db.createRun({
      objective: 'inject readiness',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: COORD_PANE
    }).id
    ctx = { runtime }
  }

  function mockComposerReadiness(readiness: Partial<AgentComposerReadiness>): void {
    vi.spyOn(runtime, 'waitForAgentComposerReady').mockResolvedValue({
      ready: true,
      proven: false,
      state: 'unobserved',
      signal: null,
      waitedMs: 0,
      ...readiness
    })
  }

  function mockSend(turnAcceptance: AgentTurnAcceptance): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(runtime, 'sendTerminalAgentPromptObservingTurn').mockResolvedValue({
      send: { handle: WORKER, accepted: true, bytesWritten: 1 },
      turnAcceptance: Promise.resolve(turnAcceptance)
    })
  }

  async function dispatch(params: Record<string, unknown>) {
    const method = ORCHESTRATION_METHODS.find((m) => m.name === 'orchestration.dispatch')
    if (!method) {
      throw new Error('orchestration.dispatch not registered')
    }
    buildRegistry([method])
    return await method.handler({ run: runId, from: 'term_coord', ...params }, ctx)
  }

  it('refuses to inject into a TUI that enabled bracketed paste and has no composer yet', async () => {
    setup()
    const task = db.createTask({ spec: 'work', runId })
    mockComposerReadiness({ ready: false, state: 'awaiting-composer', waitedMs: 30_000 })
    const send = mockSend({ accepted: false, evidence: null, waitedMs: 0 })

    await expect(dispatch({ task: task.id, to: WORKER, inject: true })).rejects.toThrow(
      'composer never became ready'
    )

    // Nothing reached the pane, and the refusal landed before createDispatchContext
    // so the Task is still retryable rather than parked as `dispatched` forever.
    expect(send).not.toHaveBeenCalled()
    expect(db.getTask(task.id)?.status).toBe('ready')
    expect(db.getActiveDispatchForTerminal(WORKER)).toBeUndefined()
  })

  it('injects when the composer marker already fired on this pane', async () => {
    setup()
    const task = db.createTask({ spec: 'work', runId })
    mockComposerReadiness({ ready: true, proven: true, state: 'ready', waitedMs: 3 })
    const send = mockSend({ accepted: true, evidence: 'working-title', waitedMs: 40 })

    const result = (await dispatch({ task: task.id, to: WORKER, inject: true })) as {
      injected: boolean
      turnAcceptance: AgentTurnAcceptance
    }

    expect(result.injected).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.turnAcceptance).toMatchObject({ accepted: true, evidence: 'working-title' })
  })

  // Why: `dispatch --inject` is how a stalled run is rescued today, and it
  // targets a long-established pane whose bracketed-paste enable this runtime
  // may never have seen (adopted after a restart, gapped stream). Absence of
  // evidence must not become a refusal.
  it('injects into a pane whose readiness cannot be observed', async () => {
    setup()
    const task = db.createTask({ spec: 'work', runId })
    mockComposerReadiness({ ready: true, proven: false, state: 'unobserved' })
    const send = mockSend({ accepted: false, evidence: null, waitedMs: 5_000 })

    const result = (await dispatch({ task: task.id, to: WORKER, inject: true })) as {
      injected: boolean
    }

    expect(result.injected).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not gate a tracking dispatch that injects nothing', async () => {
    setup()
    const task = db.createTask({ spec: 'work', runId })
    const readiness = vi.spyOn(runtime, 'waitForAgentComposerReady')

    const result = (await dispatch({ task: task.id, to: WORKER })) as { injected: boolean }

    expect(result.injected).toBe(false)
    expect(readiness).not.toHaveBeenCalled()
  })

  it('arms the first-signal deadline on the write, not on turn acceptance', async () => {
    setup()
    const task = db.createTask({ spec: 'work', runId })
    mockComposerReadiness({ ready: true, proven: true, state: 'ready' })
    // Why: the deadline must not depend on an observation that is advisory by
    // construction — an unconfirmed turn still gets a monitored dispatch.
    mockSend({ accepted: false, evidence: null, waitedMs: 5_000 })

    await dispatch({ task: task.id, to: WORKER, inject: true })

    expect(db.countArmedDispatchDeadlines()).toBe(1)
  })

  it('records turn acceptance without disarming the deadline', async () => {
    setup()
    const task = db.createTask({ spec: 'work', runId })
    mockComposerReadiness({ ready: true, proven: true, state: 'ready' })
    mockSend({ accepted: true, evidence: 'interrupt-affordance', waitedMs: 120 })

    await dispatch({ task: task.id, to: WORKER, inject: true })

    const ctxRow = db.getDispatchContext(task.id)
    expect(ctxRow?.turn_accepted_at).not.toBeNull()
    // A screen transition is not an authenticated lifecycle signal from the
    // worker, so it must leave the deadline armed.
    expect(ctxRow?.first_lifecycle_signal_at).toBeNull()
    expect(db.countArmedDispatchDeadlines()).toBe(1)
  })
})
