import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameAgent, OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { RpcContext } from '../core'
import { ORCHESTRATION_METHODS } from './orchestration'
import { ORCHESTRATOR_GAME_METHODS } from './orchestrator-game'

const COORD_PANE = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKER_PANE = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const merged = {
  provider: 'github' as const,
  number: 41,
  title: 'Cartelera',
  url: 'https://github.com/o/r/pull/41',
  state: 'merged' as const,
  ci: 'success' as const
}

const lead: GameAgent = {
  paneKey: COORD_PANE,
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_coord'
}

const memberOf = (overrides: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: WORKER_PANE,
  displayName: 'ORCA-41 Cartelera',
  agentType: 'codex',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_worker',
  review: merged,
  // Why: the turn that sent worker_done ends right after it.
  stateSince: Date.now(),
  ...overrides
})

// Why: the owner saw finished members stay in the Panel and fleet for hours, holding slots (ORCA-864).
describe('a lead game state releases a local member whose work landed (ORCA-864)', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let postEvent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const worker = (handle: string) => handle === 'term_worker'
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? COORD_PANE : worker(handle) ? WORKER_PANE : null
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
      worker(handle) ? 'runtime_test:term_worker:1' : null
    )
    vi.spyOn(runtime, 'getOrchestrationDispatchAuthority').mockImplementation((handle) =>
      worker(handle)
        ? ({
            terminalHandle: handle,
            paneKey: WORKER_PANE,
            processIncarnation: 'runtime_test:term_worker:1',
            hostScope: { kind: 'local', hostId: 'local' }
          } as never)
        : null
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockImplementation(
      async (handle) => ({ handle, worktreeId: 'repo::worktree', status: 'running' }) as never
    )
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::worktree'
    } as never)
    vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_worker',
      worktreeId: 'repo::worktree',
      title: 'worker'
    })
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_worker',
      accepted: true,
      bytesWritten: 1
    })
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    vi.spyOn(runtime, 'getExactWorkerProviderSession').mockReturnValue(null)
    vi.spyOn(runtime, 'readTerminal').mockResolvedValue({
      handle: 'term_worker',
      status: 'running',
      tail: ['done'],
      truncated: false,
      nextCursor: '1'
    })
    vi.spyOn(runtime, 'closeTerminal').mockResolvedValue({
      handle: 'term_worker',
      closed: true
    } as never)
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    ;(
      runtime as unknown as { inspectTerminalProcessIncarnationLiveness: () => Promise<string> }
    ).inspectTerminalProcessIncarnationLiveness = async () => 'live'
    postEvent = vi.fn().mockResolvedValue({ posted: true })
    vi.spyOn(runtime, 'getGameBoard').mockReturnValue({ postEvent } as never)
    ctx = { runtime }
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  async function call(methods: typeof ORCHESTRATION_METHODS, name: string, params: unknown) {
    const method = methods.find((one) => one.name === name)!
    return method.handler(method.params ? method.params.parse(params) : undefined, ctx)
  }

  async function startMember(reportWorkerDone: boolean): Promise<string> {
    const runId = db.createRun({
      objective: 'game',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: COORD_PANE
    }).id
    const task = db.createTask({ spec: 'ORCA-41', runId })
    const { dispatchId } = (await call(ORCHESTRATION_METHODS, 'orchestration.workerStart', {
      task: task.id,
      from: 'term_coord',
      agent: 'codex'
    })) as { dispatchId: string }
    if (reportWorkerDone) {
      db.settleWorkerReport({ taskId: task.id, dispatchId, outcome: 'succeeded', result: 'done' })
    }
    return dispatchId
  }

  async function leadReads(member: GameAgent): Promise<OrchestratorGameState> {
    vi.spyOn(runtime, 'getOrchestratorGameState').mockResolvedValue({
      role: 'lead',
      agents: [lead, member]
    } as OrchestratorGameState)
    return (await call(ORCHESTRATOR_GAME_METHODS, 'game.state', {
      worktreeId: 'wt-lead',
      paneKey: COORD_PANE
    })) as OrchestratorGameState
  }

  it('closes its terminal, drops its row and posts one line for the lead', async () => {
    const dispatchId = await startMember(true)

    const state = await leadReads(memberOf())

    expect(state.agents.map((agent) => agent.paneKey)).toEqual([COORD_PANE])
    await vi.waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1))
    expect(runtime.closeTerminal).toHaveBeenCalledWith('term_worker')
    expect(db.getWorkerTerminalResourceByOwner(dispatchId)?.release_state).toBe('released')
    expect(postEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-lead',
        kind: 'stopped',
        ticket: 'ORCA-41',
        key: `auto-release:${dispatchId}`,
        text: 'Released automatically: PR #41 merged after worker_done; its terminal closed.'
      })
    )
    await leadReads(memberOf())
    expect(postEvent).toHaveBeenCalledTimes(1)
  })

  it('never touches a member its live state reports working (ORCA-862)', async () => {
    await startMember(true)
    const request = vi.spyOn(db, 'requestWorkerTerminalRelease')

    const state = await leadReads(memberOf({ state: 'working' }))

    expect(state.agents).toHaveLength(2)
    expect(request).not.toHaveBeenCalled()
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
  })

  it('leaves a member whose PR merged but that never sent worker_done', async () => {
    await startMember(false)
    const request = vi.spyOn(db, 'requestWorkerTerminalRelease')

    const state = await leadReads(memberOf())

    expect(state.agents).toHaveLength(2)
    expect(request).not.toHaveBeenCalled()
  })

  // Why: a member chains its next PR after worker_done and sits idle while that PR's CI runs.
  it('never touches a member that worked past its worker_done on a chained PR', async () => {
    await startMember(true)
    const request = vi.spyOn(db, 'requestWorkerTerminalRelease')

    const laterTurn = await leadReads(
      memberOf({ state: 'idle', stateSince: Date.now() + 20 * 60_000 })
    )
    const nextPrOpen = await leadReads(
      memberOf({
        review: { ...merged, number: 42, state: 'open' },
        workItem: {
          provider: 'plane',
          identifier: 'ORCA-41',
          title: 'Cartelera',
          url: 'u',
          status: 'Done',
          statusGroup: 'done'
        }
      })
    )

    expect(laterTurn.agents).toHaveLength(2)
    expect(nextPrOpen.agents).toHaveLength(2)
    expect(request).not.toHaveBeenCalled()
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    expect(postEvent).not.toHaveBeenCalled()
  })

  it('keeps a member a human typed in, says why once, and does not retry', async () => {
    await startMember(true)
    db.markWorkerTerminalUserOwned(WORKER_PANE)

    await leadReads(memberOf())
    await vi.waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1))
    const again = await leadReads(memberOf())

    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    expect(again.agents).toHaveLength(2)
    expect(postEvent).toHaveBeenCalledTimes(1)
    expect(postEvent.mock.calls[0]?.[0].text).toMatch(
      /^Not released automatically \(PR #41 merged\): kept as user_takeover\. Someone typed/
    )
  })
})
