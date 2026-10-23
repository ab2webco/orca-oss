import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'

// A game member is typed one line naming its brief; every other worker keeps the full preamble (ORCA-757).
describe('worker-start dispatch brief', () => {
  const coordinatorPaneKey = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let runId: string
  const paths: string[] = []

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    runId = db.createRun({
      objective: 'Test new-worktree workers',
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
      worktreeId: 'repo::parent',
      status: 'running'
    } as never)
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
      id: 'repo::parent',
      repoId: 'repo'
    } as never)
    vi.spyOn(runtime, 'showRepo').mockResolvedValue({
      id: 'repo',
      kind: 'git'
    } as never)
    vi.spyOn(runtime, 'createTerminal')
    vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
      terminals: [{ handle: 'term_worker', title: 'Codex' }],
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
    vi.spyOn(runtime, 'waitForSetupTerminalCompletion').mockReturnValue(
      new Promise(() => undefined)
    )
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_worker',
      accepted: true,
      bytesWritten: 1
    })
    // Why (ORCA-208): the healthy path is a proven composer, and the
    // `dispatch_input` effect now reports `accepted` only there. Tests about
    // setup gating should not have to reason about readiness; the two that do
    // override this.
    vi.spyOn(runtime, 'waitForAgentComposerReady').mockResolvedValue({
      ready: true,
      proven: true,
      state: 'ready',
      signal: 'codex-composer-prompt',
      waitedMs: 42
    })
  })

  afterEach(() => {
    db.close()
    for (const path of paths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  async function startWorker(overrides: Record<string, unknown> = {}) {
    const task = db.createTask({ spec: 'new-worktree task', runId })
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
      name: 'new-worker',
      agent: 'codex',
      ...overrides
    })
    const result = await method.handler(params, { runtime })
    return { result, task }
  }

  function mockCreatedWorktree(options?: {
    hookFound?: boolean
    startupPolicy?: 'start-immediately' | 'wait-for-setup'
    state?: 'running' | 'skipped' | 'not_configured' | 'spawn_failed'
    terminals?: { handle: string; title: string }[]
    setupTerminalHandle?: string
  }) {
    const hookFound = options?.hookFound ?? true
    const state = options?.state ?? (hookFound ? 'running' : 'not_configured')
    vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
      worktree: { id: 'repo::created', repoId: 'repo' },
      startupTerminal: { spawned: true, handle: 'term_worker' },
      setupReceipt: {
        requested: state === 'skipped' ? 'skip' : 'run',
        hookFound,
        startupPolicy: options?.startupPolicy ?? 'start-immediately',
        state,
        terminalHandle:
          options?.setupTerminalHandle ??
          options?.terminals?.find((terminal) => terminal.title === 'Setup')?.handle
      }
    } as never)
    if (options?.terminals) {
      vi.mocked(runtime.listTerminals).mockResolvedValue({
        terminals: options.terminals,
        totalCount: options.terminals.length,
        truncated: false
      } as never)
    }
  }

  const workspace = () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-worker-brief-'))
    paths.push(dir)
    return dir
  }
  const typed = () => vi.mocked(runtime.sendTerminalAgentPrompt).mock.calls[0]?.[1] ?? ''

  it("types a game member one line and leaves the preamble in its worktree's brief", async () => {
    mockCreatedWorktree()
    const path = workspace()
    const target = vi
      .spyOn(runtime, 'gameMemberBriefTargetFor')
      .mockResolvedValue({ path, connectionId: null })

    const { task } = await startWorker({ game: true })

    const dispatch = db.getDispatchContext(task.id)!
    expect(target).toHaveBeenCalledWith('repo::created')
    expect(typed()).toBe(
      `Read your Orca Lab brief at .orca/briefs/${dispatch.id}.md (task ${task.id}) and follow it.`
    )
    const brief = readFileSync(join(path, '.orca/briefs', `${dispatch.id}.md`), 'utf8')
    expect(brief).toMatch(/--dispatch-capability dcap_[A-Za-z0-9_-]+/)
    expect(brief).toContain(`--task-id ${task.id} --dispatch-id ${dispatch.id}`)
    expect(brief).toContain('=== TASK ===')
  })

  it('types the full preamble to a worker that is not a game member', async () => {
    mockCreatedWorktree()
    const target = vi.spyOn(runtime, 'gameMemberBriefTargetFor')

    await startWorker()

    expect(target).not.toHaveBeenCalled()
    expect(typed()).toMatch(/^You are working inside Orca Lab/)
    expect(typed()).toMatch(/--dispatch-capability dcap_/)
  })

  it('types the full preamble when the project keeps its members plain', async () => {
    mockCreatedWorktree()
    vi.spyOn(runtime, 'gameMemberBriefTargetFor').mockResolvedValue(null)

    await startWorker({ game: true })

    expect(typed()).toMatch(/^You are working inside Orca Lab/)
  })

  it('types the full preamble into a terminal Orca did not start, whose cwd it cannot vouch for', async () => {
    const target = vi
      .spyOn(runtime, 'gameMemberBriefTargetFor')
      .mockResolvedValue({ path: workspace(), connectionId: null })
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::parent',
      repoId: 'repo'
    } as never)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)

    await startWorker({
      game: true,
      worktree: 'current',
      terminal: 'term_worker',
      agent: undefined,
      name: undefined
    })

    expect(target).not.toHaveBeenCalled()
    expect(typed()).toMatch(/^You are working inside Orca Lab/)
  })
})
