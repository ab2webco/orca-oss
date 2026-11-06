import { describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import {
  assertRefreshChainNotHeldByOtherAccount,
  ClaudeRefreshChainAliasError,
  organizationIdentifiesOneAccount
} from './claude-refresh-chain-ownership'

function account(
  id: string,
  organizationUuid: string | null,
  authMethod: ClaudeManagedAccount['authMethod'] = 'subscription-oauth'
): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@example.com`,
    managedAuthPath: `/vaults/${id}/auth`,
    authMethod,
    organizationUuid,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

const blob = (refreshToken: string): string => JSON.stringify({ claudeAiOauth: { refreshToken } })

describe('assertRefreshChainNotHeldByOtherAccount', () => {
  const accounts = [account('a', null), account('b', null)]
  const stored = new Map([
    ['a', blob('chain-a')],
    ['b', blob('chain-b')]
  ])
  const read = async (other: ClaudeManagedAccount): Promise<string | null> =>
    stored.get(other.id) ?? null

  it('throws when another account currently holds the chain', async () => {
    await expect(
      assertRefreshChainNotHeldByOtherAccount('a', blob('chain-b'), accounts, read)
    ).rejects.toBeInstanceOf(ClaudeRefreshChainAliasError)
  })

  it('allows the account own chain and a fresh chain', async () => {
    await expect(
      assertRefreshChainNotHeldByOtherAccount('a', blob('chain-a'), accounts, read)
    ).resolves.toBeUndefined()
    await expect(
      assertRefreshChainNotHeldByOtherAccount('a', blob('chain-new'), accounts, read)
    ).resolves.toBeUndefined()
  })

  it('does not let an unreadable account block the write', async () => {
    const failing = async (other: ClaudeManagedAccount): Promise<string | null> => {
      if (other.id === 'b') {
        throw new Error('locked')
      }
      return stored.get(other.id) ?? null
    }
    await expect(
      assertRefreshChainNotHeldByOtherAccount('a', blob('chain-b'), accounts, failing)
    ).resolves.toBeUndefined()
  })

  it('never puts token material in the error', async () => {
    const error = await assertRefreshChainNotHeldByOtherAccount(
      'a',
      blob('chain-b'),
      accounts,
      read
    ).catch((caught: unknown) => caught)
    expect(String(error)).not.toContain('chain-b')
  })
})

describe('organizationIdentifiesOneAccount', () => {
  const readOrg = (other: ClaudeManagedAccount): string | null => other.organizationUuid ?? null

  it('is false when another account shares the organization', () => {
    const accounts = [account('a', 'org-1'), account('b', 'ORG-1')]
    expect(organizationIdentifiesOneAccount('a', 'org-1', accounts, readOrg)).toBe(false)
  })

  it('ignores custom-endpoint accounts and other organizations', () => {
    const accounts = [
      account('a', 'org-1'),
      account('b', 'org-2'),
      account('z', 'org-1', 'custom-endpoint')
    ]
    expect(organizationIdentifiesOneAccount('a', 'org-1', accounts, readOrg)).toBe(true)
  })
})
