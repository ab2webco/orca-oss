import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import type { RuntimeClient } from '../runtime-client'

const NOW = Date.UTC(2026, 10, 5, 1, 0, 0)
const HOUR = 3_600_000

const limits = (session: number) => ({
  provider: 'claude',
  status: 'ok',
  session: {
    usedPercent: session,
    windowMinutes: 300,
    resetsAt: NOW + HOUR,
    resetDescription: null
  },
  weekly: {
    usedPercent: 10,
    windowMinutes: 10080,
    resetsAt: NOW + 72 * HOUR,
    resetDescription: null
  },
  updatedAt: NOW,
  error: null
})

const verdict = (id: string, state: string, loginEndsAt?: number) => ({
  accountId: `acct_${id}`,
  state,
  checkedAt: NOW,
  failure: state === 'failed' ? 'credential-rejected' : null,
  undecided: null,
  undecidedAt: null,
  checking: false,
  ...(loginEndsAt !== undefined ? { loginEndsAt } : {})
})

function snapshotWith(ids: string[], auth: ReturnType<typeof verdict>[]) {
  return {
    claude: {
      accounts: ids.map((id) => ({ id: `acct_${id}`, email: `${id}@example.com` })),
      activeAccountId: null
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: ids.map((id, index) => ({
        accountId: `acct_${id}`,
        rateLimits: limits(10 + index * 10),
        updatedAt: NOW,
        isFetching: false
      })),
      inactiveCodexAccounts: [],
      claudeAccountAuth: auth
    }
  }
}

function fakeClient(snapshot: unknown) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': {
      config: { mode: 'on' },
      agents: [],
      worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
      project: { reviews: null, todo: null },
      lead: { autostart: false, cap: 4, agent: 'claude', accounts: 'auto' }
    },
    'accounts.snapshot': snapshot,
    'accounts.list': snapshot,
    'worktree.list': { worktrees: [] },
    'terminal.show': { terminal: { handle: 'h1' } },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'orchestration.taskCreate': { task: { id: 'task_1' } },
    'game.stopSwitch': { stopped: null },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'd1',
      state: 'ready'
    }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  const starts = () =>
    calls.filter(([method]) => method === 'orchestration.workerStart').map(([, params]) => params)
  return { client, starts }
}

const launch = (client: RuntimeClient, extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', 'CIN-12'], ...extra]),
    client,
    cwd: '/repo',
    json: false
  })

describe('orca game launch on a Claude login that ended or ends soon', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('refuses a named account whose sign-in failed instead of launching a member that dies', async () => {
    const { client, starts } = fakeClient(
      snapshotWith(['scloud', 'cy'], [verdict('scloud', 'failed')])
    )

    await expect(launch(client, [['account', 'scloud@example.com']])).rejects.toThrow(
      /scloud@example\.com's sign-in failed on this host.*Not logged in/
    )
    expect(starts()).toEqual([])
  })

  it('warns at launch when the named login ends within 3 days', async () => {
    const { client, starts } = fakeClient(
      snapshotWith(['cy'], [verdict('cy', 'authenticated', NOW + 20 * HOUR)])
    )

    await launch(client, [['account', 'cy@example.com']])

    expect(starts()).toEqual([expect.objectContaining({ claudeAccountId: 'acct_cy' })])
    expect(output.join('\n')).toMatch(/cy@example\.com's sign-in ends in 20 h .*cannot be renewed/)
  })

  it('warns when auto picks a login that ends within 3 days, and stays quiet otherwise', async () => {
    const soon = fakeClient(snapshotWith(['cy'], [verdict('cy', 'authenticated', NOW + 50 * HOUR)]))
    await launch(soon.client)
    expect(output.join('\n')).toMatch(/cy@example\.com's sign-in ends in 2 days/)

    output = []
    const later = fakeClient(
      snapshotWith(['cy'], [verdict('cy', 'authenticated', NOW + 80 * HOUR)])
    )
    await launch(later.client)
    expect(later.starts()).toHaveLength(1)
    expect(output.join('\n')).not.toMatch(/sign-in ends/)
  })
})
