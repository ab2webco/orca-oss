import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/types'
import {
  inspectManagedClaudeRefreshChainAliases,
  reconcileManagedClaudeRefreshChainAliases,
  reportManagedClaudeRefreshChainAliases
} from './claude-refresh-chain-alias-registry'
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

  it('reconciles an eligible account when aliases are first inspected', async () => {
    const parentPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(parentPath)
    const rootPath = join(parentPath, 'managed-aliases')
    const readManagedCredentials = vi.fn(async () => credentials('deferred-chain'))

    const result = await inspectManagedClaudeRefreshChainAliases(
      'account-a',
      fingerprint('deferred-chain'),
      {
        rootPath,
        profilePath: '/profiles/orca',
        accounts: [account('account-a')],
        readManagedCredentials
      }
    )

    expect(result).toEqual({ status: 'unique' })
    expect(readManagedCredentials).toHaveBeenCalledOnce()
    expect(readdirSync(rootPath)).toHaveLength(1)
  })

  it('does not touch storage or credentials when no account is eligible', async () => {
    const parentPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(parentPath)
    const rootPath = join(parentPath, 'managed-aliases')
    const readManagedCredentials = vi.fn(async () => credentials('unused-chain'))

    await reconcileManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [{ ...account('account-a'), authMethod: 'custom-endpoint' }],
      readManagedCredentials
    })

    expect(readdirSync(parentPath)).toEqual([])
    expect(readManagedCredentials).not.toHaveBeenCalled()
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

  it('reports different-email accounts sharing one chain as a conflict set', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)

    await reconcileManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca-dev',
      accounts: [account('account-b', 'second@example.com')],
      readManagedCredentials: async () => credentials('shared-grant')
    })
    const report = await reportManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('account-a', 'first@example.com')],
      readManagedCredentials: async () => credentials('shared-grant')
    })

    expect(report).toMatchObject({
      status: 'available',
      conflictSets: [
        {
          conflictId: expect.any(String),
          certainty: 'recorded-chain-match',
          accounts: [
            {
              accountId: 'account-a',
              profileKey: expect.any(String),
              profileScope: 'current',
              email: 'first@example.com'
            },
            {
              accountId: 'account-b',
              profileKey: expect.any(String),
              profileScope: 'other',
              email: null
            }
          ],
          remediation: {
            action: 'reauthenticate-one-account',
            accountDirectoryPolicy: 'preserve'
          }
        }
      ]
    })
  })

  it('does not report same-email accounts backed by different chains', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)

    await reconcileManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca-dev',
      accounts: [account('account-b', 'same@example.com')],
      readManagedCredentials: async () => credentials('grant-b')
    })
    const report = await reportManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('account-a', 'same@example.com')],
      readManagedCredentials: async () => credentials('grant-a')
    })

    expect(report).toEqual({ status: 'available', conflictSets: [] })
  })

  it('identifies an unreadable cross-profile account by profile key and account id', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)

    await reconcileManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca-dev',
      accounts: [account('foreign-account', 'foreign@example.com')],
      readManagedCredentials: async () => credentials('shared-grant')
    })
    const report = await reportManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('local-account', 'local@example.com')],
      readManagedCredentials: async () => credentials('shared-grant')
    })
    const foreignAccount = report.conflictSets[0]?.accounts.find(
      (candidate) => candidate.profileScope === 'other'
    )

    expect(foreignAccount).toEqual({
      accountId: 'foreign-account',
      profileKey: expect.stringMatching(/^[a-f0-9]{24}$/),
      profileScope: 'other',
      email: null
    })
  })

  it('only reads credentials and preserves account data while reporting remediation', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'orca-claude-aliases-'))
    roots.push(rootPath)
    const readManagedCredentials = vi.fn(async () => credentials('shared-grant'))

    await reconcileManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca-dev',
      accounts: [account('account-b')],
      readManagedCredentials
    })
    const report = await reportManagedClaudeRefreshChainAliases({
      rootPath,
      profilePath: '/profiles/orca',
      accounts: [account('account-a')],
      readManagedCredentials
    })

    expect(readManagedCredentials).toHaveBeenCalledTimes(2)
    expect(report.conflictSets[0]?.remediation).toEqual({
      action: 'reauthenticate-one-account',
      accountDirectoryPolicy: 'preserve'
    })
  })
})
