import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'
import { createIsolatedTestProfilePath } from './claude-service-test-profile'

const TEST_ROOT = createIsolatedTestProfilePath('orca-claude-service-chain-alias-test')

vi.mock('electron', () => ({ app: { getPath: () => TEST_ROOT } }))
vi.mock('../codex-cli/command', () => ({
  resolveClaudeCommand: vi.fn(() => 'claude'),
  resolveCliCommandOrNull: vi.fn(() => 'claude')
}))
vi.mock('../startup/hydrate-shell-path', () => ({
  hydrateShellPath: vi.fn(async () => ({ ok: false, segments: [], failureReason: 'disabled' })),
  mergePathSegments: vi.fn((segments: string[]) => segments)
}))
vi.mock('./keychain', () => ({
  deleteActiveClaudeKeychainCredentialsStrict: vi.fn(async () => {}),
  deleteManagedClaudeKeychainCredentials: vi.fn(async () => {}),
  readActiveClaudeKeychainCredentials: vi.fn(),
  readActiveClaudeKeychainCredentialsStrict: vi.fn(),
  readManagedClaudeKeychainCredentials: vi.fn(),
  writeActiveClaudeKeychainCredentials: vi.fn(async () => {}),
  writeManagedClaudeKeychainCredentials: vi.fn(async () => {})
}))

function credentials(refreshToken: string): string {
  return `${JSON.stringify({ claudeAiOauth: { accessToken: `${refreshToken}-access`, refreshToken } })}\n`
}

function createVault(accountId: string, credentialsJson: string): string {
  const managedAuthPath = join(TEST_ROOT, 'claude-accounts', accountId, 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  writeFileSync(join(managedAuthPath, '.credentials.json'), credentialsJson, 'utf-8')
  writeFileSync(join(managedAuthPath, 'oauth-account.json'), '{}\n', 'utf-8')
  return managedAuthPath
}

function account(id: string, email: string, managedAuthPath: string) {
  return {
    id,
    email,
    managedAuthPath,
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

describe('ClaudeAccountService refresh-chain ownership (ORCA-1039)', () => {
  beforeEach(() => {
    setPlatform('linux')
    resetClaudeKeychainMocks()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  afterEach(() => {
    restorePlatform()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('refuses a re-authentication that captured another account chain', async () => {
    const pathA = createVault('account-a', credentials('chain-a'))
    const pathB = createVault('account-b', credentials('chain-b'))
    let settings = {
      claudeManagedAccounts: [
        account('account-a', 'a@example.com', pathA),
        account('account-b', 'b@example.com', pathB)
      ],
      activeClaudeManagedAccountId: null
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      })
    }
    const runtimeAuth = {
      clearLastWrittenCredentialsJson: vi.fn(),
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      evictInactiveClaudeCache: vi.fn(),
      clearClaudeAccountAuthVerdict: vi.fn(),
      getActiveClaudeSessionModel: vi.fn(() => null),
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )
    // The login reported B's identity, but the captured blob is A's live chain.
    ;(
      service as unknown as { runClaudeLoginAndCapture: () => Promise<unknown> }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: credentials('chain-a'),
      oauthAccount: {},
      identity: { email: 'b@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount('account-b')).rejects.toThrow(/refresh chain/)

    expect(readFileSync(join(pathB, '.credentials.json'), 'utf-8')).toBe(credentials('chain-b'))
    expect(readFileSync(join(pathA, '.credentials.json'), 'utf-8')).toBe(credentials('chain-a'))
  })
})
