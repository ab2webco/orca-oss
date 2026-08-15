import { describe, expect, it } from 'vitest'
import { formatAccountList, type AccountListReport } from './account-format'

const terminal: AccountListReport['terminal'] = {
  ownership: { state: 'none' },
  terminal: null,
  ptyId: null
}

function report(auth: AccountListReport['accounts'][number]['auth']): AccountListReport {
  return {
    terminal,
    accounts: [
      {
        provider: 'claude',
        id: 'acct_1',
        email: 'account@example.com',
        active: false,
        runtime: 'host',
        wslDistro: null,
        quota: null,
        auth
      }
    ]
  }
}

describe('formatAccountList auth verdict', () => {
  it('formats a credential rejection', () => {
    expect(
      formatAccountList(
        report({
          accountId: 'acct_1',
          state: 'failed',
          checkedAt: 1,
          failure: 'credential-rejected',
          undecided: null,
          undecidedAt: null,
          checking: false
        })
      )
    ).toContain('auth: FAILED (credential rejected)')
  })

  it('formats a verified credential', () => {
    expect(
      formatAccountList(
        report({
          accountId: 'acct_1',
          state: 'authenticated',
          checkedAt: 1,
          failure: null,
          undecided: null,
          undecidedAt: null,
          checking: false
        })
      )
    ).toContain('auth: verified')
  })

  it('formats an account that has not been checked', () => {
    expect(formatAccountList(report(null))).toContain('auth: not checked')
  })
})
