import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'

const CLAUDE_SERVICE_TEST_ROOT = join(tmpdir(), 'orca-claude-service-identity-guards-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => CLAUDE_SERVICE_TEST_ROOT
  }
}))

const commandMocks = vi.hoisted(() => ({
  resolveClaudeCommand: vi.fn(() => 'claude'),
  resolveCliCommandOrNull: vi.fn(() => 'claude')
}))

vi.mock('../codex-cli/command', () => ({
  resolveClaudeCommand: commandMocks.resolveClaudeCommand,
  resolveCliCommandOrNull: commandMocks.resolveCliCommandOrNull
}))

// Why: the lab resolves the host `claude` binary through resolveHostClaudeCommand
// (shell-PATH hydration + resolveCliCommandOrNull); stub both so command tests do
// not spawn a real login shell.
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

describe('ClaudeAccountService identity guards', () => {
  let tempDir: string | null = null

  beforeEach(() => {
    setPlatform('darwin')
    tempDir = null
    resetClaudeKeychainMocks()
  })

  afterEach(() => {
    restorePlatform()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects reauthentication when the browser session returns a different identity', async () => {
    setPlatform('linux')
    tempDir = CLAUDE_SERVICE_TEST_ROOT
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(join(managedAuthPath, '.credentials.json'), '{"old":true}\n', 'utf-8')
    writeFileSync(join(managedAuthPath, 'oauth-account.json'), '{"oldOauth":true}\n', 'utf-8')
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'account-1',
          email: 'old@example.com',
          managedAuthPath,
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: 'account-1'
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
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {}),
      syncForCurrentSelection: vi.fn(async () => {})
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
    ;(
      service as unknown as {
        runClaudeLoginAndCapture(): Promise<{
          credentialsJson: string
          oauthAccount: unknown
          identity: { email: string; organizationUuid: null; organizationName: null }
        }>
      }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: '{"new":true}\n',
      oauthAccount: { newOauth: true },
      identity: { email: 'intruder@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount('account-1')).rejects.toThrow('intruder@example.com')

    expect(store.getSettings().claudeManagedAccounts[0].email).toBe('old@example.com')
    expect(readFileSync(join(managedAuthPath, '.credentials.json'), 'utf-8')).toBe('{"old":true}\n')
    expect(readFileSync(join(managedAuthPath, 'oauth-account.json'), 'utf-8')).toBe(
      '{"oldOauth":true}\n'
    )
  })

  it('rejects adding a managed account that duplicates an existing identity on the same runtime', async () => {
    setPlatform('linux')
    tempDir = CLAUDE_SERVICE_TEST_ROOT
    rmSync(tempDir, { recursive: true, force: true })
    const hostAuthPath = join(tempDir, 'claude-accounts', 'host-account', 'auth')
    mkdirSync(hostAuthPath, { recursive: true })
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'host-account',
          email: 'host@example.com',
          managedAuthPath: hostAuthPath,
          managedAuthRuntime: 'host',
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: 'host-account',
      activeClaudeManagedAccountIdsByRuntime: { host: 'host-account', wsl: {} }
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
    ;(
      service as unknown as {
        runClaudeLoginAndCapture(): Promise<{
          credentialsJson: string
          oauthAccount: unknown
          identity: { email: string; organizationUuid: null; organizationName: null }
        }>
      }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: '{"new":true}\n',
      oauthAccount: { newOauth: true },
      identity: { email: ' HOST@example.com ', organizationUuid: null, organizationName: null }
    }))

    await expect(service.addAccount({ runtime: 'host' })).rejects.toThrow(
      'This Claude account is already added.'
    )

    expect(settings.claudeManagedAccounts).toHaveLength(1)
    expect(settings.activeClaudeManagedAccountId).toBe('host-account')
  })
})
