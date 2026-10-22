import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { WorkerSetupAdmission } from '../../orchestration/worker-setup-admission'
import { ORCHESTRATION_METHODS } from './orchestration'

type SetupState = 'running' | 'not_configured' | 'skipped' | 'spawn_failed'

describe('orchestration worker setup queue (ORCA-746)', () => {
  const coordinatorPaneKey = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let runId: string
  let setupState: SetupState
  let setupWaiters: Map<string, (() => void)[]>
  let created: number

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    runId = db.createRun({
      objective: 'Setup queue',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey
    }).id
    setupState = 'running'
    setupWaiters = new Map()
    created = 0
    vi.spyOn(runtime, 'getWorkerSetupAdmission').mockReturnValue(
      new WorkerSetupAdmission({
        readMemory: async () => ({
          totalMemory: 16,
          availableMemory: 16,
          swapTotal: null,
          swapUsed: null,
          kernelLevel: null,
          source: 'fallback',
          readAt: 0
        })
      })
    )
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord'
        ? coordinatorPaneKey
        : `tab_${handle}:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation(
      (handle) => `runtime_test:${handle}:1`
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
    vi.spyOn(runtime, 'createManagedWorktree').mockImplementation(async () => {
      created += 1
      return {
        worktree: { id: `repo::w${created}`, repoId: 'repo' },
        startupTerminal: { spawned: true, handle: `term_w${created}` },
        setupReceipt: {
          requested: setupState === 'skipped' ? 'skip' : 'run',
          hookFound: setupState !== 'not_configured',
          startupPolicy: 'start-immediately',
          state: setupState,
          terminalHandle: setupState === 'running' ? `term_setup${created}` : undefined
        }
      } as never
    })
    vi.spyOn(runtime, 'listTerminals').mockImplementation(
      async () =>
        ({
          terminals: [
            { handle: `term_w${created}`, title: 'Codex' },
            ...(setupState === 'running'
              ? [{ handle: `term_setup${created}`, title: 'Setup' }]
              : [])
          ],
          totalCount: 2,
          truncated: false
        }) as never
    )
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_w1',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'waitForSetupTerminalCompletion').mockImplementation(
      (handle) =>
        new Promise((resolve) => {
          setupWaiters.set(handle, [
            ...(setupWaiters.get(handle) ?? []),
            () => resolve({ exitCode: 0 })
          ])
        })
    )
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_w1',
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

  afterEach(() => db.close())

  async function startWorker(name: string, overrides: Record<string, unknown> = {}) {
    const task = db.createTask({ spec: `task ${name}`, runId })
    const method = ORCHESTRATION_METHODS.find((one) => one.name === 'orchestration.workerStart')!
    const params = method.params!.parse({
      task: task.id,
      from: 'term_coord',
      worktree: 'new-child',
      name,
      displayName: name.toUpperCase(),
      agent: 'codex',
      setupAdmission: 'queue',
      ...overrides
    })
    const result = (await method.handler(params, { runtime })) as Record<string, unknown>
    return { result, task }
  }

  const finishSetup = (handle: string): void => {
    for (const resolve of setupWaiters.get(handle) ?? []) {
      resolve()
    }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('starts four members one setup at a time and says the rest are queued', async () => {
    const started = await Promise.all(['a', 'b', 'c', 'd'].map((name) => startWorker(name)))

    expect(started.map(({ result }) => result.state)).toEqual([
      'ready',
      'queued',
      'queued',
      'queued'
    ])
    expect(started[2].result).toMatchObject({
      runId,
      taskId: started[2].task.id,
      setupQueue: { position: 2, waitingOn: 'A' }
    })
    expect(started[1].result).not.toHaveProperty('dispatchId')
    // Why: no dispatch while queued, so a restart leaves a ready task the lead can relaunch.
    expect(db.getDispatchContext(started[1].task.id)).toBeUndefined()
    expect(db.getTask(started[1].task.id)?.status).toBe('ready')
    expect(created).toBe(1)

    finishSetup('term_setup1')
    await vi.waitFor(() => expect(created).toBe(2))
    await settle()
    expect(created).toBe(2)
    await vi.waitFor(() =>
      expect(db.getDispatchContext(started[1].task.id)?.status).toBe('dispatched')
    )

    finishSetup('term_setup2')
    await vi.waitFor(() => expect(created).toBe(3))
  })

  it.each<SetupState>(['not_configured', 'skipped', 'spawn_failed'])(
    'frees the slot at once when the new worktree runs no setup (%s)',
    async (state) => {
      setupState = state
      await startWorker('a').catch(() => undefined)
      const second = await startWorker('b').catch(() => undefined)

      expect(second?.result.state).not.toBe('queued')
      expect(created).toBe(2)
    }
  )

  it('frees the slot when the worktree cannot be created', async () => {
    vi.mocked(runtime.createManagedWorktree).mockRejectedValueOnce(new Error('disk full'))
    const first = await startWorker('a')
    const second = await startWorker('b')

    expect(first.result.state).toBe('failed')
    expect(second.result.state).toBe('ready')
  })

  it('tells the lead when a queued start fails once it runs', async () => {
    await startWorker('a')
    const queued = await startWorker('b')
    vi.mocked(runtime.createManagedWorktree).mockRejectedValueOnce(new Error('disk full'))

    finishSetup('term_setup1')
    await vi.waitFor(() =>
      expect(db.getInbox(10).map((one) => one.subject)).toContain(
        'Queued start of B failed: disk full'
      )
    )
    expect(queued.result.state).toBe('queued')
  })

  it('leaves starts that do not ask for the queue alone', async () => {
    const started = await Promise.all(
      ['a', 'b'].map((name) => startWorker(name, { setupAdmission: undefined }))
    )

    expect(started.map(({ result }) => result.state)).toEqual(['ready', 'ready'])
  })
})
