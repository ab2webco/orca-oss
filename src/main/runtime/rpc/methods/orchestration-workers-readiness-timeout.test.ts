import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'

type StartResult = { state: string; failedStage?: string; lastError?: string }

// Why (ORCA-936): a Codex that started but went unrecognized failed the launch with a bare `timeout`.
describe('worker-start readiness timeout', () => {
  const coordinatorPaneKey = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let runId: string

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    runId = db.createRun({
      objective: 'Readiness timeout',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey
    }).id
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? coordinatorPaneKey : null
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
      handle: 'term_coord',
      worktreeId: 'repo::parent',
      status: 'running'
    } as never)
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
      id: 'repo::parent',
      repoId: 'repo'
    } as never)
    vi.spyOn(runtime, 'showRepo').mockResolvedValue({ id: 'repo', kind: 'git' } as never)
    vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
      worktree: { id: 'repo::created', repoId: 'repo' },
      startupTerminal: { spawned: true, handle: 'term_worker' },
      setupReceipt: {
        requested: 'run',
        hookFound: false,
        startupPolicy: 'start-immediately',
        state: 'not_configured'
      }
    } as never)
    vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
      terminals: [{ handle: 'term_worker', title: 'worktree-a' }],
      totalCount: 1,
      truncated: false
    } as never)
    vi.spyOn(runtime, 'waitForTerminal').mockRejectedValue(new Error('timeout'))
    vi.spyOn(runtime, 'readTerminal').mockResolvedValue({
      handle: 'term_worker',
      status: 'running',
      tail: [' >_ OpenAI Codex (v0.166.0)', '› Ask Codex to do anything'],
      truncated: false,
      nextCursor: null
    })
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  async function startWorker(): Promise<StartResult> {
    const task = db.createTask({ spec: 'codex task', runId })
    const method = ORCHESTRATION_METHODS.find(
      (candidate) => candidate.name === 'orchestration.workerStart'
    )
    if (!method) {
      throw new Error('workerStart method is not registered')
    }
    const params = method.params!.parse({
      task: task.id,
      from: 'term_coord',
      worktree: 'new-child',
      name: 'codex-worker',
      agent: 'codex',
      timeoutMs: 60_000
    })
    return (await method.handler(params, { runtime })) as StartResult
  }

  it('says the agent started but was not recognized, with its version', async () => {
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt')

    const result = await startWorker()

    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'failed', failedStage: 'agent_readiness' })
    expect(result.lastError).toBe(
      'agent_not_recognized: codex started (v0.166.0) but Orca did not recognize its ready prompt within 60s. Nothing was typed into the terminal.'
    )
  })

  it('keeps the timeout when no agent owns the pane', async () => {
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(false)

    const result = await startWorker()

    expect(result).toMatchObject({ state: 'failed', lastError: 'timeout' })
  })
})
