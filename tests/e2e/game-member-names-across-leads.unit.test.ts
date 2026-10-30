import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from '../../src/main/runtime/orca-runtime'
import { GAME_TEST_ACCOUNTS } from '../../src/cli/handlers/orchestrator-game-fleet-test-fixtures'
import { RpcDispatcher } from '../../src/main/runtime/rpc/dispatcher'
import { ORCHESTRATOR_GAME_METHODS } from '../../src/main/runtime/rpc/methods/orchestrator-game'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from '../../src/cli/handlers/orchestrator-game-launch'
import { RuntimeClientError, type RuntimeClient } from '../../src/cli/runtime-client'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-member-names-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

const row = (paneKey: string, parentPaneKey: string | null, displayName: string | null) => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: null,
  displayName,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 0,
  updatedAt: 0
})

const worktree = (worktreeId: string, repoId: string, agents: ReturnType<typeof row>[]) => ({
  worktreeId,
  repoId,
  branch: worktreeId,
  displayName: worktreeId,
  agents
})

// Lead A has two live members, one in another repo (--repo); lead B in the same project sees neither.
const WORKTREES = [
  worktree('wt-lead-a', 'repo-1', [row('tab-a:lead', null, null)]),
  worktree('wt-orca-1', 'repo-1', [row('tab-m1:member', 'tab-a:lead', 'Arthur · ORCA-1 Home')]),
  worktree('wt-orca-3', 'repo-2', [row('tab-m3:member', 'tab-a:lead', 'Merlin · ORCA-3 API')]),
  worktree('wt-lead-b', 'repo-1', [row('tab-b:lead', null, null)]),
  worktree('wt-other', 'repo-9', [row('tab-o:member', 'tab-o:lead', 'Lancelot · OTH-1 Elsewhere')])
]

// Why the casts: these lookups are private, and real ones need live PTYs and hook events.
function projectRuntime(): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({ worktrees: WORKTREES } as never)
  const internals = runtime as unknown as {
    getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
  }
  vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
    new Map(
      WORKTREES.map((one) => [
        one.worktreeId,
        { id: one.worktreeId, repoId: one.repoId, path: userData.dir, branch: one.branch }
      ])
    )
  )
  return runtime
}

const ORCHESTRATION_RESULTS: Record<string, unknown> = {
  'worktree.list': { worktrees: [] },
  'terminal.show': { terminal: { handle: 'term_lead_b' } },
  'orchestration.runCurrent': { run: { id: 'run_b' } },
  'accounts.snapshot': GAME_TEST_ACCOUNTS,
  'orchestration.taskCreate': { task: { id: 'task_1' } },
  'orchestration.workerStart': {
    runId: 'run_b',
    taskId: 'task_1',
    dispatchId: 'd1',
    state: 'ready'
  }
}

// Why the real dispatcher: game.* goes through the host's own schemas and runtime, as the CLI's would.
function clientOn(runtime: OrcaRuntimeService): { client: RuntimeClient; started: string[] } {
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
  const started: string[] = []
  let request = 0
  const client = {
    call: async (method: string, params: Record<string, unknown>) => {
      if (method === 'orchestration.workerStart') {
        started.push(String(params.displayName))
      }
      if (!method.startsWith('game.')) {
        return { ok: true, result: ORCHESTRATION_RESULTS[method] }
      }
      request += 1
      const response = await dispatcher.dispatch({
        id: `r${request}`,
        authToken: 'test',
        method,
        params
      })
      if (!response.ok) {
        throw new RuntimeClientError(response.error.code, response.error.message)
      }
      return response
    }
  } as unknown as RuntimeClient
  return { client, started }
}

const launchFromLeadB = (client: RuntimeClient, ticket: string) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', ticket]]),
    client,
    cwd: userData.dir,
    json: true
  })

describe('member names across the leads of one project', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    process.env.ORCA_WORKTREE_ID = 'wt-lead-b'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead_b'
    process.env.ORCA_PANE_KEY = 'tab-b:lead'
    process.env.ORCA_GAME_LOCALE = 'en'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it("never gives lead B's member a name lead A's live members hold, in any of the project's repos", async () => {
    const { client, started } = clientOn(projectRuntime())

    await launchFromLeadB(client, 'ORCA-2')

    expect(started).toEqual(['Lancelot · ORCA-2'])
  })

  it('gives two launches at the same moment two different names', async () => {
    const { client, started } = clientOn(projectRuntime())

    await Promise.all([launchFromLeadB(client, 'ORCA-4'), launchFromLeadB(client, 'ORCA-5')])

    expect(new Set(started.map((name) => name.split(' · ')[0])).size).toBe(2)
    expect(started.every((name) => !/^(Arthur|Merlin) /.test(name))).toBe(true)
  })
})
