import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import type { RuntimeClient } from '../runtime-client'

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const HOUR = 3_600_000

const limits = (session: number, weekly: number, resetsAt = NOW + 2 * HOUR) => ({
  provider: 'claude',
  status: 'ok',
  session: { usedPercent: session, windowMinutes: 300, resetsAt, resetDescription: null },
  weekly: {
    usedPercent: weekly,
    windowMinutes: 10080,
    resetsAt: NOW + 72 * HOUR,
    resetDescription: null
  },
  updatedAt: NOW,
  error: null
})

const roster = (ids: string[]) =>
  ids.map((id) => ({ id: `acct_${id}`, email: `${id}@example.com` }))

function snapshotWith(usage: Record<string, ReturnType<typeof limits> | null>) {
  return {
    claude: { accounts: roster(Object.keys(usage)), activeAccountId: null },
    codex: { accounts: roster(['bo']), activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: Object.entries(usage).map(([id, rateLimits]) => ({
        accountId: `acct_${id}`,
        rateLimits,
        updatedAt: NOW,
        isFetching: false
      })),
      inactiveCodexAccounts: []
    }
  }
}

function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: { reviews: null, todo: null },
    lead: { autostart: false, cap: 4, agent: 'claude', accounts: 'auto' },
    ...overrides
  }
}

function fakeClient(state: unknown, snapshot: unknown, refreshed: unknown = snapshot) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'accounts.snapshot': snapshot,
    'accounts.list': refreshed,
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
  return { client, calls, starts }
}

const launch = (client: RuntimeClient, extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', 'CIN-12'], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })

describe('orca game launch with accounts: auto', () => {
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

  it('puts the member on the Claude account with the most free quota and says which', async () => {
    const { client, starts } = fakeClient(
      stateWith(),
      snapshotWith({ ana: limits(70, 40), cy: limits(10, 30), dee: null })
    )

    await launch(client)

    expect(starts()).toEqual([expect.objectContaining({ claudeAccountId: 'acct_cy' })])
    expect(JSON.parse(output.join('')).result).toEqual(
      expect.objectContaining({ agent: 'claude', account: 'cy@example.com' })
    )
  })

  it('takes --account auto when the project keeps the default', async () => {
    const { client, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude' } }),
      snapshotWith({ ana: limits(70, 40), cy: limits(10, 30) })
    )

    await launch(client, [['account', 'auto']])

    expect(starts()).toEqual([expect.objectContaining({ claudeAccountId: 'acct_cy' })])
  })

  it('picks the freest account when the project sets no accounts and no --account is given', async () => {
    const { client, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude' } }),
      snapshotWith({ ana: limits(70, 40), cy: limits(10, 30) })
    )

    await launch(client)

    expect(starts()).toEqual([expect.objectContaining({ claudeAccountId: 'acct_cy' })])
  })

  it('refuses rather than fall back to the global login while managed accounts exist', async () => {
    const snapshot = snapshotWith({ ana: limits(10, 10) })
    const failed = {
      ...snapshot,
      rateLimits: {
        ...snapshot.rateLimits,
        claudeAccountAuth: [{ accountId: 'acct_ana', state: 'failed' }]
      }
    }
    const { client, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude' } }),
      failed
    )

    await expect(launch(client)).rejects.toThrow(/global login.*--account/)
    expect(starts()).toEqual([])
  })

  it('launches on the global login with no managed account at all, and says so', async () => {
    const { client, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude' } }),
      snapshotWith({})
    )

    await ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
      flags: new Map([['ticket', 'CIN-12']]),
      client,
      cwd: '/repo',
      json: false
    })

    expect(starts()).toHaveLength(1)
    expect(starts()[0]).not.toHaveProperty('claudeAccountId')
    expect(output.join('\n')).toMatch(/CIN-12.*global login/s)
  })

  it('refuses a second member on the global login', async () => {
    const onGlobal = {
      paneKey: 'm1',
      displayName: 'CIN-1',
      agentType: 'claude',
      state: 'working',
      isLeader: false,
      isMember: true,
      globalLogin: true
    }
    const { client, starts } = fakeClient(
      stateWith({ agents: [onGlobal], lead: { autostart: false, cap: 4, agent: 'claude' } }),
      snapshotWith({})
    )

    await expect(launch(client)).rejects.toThrow(/CIN-1 already runs on the global login/)
    expect(starts()).toEqual([])
  })

  it('wave with no managed account launches one member on the global login and refuses the rest', async () => {
    const { client, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude' } }),
      snapshotWith({})
    )

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game wave']({
      flags: new Map([['tickets', 'CIN-1,CIN-2']]),
      client,
      cwd: '/repo',
      json: true
    })

    expect(starts()).toEqual([expect.objectContaining({ name: 'cin-1' })])
    expect(starts()[0]).not.toHaveProperty('claudeAccountId')
    const wave = JSON.parse(output.join('')).result
    expect(wave.launched).toEqual([expect.objectContaining({ ticket: 'CIN-1', globalLogin: true })])
    expect(wave.failed).toEqual([
      { ticket: 'CIN-2', error: expect.stringMatching(/CIN-1 already runs on the global login/) }
    ])
  })

  it('keeps the default account selection with accounts: default and no --account', async () => {
    const { client, calls, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude', accounts: 'default' } }),
      snapshotWith({ ana: limits(70, 40) })
    )

    await launch(client)

    expect(calls.map(([method]) => method)).not.toContain('accounts.snapshot')
    expect(starts()[0]).not.toHaveProperty('claudeAccountId')
  })

  it('refreshes usage once when an account has no reading yet, then picks on fresh data', async () => {
    const { client, calls, starts } = fakeClient(
      stateWith(),
      snapshotWith({ ana: limits(50, 40), cy: null }),
      snapshotWith({ ana: limits(50, 40), cy: limits(5, 5) })
    )

    await launch(client)

    expect(calls.filter(([method]) => method === 'accounts.list')).toEqual([
      ['accounts.list', { refreshUsage: true }]
    ])
    expect(starts()).toEqual([expect.objectContaining({ claudeAccountId: 'acct_cy' })])
  })

  it('spreads a tie by the members already running on each account', async () => {
    const running = {
      paneKey: 'm1',
      displayName: 'CIN-1',
      agentType: 'claude',
      state: 'working',
      isMember: true,
      account: { provider: 'claude', id: 'acct_ana', email: 'ana@example.com' }
    }
    const { client, starts } = fakeClient(
      stateWith({ agents: [running] }),
      snapshotWith({ ana: limits(20, 10), cy: limits(22, 10) })
    )

    await launch(client)

    expect(starts()).toEqual([expect.objectContaining({ claudeAccountId: 'acct_cy' })])
  })

  it('refuses when every account is at or near its limit, and says when the first is back', async () => {
    const { client, starts } = fakeClient(
      stateWith(),
      snapshotWith({ ana: limits(100, 40, NOW + 3 * HOUR), cy: limits(93, 30, NOW + 90 * 60_000) })
    )

    await expect(launch(client)).rejects.toThrow(
      /Every Claude account is at or near its limit.*in 1h 30m/
    )
    expect(starts()).toEqual([])
  })

  it('launches an agent with no managed accounts on its own login', async () => {
    const { client, calls, starts } = fakeClient(stateWith(), snapshotWith({ ana: limits(1, 1) }))

    await launch(client, [['agent', 'gemini']])

    expect(calls.map(([method]) => method)).not.toContain('accounts.snapshot')
    expect(starts()).toEqual([expect.objectContaining({ agent: 'gemini' })])
    expect(starts()[0]).not.toHaveProperty('claudeAccountId')
  })

  it('wave spreads the members it launches over equally free accounts', async () => {
    const { client, starts } = fakeClient(
      stateWith({ lead: { autostart: false, cap: 4, agent: 'claude' } }),
      snapshotWith({ ana: limits(10, 10), cy: limits(11, 10) })
    )

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game wave']({
      flags: new Map([['tickets', 'CIN-1,CIN-2']]),
      client,
      cwd: '/repo',
      json: true
    })

    expect(starts()).toEqual([
      expect.objectContaining({ name: 'cin-1', claudeAccountId: 'acct_ana' }),
      expect.objectContaining({ name: 'cin-2', claudeAccountId: 'acct_cy' })
    ])
  })
})
