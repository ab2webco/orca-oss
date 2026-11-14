import { describe, expect, it } from 'vitest'
import type { AccountsSnapshot } from '../components/accounts-snapshot'
import { hostAccountLineOf } from './host-account-line'

function snapshot(overrides: {
  activeAccountId?: string | null
  session?: { usedPercent: number } | null
}): AccountsSnapshot {
  return {
    claude: {
      accounts: [
        { id: 'acc-1', email: 'dev@example.com' },
        { id: 'acc-2', email: 'other@example.com' }
      ],
      activeAccountId: overrides.activeAccountId === undefined ? 'acc-1' : overrides.activeAccountId
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude:
        overrides.session === undefined
          ? null
          : {
              provider: 'claude',
              session: overrides.session && {
                usedPercent: overrides.session.usedPercent,
                windowMinutes: 300,
                resetsAt: null,
                resetDescription: null
              },
              weekly: null
            },
      codex: null,
      claudeTarget: 'host',
      codexTarget: 'host',
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  } as unknown as AccountsSnapshot
}

describe('hostAccountLineOf', () => {
  it('names the active Claude account and its 5 h percentage', () => {
    expect(hostAccountLineOf(snapshot({ session: { usedPercent: 38.4 } }))).toEqual({
      email: 'dev@example.com',
      fiveHourPercent: 38
    })
  })

  it('has no 5 h percentage while the session window is not reported', () => {
    expect(hostAccountLineOf(snapshot({ session: null }))).toEqual({
      email: 'dev@example.com',
      fiveHourPercent: null
    })
  })

  it('has no line when no Claude account is active', () => {
    expect(hostAccountLineOf(snapshot({ activeAccountId: null, session: null }))).toBeNull()
  })
})
