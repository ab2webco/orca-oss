// Split from orchestrator-game-launch.test.ts, which reached the 800-line cap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { formatGameLaunch } from './orchestrator-game-launch-result'
import type { RuntimeClient } from '../runtime-client'
import {
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'

const TODO_ITEM = {
  id: 'CIN-12',
  title: 'Cartelera page',
  url: 'https://jira.example/browse/CIN-12',
  status: 'To Do'
}

function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: { reviews: null, todo: { provider: 'jira', total: 1, url: null, items: [TODO_ITEM] } },
    lead: { autostart: false, cap: 2, agent: 'claude', launchPrompt: 'Implement {id}: {title}' },
    ...overrides
  }
}

const ACCOUNTS = {
  claude: {
    accounts: [{ id: 'acct_ana', email: 'ana@example.com' }],
    activeAccountId: 'acct_ana'
  },
  codex: { accounts: [{ id: 'acct_bo', email: 'bo@example.com' }], activeAccountId: null },
  rateLimits: { claude: null, codex: null, inactiveClaudeAccounts: [], inactiveCodexAccounts: [] }
}

function fakeClient(
  state: unknown,
  run: { id: string } | null = { id: 'run_1' },
  overrides: Record<string, unknown> = {}
) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'worktree.list': { worktrees: [] },
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': {
      capabilities: [
        ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
        ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY
      ]
    },
    'orchestration.runCurrent': { run },
    'accounts.snapshot': ACCOUNTS,
    'orchestration.runCreate': { run: { id: 'run_new', objective: 'x' } },
    'orchestration.taskCreate': { task: { id: 'task_1', status: 'ready' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'dispatch_1',
      state: 'ready',
      effects: [],
      residualResources: []
    },
    ...overrides
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const launch = (client: RuntimeClient, ticket = 'cin-12', extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', ticket], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })

describe('orca game launch behind a running setup', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
    // Why: an Orca pane exports the host's ORCA_GAME_LOCALE; the names must not follow it.
    delete process.env.ORCA_GAME_LOCALE
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('queues the member behind a running setup and reports it as queued, not as a failure', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': {
        runId: 'run_1',
        taskId: 'task_1',
        state: 'queued',
        setupQueue: { position: 2, waitingOn: 'Ford · CIN-9' }
      }
    })

    await launch(client)

    expect(process.exitCode).toBeUndefined()
    expect(calls.findLast(([method]) => method === 'game.memberRecord')?.[1]).toEqual(
      expect.objectContaining({ member: { ticket: 'CIN-12', lastState: 'queued' } })
    )
    const launched = JSON.parse(output.join('')).result
    expect(launched).toEqual(
      expect.objectContaining({
        ticket: 'CIN-12',
        state: 'queued',
        setupQueue: { position: 2, waitingOn: 'Ford · CIN-9' }
      })
    )
    expect(formatGameLaunch(launched)).toBe(
      'CIN-12 (Arthur): queued #2 · claude · ana@example.com, waiting on Ford · CIN-9; it starts by itself\n' +
        'ana@example.com: no reading yet, the first Claude account (5h —, 7d —)'
    )
  })

  it('refuses a ticket already queued behind a setup, so it never gets a second member', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        queuedMembers: [{ ticket: 'CIN-12', name: null, position: 1, waitingOn: 'Ford · CIN-9' }]
      })
    )

    await expect(launch(client)).rejects.toThrow(
      'CIN-12 is queued #1, waiting on Ford · CIN-9; it starts by itself.'
    )
    expect(calls.map(([method]) => method)).toEqual(['game.state'])
  })

  it('says so when the connected Orca Lab cannot queue setups, and launches at once', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'status.get': { capabilities: [ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY] }
    })

    await launch(client)

    const start = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(start).not.toHaveProperty('setupAdmission')
    expect(String(stderr.mock.calls[0]?.[0])).toContain('This Orca Lab cannot queue member setups')
  })
})
