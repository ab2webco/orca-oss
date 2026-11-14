import { describe, expect, it } from 'vitest'
import { accountMemberNamesOf } from './account-member-names'

const member = (displayName: string | null, account?: Record<string, unknown>) => ({
  displayName,
  isLeader: false,
  isMember: true,
  ...(account ? { account } : {})
})

const lead = (agents: unknown[]) => ({ role: 'lead', agents })

const MAYA = { provider: 'claude', id: 'acc-maya', email: 'maya@acme.dev' }
const LEO = { provider: 'claude', id: 'acc-leo', email: 'leo@acme.dev' }

describe('accountMemberNamesOf', () => {
  it("names every member across the host's leads that runs on the account", () => {
    const states = [
      lead([member('Merlín', MAYA), member('Mago', LEO)]),
      lead([member('Arquera', MAYA)])
    ]

    expect(accountMemberNamesOf(states, 'claude', { id: 'acc-maya' })).toEqual([
      'Merlín',
      'Arquera'
    ])
    expect(accountMemberNamesOf(states, 'claude', { id: 'acc-leo' })).toEqual(['Mago'])
  })

  it("puts the lead first when the host names the lead's own account, and never guesses it otherwise", () => {
    const named = [{ ...lead([member('Merlín', MAYA)]), leadAccount: MAYA }]
    const older = [lead([member('Merlín', MAYA)])]

    expect(accountMemberNamesOf(named, 'claude', { id: 'acc-maya' })).toEqual(['Lead', 'Merlín'])
    expect(accountMemberNamesOf(named, 'claude', { id: 'acc-leo' })).toEqual([])
    expect(accountMemberNamesOf(older, 'claude', { id: 'acc-maya' })).toEqual(['Merlín'])
  })

  it('names no member of another provider, an unnamed member or one with no account', () => {
    const states = [
      lead([
        member('Codex', { provider: 'codex', id: 'acc-maya', email: 'maya@acme.dev' }),
        member(null, MAYA),
        member('Global')
      ])
    ]

    expect(accountMemberNamesOf(states, 'claude', { id: 'acc-maya' })).toEqual([])
  })

  it('reads nothing from an answer that is not a lead with a team', () => {
    expect(accountMemberNamesOf([{ role: 'member' }, null], 'claude', { id: 'acc-maya' })).toEqual(
      []
    )
  })
})
