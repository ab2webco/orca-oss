import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/types'
import { inspectManagedClaudeRefreshChainAliases } from './claude-refresh-chain-alias-registry'
import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'

const roots: string[] = []

function account(id: string, email = 'developer@example.com'): ClaudeManagedAccount {
  return {
    id,
    email,
    managedAuthPath: join(tmpdir(), id, 'auth'),
    managedAuthRuntime: 'host',
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

function credentials(refreshToken: string): string {
  return JSON.stringify({ claudeAiOauth: { refreshToken } })
}

function fingerprint(value: string) {
  const result = fingerprintClaudeRefreshChain(credentials(value))
  if (!result) {
    throw new Error('Test refresh token must be fingerprintable.')
  }
  return result
}

describe('Claude refresh-chain alias registry', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks cross-profile accounts sharing one chain for manual remediation', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)
    const shared = credentials('shared-chain')

    await inspectManagedClaudeRefreshChainAliases('account-a', fingerprint('shared-chain'), {
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('account-a', 'first@example.com')],
      readManagedCredentials: async () => shared
    })
    await inspectManagedClaudeRefreshChainAliases('account-b', fingerprint('shared-chain'), {
      rootPath,
      profilePath: '/profiles/orca-dev',
      accounts: [account('account-b', 'second@example.com')],
      readManagedCredentials: async () => shared
    })
    const result = await inspectManagedClaudeRefreshChainAliases(
      'account-a',
      fingerprint('shared-chain'),
      {
        rootPath,
        profilePath: '/profiles/orca',
        accounts: [account('account-a', 'first@example.com')],
        readManagedCredentials: async () => shared
      }
    )

    expect(result).toEqual({
      status: 'alias-conflict',
      accountIds: ['account-a', 'account-b']
    })
  })

  it('preserves same-email accounts backed by independent grants', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)

    await inspectManagedClaudeRefreshChainAliases('account-a', fingerprint('grant-a'), {
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('account-a')],
      readManagedCredentials: async () => credentials('grant-a')
    })
    const result = await inspectManagedClaudeRefreshChainAliases(
      'account-b',
      fingerprint('grant-b'),
      {
        rootPath,
        profilePath: '/profiles/orca-dev',
        accounts: [account('account-b')],
        readManagedCredentials: async () => credentials('grant-b')
      }
    )

    expect(result).toEqual({ status: 'unique' })
  })

  it('persists only a bounded chain key, never the full SHA-256 digest', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)
    const chainKey = fingerprint('persisted-chain')

    await inspectManagedClaudeRefreshChainAliases('account-a', chainKey, {
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('account-a')],
      readManagedCredentials: async () => credentials('persisted-chain')
    })

    const profileDirectory = join(rootPath, readdirSync(rootPath)[0]!)
    const record = readFileSync(join(profileDirectory, readdirSync(profileDirectory)[0]!), 'utf8')
    expect(chainKey).toHaveLength(32)
    expect(record).not.toContain('persisted-chain')
    expect(JSON.parse(record)).toMatchObject({ chainKey })
  })
})
