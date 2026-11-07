import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'

// ORCA-1116: every game launch path, not only new-child, nests the member under its lead.
describe('workerStart nests game members under the lead', () => {
  const coordinatorPaneKey = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let runId: string

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    runId = db.createRun({
      objective: 'Test game nesting',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey
    }).id
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord'
        ? coordinatorPaneKey
        : handle === 'term_worker'
          ? 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
          : null
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
      handle === 'term_worker' ? 'runtime_test:term_worker:1' : null
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
      handle: 'term_coord',
      worktreeId: 'repo::lead',
      status: 'running'
    } as never)
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
      id: 'repo::lead',
      repoId: 'repo'
    } as never)
    vi.spyOn(runtime, 'showRepo').mockResolvedValue({ id: 'repo', kind: 'git' } as never)
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::member',
      repoId: 'repo'
    } as never)
    vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_worker',
      surface: 'background'
    } as never)
    vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
      worktree: { id: 'repo::created', repoId: 'repo' },
      startupTerminal: { spawned: true, handle: 'term_worker' },
      setupReceipt: { requested: 'run', hookFound: false, state: 'not_configured' }
    } as never)
    vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
      terminals: [{ handle: 'term_worker', title: 'Claude' }],
      totalCount: 1,
      truncated: false
    } as never)
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'gameMemberBriefTargetFor').mockResolvedValue(null as never)
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_worker',
      accepted: true,
      bytesWritten: 1
    })
    vi.spyOn(runtime, 'waitForAgentComposerReady').mockResolvedValue({
      ready: true,
      proven: true,
      state: 'ready',
      signal: 'codex-composer-prompt',
      waitedMs: 1
    })
  })

  afterEach(() => {
    db.close()
  })

  async function startWorker(overrides: Record<string, unknown>) {
    const task = db.createTask({ spec: 'game member task', runId })
    const method = ORCHESTRATION_METHODS.find(
      (candidate) => candidate.name === 'orchestration.workerStart'
    )!
    const params = method.params!.parse({
      task: task.id,
      from: 'term_coord',
      agent: 'claude',
      ...overrides
    })
    return { result: await method.handler(params, { runtime }), task }
  }

  it('nests a member relaunched into its existing ticket worktree', async () => {
    const nest = vi.spyOn(runtime, 'nestGameMemberWorktree').mockResolvedValue(null)

    const { result, task } = await startWorker({ worktree: 'id:repo::member', game: true })

    expect(result).toMatchObject({ state: 'ready' })
    expect(nest).toHaveBeenCalledWith('repo::member', 'repo::lead', {
      taskId: task.id,
      runId,
      coordinatorHandle: 'term_coord'
    })
    expect(JSON.stringify(result)).not.toContain('lineage_unresolved')
  })

  it('nests a member a --repo launch created top-level', async () => {
    const nest = vi.spyOn(runtime, 'nestGameMemberWorktree').mockResolvedValue(null)

    await startWorker({ worktree: 'new-top-level', name: 'orca-1', game: true })

    expect(nest).toHaveBeenCalledWith('repo::created', 'repo::lead', expect.anything())
  })

  it('reports a member that cannot nest instead of leaving a silent top-level row', async () => {
    vi.spyOn(runtime, 'nestGameMemberWorktree').mockResolvedValue(
      'Parent worktree must belong to the same repository, execution host, and project.'
    )

    const { result } = await startWorker({ worktree: 'id:repo::member', game: true })

    expect(result).toMatchObject({ state: 'ready' })
    expect(result).toHaveProperty(
      'effects',
      expect.arrayContaining([
        {
          kind: 'worktree',
          action: 'lineage_unresolved',
          id: 'repo::member',
          warning:
            "Not nested under the lead's worktree: Parent worktree must belong to the same repository, execution host, and project."
        }
      ])
    )
  })

  it('still starts the member when nesting throws', async () => {
    vi.spyOn(runtime, 'nestGameMemberWorktree').mockRejectedValue(new Error('selector_not_found'))

    const { result } = await startWorker({ worktree: 'id:repo::member', game: true })

    expect(result).toMatchObject({ state: 'ready' })
    expect(JSON.stringify(result)).toContain('selector_not_found')
  })

  it('leaves a plain orchestration worker where it was placed', async () => {
    const nest = vi.spyOn(runtime, 'nestGameMemberWorktree').mockResolvedValue(null)

    await startWorker({ worktree: 'id:repo::member' })

    expect(nest).not.toHaveBeenCalled()
  })
})
