import { describe, expect, it } from 'vitest'
import type { AccountListEntry } from './managed-account-list-entries'
import { newTabAccountOptionsOf } from './new-tab-account-options'

const failedAuth = (accountId: string): AccountListEntry['auth'] => ({
  accountId,
  state: 'failed',
  checkedAt: 1,
  failure: null,
  undecided: null,
  undecidedAt: null,
  checking: false
})

function entry(id: string, patch: Partial<AccountListEntry> = {}): AccountListEntry {
  return {
    provider: 'claude',
    id,
    email: `${id}@example.test`,
    active: false,
    runtime: 'host',
    wslDistro: null,
    authMethod: 'subscription-oauth',
    quota: null,
    ...patch
  }
}

// Why (ORCA-717): the + menu reads the same account list `orca account list` and the lead read.
describe('newTabAccountOptionsOf', () => {
  it("keeps only this provider's accounts on this host", () => {
    const options = newTabAccountOptionsOf({
      entries: [
        entry('acct-a'),
        entry('acct-codex', { provider: 'codex' }),
        entry('acct-wsl', { runtime: 'wsl' })
      ],
      provider: 'claude',
      members: []
    })

    expect(options.map((option) => option.usage.id)).toEqual(['acct-a'])
  })

  it('marks a custom endpoint and a failed Claude sign-in, but not a failed one on a long-lived token', () => {
    const options = newTabAccountOptionsOf({
      entries: [
        entry('acct-glm', { authMethod: 'custom-endpoint' }),
        entry('acct-broken', { auth: failedAuth('acct-broken') }),
        entry('acct-token', { auth: failedAuth('acct-token'), longLivedToken: true })
      ],
      provider: 'claude',
      members: []
    })

    expect(
      options.map(({ usage, customEndpoint, failedLogin }) => [
        usage.id,
        customEndpoint,
        failedLogin
      ])
    ).toEqual([
      ['acct-glm', true, false],
      ['acct-broken', false, true],
      ['acct-token', false, false]
    ])
  })

  it("tags an account with the tickets of the team's members on it, matched by email", () => {
    const options = newTabAccountOptionsOf({
      entries: [entry('acct-a'), entry('acct-b')],
      provider: 'claude',
      members: [
        { provider: 'claude', email: 'ACCT-A@example.test', ticket: 'NETSA-121' },
        { provider: 'codex', email: 'acct-b@example.test', ticket: 'NETSA-9' }
      ]
    })

    expect(options.map((option) => [option.usage.id, option.usage.members])).toEqual([
      ['acct-a', ['NETSA-121']],
      ['acct-b', []]
    ])
  })
})
