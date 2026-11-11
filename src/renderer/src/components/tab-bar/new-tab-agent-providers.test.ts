import { describe, expect, it } from 'vitest'
import type { RuntimeAccountsSnapshot } from '../../../../shared/managed-account-list-entries'
import { newTabAgentProvidersOf } from './new-tab-agent-providers'

const now = Date.parse('2026-11-10T12:00:00Z')

function snapshot(): RuntimeAccountsSnapshot {
  const account = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    email: `${id}@example.test`,
    managedAuthPath: '/vault',
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...patch
  })
  return {
    claude: {
      accounts: [
        account('acct-a'),
        account('acct-glm', { authMethod: 'custom-endpoint', endpointLabel: 'Claude GLM' })
      ],
      activeAccountId: 'acct-a'
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  } as unknown as RuntimeAccountsSnapshot
}

// Why (ORCA-717): the rows read the same snapshot as `orca account list`, checked on today's account.
describe('newTabAgentProvidersOf', () => {
  it('checks the worktree pin over the global selection, and lists every host account', () => {
    const { providers } = newTabAgentProvidersOf({
      snapshot: snapshot(),
      pins: { claude: 'acct-glm', codex: null },
      members: [],
      now
    })

    expect(providers.claude?.resolvedId).toBe('acct-glm')
    expect(providers.claude?.choice).toMatchObject({
      kind: 'picker',
      rows: [{ id: 'acct-a' }, { id: 'acct-glm', otherModel: true }]
    })
  })

  it('falls back to the global selection with no pin, and to own login with no accounts', () => {
    const { providers } = newTabAgentProvidersOf({
      snapshot: snapshot(),
      pins: { claude: null, codex: null },
      members: [],
      now
    })

    expect(providers.claude?.resolvedId).toBe('acct-a')
    expect(providers.codex?.choice).toEqual({ kind: 'own-login' })
  })

  it('names an account by its endpoint label, then its email, and no account as the system login', () => {
    const { labelOf } = newTabAgentProvidersOf({
      snapshot: snapshot(),
      pins: { claude: null, codex: null },
      members: [],
      now
    })

    expect(labelOf('claude', 'acct-glm')).toBe('Claude GLM')
    expect(labelOf('claude', 'acct-a')).toBe('acct-a@example.test')
    expect(labelOf('claude', null)).toBe('System login')
  })

  it('leaves a provider unloaded when its half of the snapshot failed', () => {
    const { providers } = newTabAgentProvidersOf({
      snapshot: snapshot(),
      failedProviders: ['claude'],
      pins: { claude: null, codex: null },
      members: [],
      now
    })

    expect(providers.claude).toBeNull()
  })
})
