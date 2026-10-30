import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_ACCOUNTS_HANDLERS } from './orchestrator-game-accounts'
import type { RuntimeClient } from '../runtime-client'

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const HOUR = 3_600_000

const limits = (provider: string, session: number, weekly: number, resetsAt = NOW + 2 * HOUR) => ({
  provider,
  status: 'ok',
  session: { usedPercent: session, windowMinutes: 300, resetsAt, resetDescription: '2pm' },
  weekly: {
    usedPercent: weekly,
    windowMinutes: 10080,
    resetsAt: NOW + 50 * HOUR,
    resetDescription: 'Sat'
  },
  updatedAt: NOW,
  error: null
})

const SNAPSHOT = {
  claude: {
    accounts: [
      { id: 'acct_ana', email: 'ana@example.com', authMethod: 'oauth' },
      { id: 'acct_cy', email: 'cy@example.com' }
    ],
    activeAccountId: 'acct_ana'
  },
  codex: { accounts: [{ id: 'acct_bo', email: 'bo@example.com' }], activeAccountId: null },
  rateLimits: {
    claude: limits('claude', 100, 60, NOW + 90 * 60_000),
    codex: null,
    inactiveClaudeAccounts: [
      {
        accountId: 'acct_cy',
        rateLimits: limits('claude', 95, 20),
        updatedAt: NOW,
        isFetching: false
      }
    ],
    inactiveCodexAccounts: [
      {
        accountId: 'acct_bo',
        rateLimits: limits('codex', 10, 5),
        updatedAt: NOW,
        isFetching: false
      }
    ],
    claudeAccountAuth: [
      {
        accountId: 'acct_ana',
        state: 'authenticated',
        checkedAt: NOW,
        failure: null,
        undecided: null,
        undecidedAt: null,
        checking: false
      }
    ]
  }
}

const member = (paneKey: string, ticket: string, account: unknown) => ({
  paneKey,
  displayName: `${ticket} work`,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  account
})

const STATE = {
  config: {},
  agents: [
    member('m1', 'CIN-1', { provider: 'claude', id: 'acct_ana', email: 'ana@example.com' }),
    member('m2', 'CIN-2', { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' })
  ],
  worktree: null,
  lead: { autostart: false, cap: 4, agent: 'claude' }
}

function fakeClient(state: unknown = STATE) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'accounts.snapshot': SNAPSHOT,
    'accounts.list': SNAPSHOT
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, json: boolean, flags: [string, string | boolean][] = []) =>
  ORCHESTRATOR_GAME_ACCOUNTS_HANDLERS['game accounts']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game accounts', () => {
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('lists every account per provider with its 5h and 7d use, standing and members', async () => {
    const { client, calls } = fakeClient()

    await run(client, true)

    expect(calls.map(([method]) => method)).toEqual(['game.state', 'accounts.snapshot'])
    const report = JSON.parse(output.join('')).result
    expect(report.providers).toEqual([
      {
        provider: 'claude',
        accounts: [
          {
            id: 'acct_ana',
            email: 'ana@example.com',
            session: { usedPercent: 100, resetsAt: new Date(NOW + 90 * 60_000).toISOString() },
            weekly: { usedPercent: 60, resetsAt: new Date(NOW + 50 * HOUR).toISOString() },
            standing: 'limited',
            limited: true,
            usableAt: new Date(NOW + 90 * 60_000).toISOString(),
            members: ['CIN-1'],
            autoPick: true,
            memberStopped: false
          },
          expect.objectContaining({ email: 'cy@example.com', standing: 'near', limited: false })
        ],
        allLimited: true,
        nextUsableAt: new Date(NOW + 90 * 60_000).toISOString()
      },
      {
        provider: 'codex',
        accounts: [
          expect.objectContaining({ email: 'bo@example.com', standing: 'free', members: ['CIN-2'] })
        ],
        allLimited: false,
        nextUsableAt: null
      }
    ])
    expect(JSON.stringify(report)).not.toMatch(/auth|token|credential/i)
  })

  it('prints a table per provider and says when a limited provider is back', async () => {
    const { client } = fakeClient()

    await run(client, false)

    const text = output.join('\n')
    expect(text).toContain('Claude accounts (2)')
    expect(text).toMatch(
      /ana@example\.com\s+5h 100% \(in 1h 30m\)\s+7d 60% \(in 50h\)\s+limited\s+CIN-1/
    )
    expect(text).toMatch(/cy@example\.com\s+5h 95%.*near/)
    expect(text).toContain(
      'Every Claude account is at or near its limit; the first is usable again in 1h 30m'
    )
    expect(text).toMatch(/bo@example\.com\s+5h 10%.*free\s+CIN-2/)
  })

  it('shows an account whose member stopped on a spend limit as limited, with when it is back (ORCA-896)', async () => {
    const stopped = {
      ...member('m2', 'CIN-2', { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' }),
      state: 'idle',
      limit: { resetsAt: null, spend: true }
    }
    const { client } = fakeClient({ ...STATE, agents: [stopped] })

    await run(client, false)

    expect(output.join('\n')).toMatch(
      /bo@example\.com\s+5h 10%.*limited, member stopped on a limit, back at an unknown time\s+CIN-2/
    )
  })

  it('refreshes provider usage first with --refresh', async () => {
    const { client, calls } = fakeClient()

    await run(client, true, [['refresh', true]])

    expect(calls.map(([method]) => method)).toEqual(['game.state', 'accounts.list'])
    expect(calls[1]?.[1]).toEqual({ refreshUsage: true })
  })
})
