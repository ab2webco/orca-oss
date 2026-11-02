import { describe, expect, it } from 'vitest'
import {
  GAME_CLAUDE_ACCOUNTS_MAX,
  gameClaudeAccountsUsageOf
} from './orchestrator-game-claude-usage'
import type { ProviderRateLimits } from './rate-limit-types'

const window = (usedPercent: number) => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt: null,
  resetDescription: null
})
const limits = (session: number, weekly: number | null): ProviderRateLimits => ({
  provider: 'claude',
  session: window(session),
  weekly: weekly === null ? null : window(weekly),
  updatedAt: 1,
  error: null,
  status: 'ok'
})
const account = (id: string) => ({ id, email: `${id}@example.com` })

describe('gameClaudeAccountsUsageOf', () => {
  it('reads the active account live and the others from their cached readings, active first', () => {
    expect(
      gameClaudeAccountsUsageOf(
        { accounts: [account('b'), account('a')], activeAccountId: 'a' },
        {
          claude: limits(41, 12),
          inactiveClaudeAccounts: [
            { accountId: 'b', rateLimits: limits(90, 70), updatedAt: 1, isFetching: false }
          ]
        }
      )
    ).toEqual([
      { email: 'a@example.com', active: true, sessionPercent: 41, weeklyPercent: 12 },
      { email: 'b@example.com', active: false, sessionPercent: 90, weeklyPercent: 70 }
    ])
  })

  it('leaves out an account with no good reading', () => {
    expect(
      gameClaudeAccountsUsageOf(
        { accounts: [account('a'), account('b')], activeAccountId: 'a' },
        {
          claude: { ...limits(1, 1), status: 'error' },
          inactiveClaudeAccounts: []
        }
      )
    ).toEqual([])
  })

  it('keeps the busiest accounts by weekly use when there are too many', () => {
    const ids = Array.from({ length: GAME_CLAUDE_ACCOUNTS_MAX + 2 }, (_, index) => `x${index}`)
    const usage = gameClaudeAccountsUsageOf(
      { accounts: ids.map(account), activeAccountId: null },
      {
        claude: null,
        inactiveClaudeAccounts: ids.map((id, index) => ({
          accountId: id,
          rateLimits: limits(0, index),
          updatedAt: 1,
          isFetching: false
        }))
      }
    )
    expect(usage).toHaveLength(GAME_CLAUDE_ACCOUNTS_MAX)
    expect(usage[0].weeklyPercent).toBe(GAME_CLAUDE_ACCOUNTS_MAX + 1)
    expect(usage.some((one) => one.email === 'x0@example.com')).toBe(false)
  })
})
