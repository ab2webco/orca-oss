import { describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/types'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { pickClaudeQuotaFallbackAccountId } from './claude-quota-fallback-account'

const account = (id: string): ClaudeManagedAccount => ({ id }) as ClaudeManagedAccount

const limits = (sessionUsed: number, status: ProviderRateLimits['status'] = 'ok') =>
  ({
    status,
    session: {
      usedPercent: sessionUsed,
      windowMinutes: 300,
      resetsAt: null,
      resetDescription: null
    },
    weekly: null
  }) as ProviderRateLimits

const inactive = (accountId: string, rateLimits: ProviderRateLimits | null) => ({
  accountId,
  rateLimits,
  updatedAt: 0,
  isFetching: false
})

describe('pickClaudeQuotaFallbackAccountId', () => {
  const accounts = [account('a'), account('b'), account('c')]

  it('skips excluded, exhausted and unread accounts', () => {
    const picked = pickClaudeQuotaFallbackAccountId({
      accounts,
      activeAccountId: null,
      rateLimits: {
        claude: null,
        inactiveClaudeAccounts: [
          inactive('a', limits(10)),
          inactive('b', limits(100)),
          inactive('c', null)
        ]
      },
      excludedAccountIds: ['a']
    })
    expect(picked).toBeNull()
  })

  it('reads the active account from the live reading and others from the inactive list', () => {
    const rateLimits = {
      claude: limits(20),
      inactiveClaudeAccounts: [inactive('b', limits(100)), inactive('c', limits(40))]
    }
    const pick = (excludedAccountIds: string[]) =>
      pickClaudeQuotaFallbackAccountId({
        accounts,
        activeAccountId: 'a',
        rateLimits,
        excludedAccountIds
      })
    expect(pick([])).toBe('a')
    expect(pick(['a'])).toBe('c')
  })

  it('ignores a reading that is not ok', () => {
    expect(
      pickClaudeQuotaFallbackAccountId({
        accounts: [account('b')],
        activeAccountId: null,
        rateLimits: { claude: null, inactiveClaudeAccounts: [inactive('b', limits(0, 'error'))] },
        excludedAccountIds: []
      })
    ).toBeNull()
  })
})
