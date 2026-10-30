import { describe, expect, it } from 'vitest'
import { accountLimitsOf, gameMemberLimitOf } from './orchestrator-game-member-limit'
import type { ProviderRateLimits } from './rate-limit-types'

const NOW = 1_000_000
const HOUR = 3_600_000

const limits = (session: number, resetsAt: number | null = NOW + HOUR): ProviderRateLimits => ({
  provider: 'claude',
  status: 'ok',
  session: { usedPercent: session, windowMinutes: 300, resetsAt, resetDescription: null },
  weekly: {
    usedPercent: 10,
    windowMinutes: 10080,
    resetsAt: NOW + 48 * HOUR,
    resetDescription: null
  },
  updatedAt: NOW,
  error: null
})

const LIMIT_TEXT = "You've hit your usage limit · resets 3pm"

describe('gameMemberLimitOf', () => {
  it("is limited until the reset when the member's account is exhausted and it stopped", () => {
    expect(
      gameMemberLimitOf({
        state: 'idle',
        agentType: 'claude',
        accountLimits: limits(100),
        terminalTail: null,
        now: NOW
      })
    ).toEqual({ resetsAt: NOW + HOUR })
  })

  it('is limited when its terminal says so and its account is not known to have quota', () => {
    expect(
      gameMemberLimitOf({
        state: 'waiting',
        agentType: 'codex',
        accountLimits: null,
        terminalTail: LIMIT_TEXT,
        now: NOW
      })
    ).toEqual({ resetsAt: null })
  })

  it('ignores old limit text once its account has quota again, and a member still working', () => {
    expect(
      gameMemberLimitOf({
        state: 'idle',
        agentType: 'claude',
        accountLimits: limits(20),
        terminalTail: LIMIT_TEXT,
        now: NOW
      })
    ).toBeNull()
    expect(
      gameMemberLimitOf({
        state: 'working',
        agentType: 'claude',
        accountLimits: limits(100),
        terminalTail: LIMIT_TEXT,
        now: NOW
      })
    ).toBeNull()
  })

  it('keeps a spend limit while its 5h and 7d windows still have quota, which they do not count', () => {
    expect(
      gameMemberLimitOf({
        state: 'idle',
        agentType: 'claude',
        accountLimits: limits(20),
        terminalTail:
          "You've hit your individual spend limit · your weekly limit resets Nov 2 · /usage-credits",
        now: NOW
      })
    ).toEqual({ resetsAt: null, spend: true })
  })

  // Why (ORCA-907): a member whose account logged out sat idle while its account read as free.
  it('is logged out when the last lines of a stopped member say its account must log in again', () => {
    const tail = (said: string) =>
      [...Array(30).fill('work'), said, '> ', '  status line'].join('\n')
    const of = (said: string, state: 'idle' | 'working' = 'idle', agentType = 'claude') =>
      gameMemberLimitOf({
        state,
        agentType,
        accountLimits: limits(20),
        terminalTail: tail(said),
        now: NOW
      })
    expect(of('Not logged in · Please run /login')).toEqual({ resetsAt: null, loggedOut: true })
    expect(of('OAuth token has expired · Please run /login')).toEqual({
      resetsAt: null,
      loggedOut: true
    })
    expect(of('Not logged in · Please run /login', 'working')).toBeNull()
    expect(of('Not logged in · Please run /login', 'idle', 'gemini')).toBeNull()
    expect(of('Fixed the login page')).toBeNull()
    expect(
      gameMemberLimitOf({
        state: 'idle',
        agentType: 'claude',
        accountLimits: null,
        terminalTail: ['Not logged in · Please run /login', ...Array(30).fill('later work')].join(
          '\n'
        ),
        now: NOW
      })
    ).toBeNull()
  })

  it('never calls a context or token limit a usage limit, nor an agent with no managed accounts', () => {
    expect(
      gameMemberLimitOf({
        state: 'idle',
        agentType: 'claude',
        accountLimits: null,
        terminalTail: 'Context limit reached',
        now: NOW
      })
    ).toBeNull()
    expect(
      gameMemberLimitOf({
        state: 'idle',
        agentType: 'gemini',
        accountLimits: null,
        terminalTail: LIMIT_TEXT,
        now: NOW
      })
    ).toBeNull()
  })
})

describe('accountLimitsOf', () => {
  it("reads the active account's limits, else its cached inactive reading", () => {
    const active = limits(50)
    const inactive = limits(70)
    const state = {
      claude: active,
      codex: null,
      inactiveClaudeAccounts: [
        { accountId: 'acct_b', rateLimits: inactive, updatedAt: NOW, isFetching: false }
      ],
      inactiveCodexAccounts: []
    }
    expect(accountLimitsOf(state, 'claude', 'acct_b', 'acct_a')).toBe(inactive)
    expect(accountLimitsOf(state, 'claude', 'acct_a', 'acct_a')).toBe(active)
    expect(accountLimitsOf(state, 'codex', 'acct_x', null)).toBeNull()
  })
})
