import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { teamAccountWindowsOf } from './team-account-usage'

const account = { provider: 'claude' as const, email: 'dev@example.com', id: 'a1' }

const limits = (over: Partial<ProviderRateLimits> = {}): ProviderRateLimits => ({
  provider: 'claude',
  session: { usedPercent: 20, windowMinutes: 300, resetsAt: 5_000, resetDescription: null },
  weekly: { usedPercent: 12, windowMinutes: 10080, resetsAt: 9_000, resetDescription: null },
  updatedAt: 1,
  error: null,
  status: 'ok',
  ...over
})

describe('teamAccountWindowsOf', () => {
  it("reads both windows and their resets from Orca's own reading, as the status bar does", () => {
    expect(
      teamAccountWindowsOf({ ...account, usedPercent: 3, weeklyPercent: 4 }, limits())
    ).toEqual({
      session: { usedPercent: 20, resetsAt: 5_000 },
      weekly: { usedPercent: 12, resetsAt: 9_000 }
    })
  })

  it("falls back to the game's percents, with no reset, when this host holds no good reading", () => {
    const fallback = { ...account, usedPercent: 3, weeklyPercent: 4 }
    const expected = {
      session: { usedPercent: 3, resetsAt: null },
      weekly: { usedPercent: 4, resetsAt: null }
    }
    expect(teamAccountWindowsOf(fallback, null)).toEqual(expected)
    expect(teamAccountWindowsOf(fallback, limits({ status: 'error' }))).toEqual(expected)
  })

  it('leaves out a window nobody reports', () => {
    expect(teamAccountWindowsOf({ ...account, usedPercent: 3 }, null)).toEqual({
      session: { usedPercent: 3, resetsAt: null },
      weekly: null
    })
    expect(
      teamAccountWindowsOf({ ...account, usedPercent: null }, limits({ weekly: null }))
    ).toEqual({ session: { usedPercent: 20, resetsAt: 5_000 }, weekly: null })
  })
})
