import { describe, expect, it } from 'vitest'
import type { NewTabAccountChoice } from '../../../../shared/new-tab-account-choice'
import { agentRowAccountOf, type NewTabProviderAccounts } from './new-tab-agent-row-account'

const picker: NewTabAccountChoice = {
  kind: 'picker',
  defaultId: 'acct-free',
  rows: [
    {
      id: 'acct-pin',
      email: 'pin@example.test',
      disabled: null,
      inUseBy: [],
      otherModel: false,
      usedPercent: 40
    }
  ]
}
const claude: NewTabProviderAccounts = { choice: picker, resolvedId: 'acct-pin' }
const providers = { claude, codex: { choice: { kind: 'own-login' } as const, resolvedId: null } }

// Why (ORCA-717): each agent row says which login it launches on, and offers a picker only where one works.
describe('agentRowAccountOf', () => {
  it("offers Claude's picker checked on the account a plain launch resolves to, not the member pick", () => {
    expect(agentRowAccountOf({ agent: 'claude', local: true, providers })).toEqual({
      kind: 'picker',
      provider: 'claude',
      rows: picker.kind === 'picker' ? picker.rows : [],
      checkedId: 'acct-pin'
    })
  })

  it('uses the Claude accounts for a Claude Agent Teams row', () => {
    expect(
      agentRowAccountOf({ agent: 'claude-agent-teams', local: true, providers })
    ).toMatchObject({
      kind: 'picker',
      provider: 'claude'
    })
  })

  it('shows Own login for an agent Orca manages no accounts for, and for a provider with none', () => {
    expect(agentRowAccountOf({ agent: 'grok', local: true, providers })).toEqual({
      kind: 'own-login'
    })
    expect(agentRowAccountOf({ agent: 'codex', local: true, providers })).toEqual({
      kind: 'own-login'
    })
  })

  it("shows the host's login with no picker on SSH, paired or remote-runtime worktrees", () => {
    expect(agentRowAccountOf({ agent: 'claude', local: false, providers })).toEqual({
      kind: 'host-login'
    })
  })

  it('claims no login while the account list has not loaded', () => {
    expect(
      agentRowAccountOf({ agent: 'claude', local: true, providers: { claude: null, codex: null } })
    ).toEqual({ kind: 'loading' })
  })
})
