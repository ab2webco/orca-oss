import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_MOVE_HANDLERS } from './orchestrator-game-move'
import type { RuntimeClient } from '../runtime-client'

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const HOUR = 3_600_000

const limits = (session: number, resetsAt = NOW + 2 * HOUR) => ({
  provider: 'claude',
  status: 'ok',
  session: { usedPercent: session, windowMinutes: 300, resetsAt, resetDescription: null },
  weekly: {
    usedPercent: 10,
    windowMinutes: 10080,
    resetsAt: NOW + 72 * HOUR,
    resetDescription: null
  },
  updatedAt: NOW,
  error: null
})

const usage = (accountId: string, rateLimits: ReturnType<typeof limits>) => ({
  accountId,
  rateLimits,
  updatedAt: NOW,
  isFetching: false
})

function snapshotWith(cy: ReturnType<typeof limits>) {
  return {
    claude: {
      accounts: [
        { id: 'acct_ana', email: 'ana@example.com' },
        { id: 'acct_cy', email: 'cy@example.com' }
      ],
      activeAccountId: null
    },
    codex: {
      accounts: [
        { id: 'acct_bo', email: 'bo@example.com' },
        { id: 'acct_di', email: 'di@example.com' }
      ],
      activeAccountId: null
    },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: [usage('acct_ana', limits(100)), usage('acct_cy', cy)],
      inactiveCodexAccounts: [
        usage('acct_bo', { ...limits(100), provider: 'codex' }),
        usage('acct_di', { ...limits(5), provider: 'codex' })
      ]
    }
  }
}

const member = (agentType: string, account: { provider: string; id: string; email: string }) => ({
  paneKey: 'm1',
  displayName: 'CIN-5 Stuck',
  agentType,
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_m1',
  worktree: { id: 'repo::/w/cin-5', branch: 'cin-5', displayName: 'cin-5' },
  account,
  limit: { resetsAt: NOW + 2 * HOUR }
})

const CLAUDE_MEMBER = member('claude', {
  provider: 'claude',
  id: 'acct_ana',
  email: 'ana@example.com'
})
const CODEX_MEMBER = member('codex', { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' })

const stateWith = (agent: unknown) => ({
  config: {},
  agents: [agent],
  worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
  lead: { autostart: false, cap: 4, agent: 'claude' }
})

function fakeClient(state: unknown, snapshot: unknown) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'accounts.snapshot': snapshot,
    'accounts.list': snapshot,
    'terminal.show': { terminal: { handle: 'term_m1' } },
    'accounts.switchClaudeTerminal': {
      accepted: true,
      acceptance: null,
      result: {
        operationId: 'op1',
        state: 'committed',
        terminal: 'term_m1',
        ptyId: 'pty1',
        sourceAccountId: 'acct_ana',
        targetAccountId: 'acct_cy',
        sessionId: 's1'
      }
    },
    'orchestration.workerList': {
      workers: [
        {
          dispatchId: 'd7',
          taskId: 'task_7',
          runId: 'run_1',
          workerState: 'ready',
          agentTerminalHandle: 'term_m1',
          terminalState: 'retained',
          resource: { worktreeId: 'repo::/w/cin-5' }
        }
      ]
    },
    'orchestration.workerStop': {
      dispatchId: 'd7',
      state: 'stopped',
      processAction: 'closed_agent_terminal'
    },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_7',
      dispatchId: 'd8',
      state: 'ready'
    }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  const methods = () => calls.map(([method]) => method)
  const paramsOf = (method: string) => calls.find(([one]) => one === method)?.[1]
  return { client, methods, paramsOf }
}

const move = (client: RuntimeClient, flags: [string, string | boolean][] = []) =>
  ORCHESTRATOR_GAME_MOVE_HANDLERS['game move']({
    flags: new Map([['ticket', 'cin-5'], ...flags]),
    client,
    cwd: '/repo',
    json: true
  })

describe('orca game move', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it("switches a Claude member's own terminal in place to the freest other account", async () => {
    const { client, methods, paramsOf } = fakeClient(
      stateWith(CLAUDE_MEMBER),
      snapshotWith(limits(10))
    )

    await move(client)

    expect(methods()).not.toContain('orchestration.workerStop')
    expect(paramsOf('accounts.switchClaudeTerminal')).toEqual(
      expect.objectContaining({ terminal: 'term_m1', targetAccountId: 'acct_cy' })
    )
  })

  it('relaunches a Codex member in its own worktree on another account, linked to the old dispatch', async () => {
    const { client, methods, paramsOf } = fakeClient(
      stateWith(CODEX_MEMBER),
      snapshotWith(limits(10))
    )

    await move(client)

    expect(methods()).toEqual(
      expect.arrayContaining(['orchestration.workerStop', 'orchestration.workerStart'])
    )
    expect(paramsOf('orchestration.workerStop')).toEqual({ dispatch: 'd7' })
    expect(paramsOf('orchestration.workerStart')).toEqual(
      expect.objectContaining({
        task: 'task_7',
        retryOf: 'd7',
        worktree: 'id:repo::/w/cin-5',
        agent: 'codex',
        codexAccountId: 'acct_di',
        run: 'run_1'
      })
    )
    expect(printed()).toEqual(
      expect.objectContaining({
        ticket: 'CIN-5',
        moved: true,
        via: 'relaunch',
        from: 'bo@example.com',
        to: 'di@example.com',
        dispatchId: 'd8'
      })
    )
  })

  it('waits when every other account is limited too, and says when the first is back', async () => {
    const { client, methods } = fakeClient(
      stateWith(CLAUDE_MEMBER),
      snapshotWith(limits(100, NOW + 45 * 60_000))
    )

    await move(client)

    expect(methods()).not.toContain('accounts.switchClaudeTerminal')
    expect(printed()).toEqual(
      expect.objectContaining({
        ticket: 'CIN-5',
        moved: false,
        wait: expect.stringMatching(/in 45m/)
      })
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('plans without touching anything with --dry-run', async () => {
    const { client, methods } = fakeClient(stateWith(CODEX_MEMBER), snapshotWith(limits(10)))

    await move(client, [['dry-run', true]])

    expect(methods()).not.toContain('orchestration.workerStop')
    expect(printed()).toEqual(
      expect.objectContaining({ moved: false, via: 'relaunch', to: 'di@example.com', dryRun: true })
    )
  })

  it('tells a remote member to move with --on instead of switching a terminal here (ORCA-798)', async () => {
    const remote = {
      ...CLAUDE_MEMBER,
      paneKey: 'remote:ctx_a',
      remote: { host: 'imac', stateKnown: true }
    }
    const { client, methods } = fakeClient(stateWith(remote), snapshotWith(limits(10)))

    await expect(move(client, [['account', 'cy@example.com']])).rejects.toThrow(
      /CIN-5 runs on imac; move it with --on <host> --repo/
    )
    expect(methods()).not.toContain('accounts.switchClaudeTerminal')
  })

  it('plans a move to another host with --on and --repo without touching anything (ORCA-798)', async () => {
    const { client, methods } = fakeClient(stateWith(CLAUDE_MEMBER), snapshotWith(limits(10)))

    await move(client, [
      ['on', 'm1'],
      ['repo', 'name:cineco'],
      ['dry-run', true]
    ])

    expect(printed()).toMatchObject({ ticket: 'CIN-5', moved: false, via: 'host', to: 'm1' })
    expect(methods()).toEqual(['game.state'])
  })

  it('refuses a ticket no member holds, and the account it already runs on', async () => {
    const missing = fakeClient(stateWith(CLAUDE_MEMBER), snapshotWith(limits(10)))
    await expect(move(missing.client, [['ticket', 'CIN-9']])).rejects.toThrow(
      /No member holds CIN-9/
    )

    const same = fakeClient(stateWith(CLAUDE_MEMBER), snapshotWith(limits(10)))
    await expect(move(same.client, [['account', 'ana@example.com']])).rejects.toThrow(
      /CIN-5 already runs on ana@example.com/
    )
  })
})
