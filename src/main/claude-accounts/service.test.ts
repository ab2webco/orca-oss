/* eslint-disable max-lines -- test suite covers Claude capture and rollback edge cases */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ClaudeManagedAccount, ClaudeRateLimitAccountsState } from '../../shared/types'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials,
  writeActiveClaudeKeychainCredentials,
  writeManagedClaudeKeychainCredentials
} from './keychain'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/orca-claude-service-test'
  }
}))

vi.mock('../codex-cli/command', () => ({
  resolveClaudeCommand: () => 'claude'
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

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

function createService(): unknown {
  return {}
}

async function readCapturedCredentials(
  configDir: string,
  previousLegacyKeychain: string | null
): Promise<string | null> {
  const { ClaudeAccountService } = await import('./service')
  const service = new ClaudeAccountService(
    createService() as never,
    createService() as never,
    createService() as never
  )
  return (
    service as unknown as {
      readCapturedCredentials(
        configDir: string,
        previousLegacyKeychain: string | null
      ): Promise<string | null>
    }
  ).readCapturedCredentials(configDir, previousLegacyKeychain)
}

describe('ClaudeAccountService credential capture', () => {
  let tempDir: string | null = null

  beforeEach(() => {
    setPlatform('darwin')
    tempDir = null
    vi.mocked(readActiveClaudeKeychainCredentials).mockReset()
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockReset()
    vi.mocked(readManagedClaudeKeychainCredentials).mockReset()
    vi.mocked(deleteActiveClaudeKeychainCredentialsStrict).mockClear()
    vi.mocked(writeActiveClaudeKeychainCredentials).mockReset()
    vi.mocked(writeActiveClaudeKeychainCredentials).mockResolvedValue()
    vi.mocked(writeManagedClaudeKeychainCredentials).mockReset()
    vi.mocked(writeManagedClaudeKeychainCredentials).mockResolvedValue()
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('accepts scoped Keychain capture even when it matches the previous legacy item', async () => {
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce('same-account')
      .mockResolvedValueOnce('same-account')

    await expect(readCapturedCredentials('/tmp/claude-config', 'same-account')).resolves.toBe(
      'same-account'
    )

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith('/tmp/claude-config')
    expect(readActiveClaudeKeychainCredentials).not.toHaveBeenCalled()
  })

  it('rejects unchanged legacy fallback when scoped capture is missing', async () => {
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('previous')

    await expect(readCapturedCredentials('/tmp/claude-config', 'previous')).resolves.toBeNull()

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(
      1,
      '/tmp/claude-config'
    )
    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(2)
  })

  it('accepts changed legacy fallback for old Claude Code builds', async () => {
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('new-legacy')

    await expect(readCapturedCredentials('/tmp/claude-config', 'previous')).resolves.toBe(
      'new-legacy'
    )

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(
      1,
      '/tmp/claude-config'
    )
    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(2)
  })

  it('falls back to captured credentials file on macOS', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-capture-'))
    writeFileSync(join(tempDir, '.credentials.json'), '{"token":"file"}\n', 'utf-8')
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('previous')

    await expect(readCapturedCredentials(tempDir, 'previous')).resolves.toBe('{"token":"file"}\n')
  })

  it('fails login capture when legacy Keychain cleanup fails', async () => {
    vi.mocked(readActiveClaudeKeychainCredentials).mockResolvedValue('previous-legacy')
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValue('captured-scoped')
    vi.mocked(writeActiveClaudeKeychainCredentials).mockRejectedValue(new Error('restore failed'))
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      createService() as never,
      createService() as never,
      createService() as never
    )
    const testService = service as unknown as {
      runClaudeCommand: () => Promise<string>
      runClaudeLoginAndCapture(): Promise<{ credentialsJson: string }>
    }
    testService.runClaudeCommand = vi.fn(async () => '{"account":{"email":"user@example.com"}}')

    await expect(testService.runClaudeLoginAndCapture()).rejects.toThrow('restore failed')
  })

  it('restores previous managed auth when reauth materialization fails', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
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
      syncForCurrentSelection: vi.fn(async () => {
        throw new Error('materialize failed')
      })
    }
    const rateLimits = { evictInactiveClaudeCache: vi.fn(), refreshForClaudeAccountChange: vi.fn() }
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
      identity: { email: 'old@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount('account-1')).rejects.toThrow('materialize failed')

    expect(readFileSync(join(managedAuthPath, '.credentials.json'), 'utf-8')).toBe('{"old":true}\n')
    expect(readFileSync(join(managedAuthPath, 'oauth-account.json'), 'utf-8')).toBe(
      '{"oldOauth":true}\n'
    )
    expect(store.getSettings().claudeManagedAccounts[0].email).toBe('old@example.com')
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).toHaveBeenCalled()
  })

  it('restores settings without rematerializing when managed-auth rollback write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(join(managedAuthPath, 'oauth-account.json'), '{"oldOauth":true}\n', 'utf-8')
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValue('{"old":true}\n')
    vi.mocked(writeManagedClaudeKeychainCredentials)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('managed restore failed'))
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
      syncForCurrentSelection: vi.fn(async () => {
        throw new Error('materialize failed')
      })
    }
    const rateLimits = { evictInactiveClaudeCache: vi.fn(), refreshForClaudeAccountChange: vi.fn() }
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
      identity: { email: 'old@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount('account-1')).rejects.toThrow('materialize failed')

    expect(store.getSettings().claudeManagedAccounts[0].email).toBe('old@example.com')
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[claude-accounts] Failed to restore managed credentials during rollback:',
      expect.any(Error)
    )
    warn.mockRestore()
  })

  it('restores oauth metadata when new credential write and credential rollback fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(join(managedAuthPath, 'oauth-account.json'), '{"oldOauth":true}\n', 'utf-8')
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValue('{"old":true}\n')
    vi.mocked(writeManagedClaudeKeychainCredentials)
      .mockRejectedValueOnce(new Error('new credentials failed'))
      .mockRejectedValueOnce(new Error('credential rollback failed'))
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
      syncForCurrentSelection: vi.fn()
    }
    const rateLimits = { evictInactiveClaudeCache: vi.fn(), refreshForClaudeAccountChange: vi.fn() }
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
      identity: { email: 'old@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount('account-1')).rejects.toThrow(
      'new credentials failed'
    )

    expect(readFileSync(join(managedAuthPath, 'oauth-account.json'), 'utf-8')).toBe(
      '{"oldOauth":true}\n'
    )
    expect(store.getSettings().claudeManagedAccounts[0].email).toBe('old@example.com')
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[claude-accounts] Failed to restore managed credentials during rollback:',
      expect.any(Error)
    )
    warn.mockRestore()
  })

  it('restores old metadata when rollback restores credentials but oauth restore fails', async () => {
    setPlatform('linux')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    const oauthPath = join(managedAuthPath, 'oauth-account.json')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(join(managedAuthPath, '.credentials.json'), '{"old":true}\n', 'utf-8')
    writeFileSync(oauthPath, '{"oldOauth":true}\n', 'utf-8')
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
      syncForCurrentSelection: vi.fn(async () => {
        rmSync(oauthPath, { force: true })
        mkdirSync(oauthPath)
        throw new Error('materialize failed')
      })
    }
    const rateLimits = { evictInactiveClaudeCache: vi.fn(), refreshForClaudeAccountChange: vi.fn() }
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
      identity: { email: 'old@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount('account-1')).rejects.toThrow('materialize failed')

    expect(readFileSync(join(managedAuthPath, '.credentials.json'), 'utf-8')).toBe('{"old":true}\n')
    expect(store.getSettings().claudeManagedAccounts[0].email).toBe('old@example.com')
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('refreshes rate limits without recaching a removed active account', async () => {
    setPlatform('darwin')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(join(managedAuthPath, '.credentials.json'), '{"old":true}\n', 'utf-8')
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
    const worktreeMeta: Record<string, { claudeAccountId: string | null }> = {
      'repo-1::wt-1': { claudeAccountId: 'account-1' }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      getAllWorktreeMeta: vi.fn(() => worktreeMeta),
      setWorktreeMeta: vi.fn((worktreeId: string, updates: { claudeAccountId: null }) => {
        worktreeMeta[worktreeId] = { ...worktreeMeta[worktreeId], ...updates }
      }),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      }),
      commitClaudeAccountState: vi.fn(
        (
          updates: Partial<typeof settings>,
          assignments: Readonly<Record<string, string | null>>
        ) => {
          settings = { ...settings, ...updates }
          for (const [worktreeId, claudeAccountId] of Object.entries(assignments)) {
            worktreeMeta[worktreeId] = { claudeAccountId }
          }
        }
      )
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {
        worktreeMeta['repo-1::wt-created-during-sync'] = { claudeAccountId: 'account-1' }
      }),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      evictInactiveClaudeCache: vi.fn(),
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const onWorktreeAccountPinsChanged = vi.fn()
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never,
      onWorktreeAccountPinsChanged
    )

    await service.removeAccount('account-1')

    expect(rateLimits.evictInactiveClaudeCache).toHaveBeenCalledWith('account-1')
    expect(rateLimits.refreshForClaudeAccountChange).toHaveBeenCalledWith('account-1', {
      runtime: 'host'
    })
    expect(settings).toMatchObject({
      claudeManagedAccounts: [],
      activeClaudeManagedAccountId: null
    })
    expect(worktreeMeta['repo-1::wt-1'].claudeAccountId).toBeNull()
    expect(worktreeMeta['repo-1::wt-created-during-sync'].claudeAccountId).toBeNull()
    expect(onWorktreeAccountPinsChanged).toHaveBeenCalledTimes(1)
    expect(onWorktreeAccountPinsChanged).toHaveBeenCalledWith('repo-1')
    expect(deleteActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(
      expect.stringContaining(join('claude-accounts', 'account-1', 'auth'))
    )
  })

  it('durably restores account state before credentials are touched when removal refresh fails', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(join(managedAuthPath, '.credentials.json'), '{"old":true}\n', 'utf-8')
    const account = {
      id: 'account-1',
      email: 'old@example.com',
      managedAuthPath,
      authMethod: 'subscription-oauth' as const,
      organizationUuid: null,
      organizationName: null,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
    let settings = {
      claudeManagedAccounts: [account],
      activeClaudeManagedAccountId: 'account-1',
      activeClaudeManagedAccountIdsByRuntime: { host: 'account-1', wsl: {} }
    }
    const worktreeMeta = { 'wt-1': { claudeAccountId: 'account-1' as string | null } }
    const updateSettings = vi.fn((updates: Partial<typeof settings>) => {
      settings = { ...settings, ...updates }
      return settings
    })
    const setWorktreeMeta = vi.fn(
      (worktreeId: 'wt-1', updates: { claudeAccountId: string | null }) => {
        worktreeMeta[worktreeId] = { ...worktreeMeta[worktreeId], ...updates }
      }
    )
    const commitClaudeAccountState = vi.fn(
      (updates: Partial<typeof settings>, assignments: Readonly<Record<string, string | null>>) => {
        updateSettings(updates)
        for (const [worktreeId, claudeAccountId] of Object.entries(assignments)) {
          setWorktreeMeta(worktreeId as 'wt-1', { claudeAccountId })
        }
      }
    )
    const store = {
      getSettings: vi.fn(() => settings),
      getAllWorktreeMeta: vi.fn(() => worktreeMeta),
      setWorktreeMeta,
      updateSettings,
      commitClaudeAccountState
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      evictInactiveClaudeCache: vi.fn(),
      refreshForClaudeAccountChange: vi.fn(async () => {
        throw new Error('refresh failed')
      })
    }
    const { ClaudeAccountService } = await import('./service')
    const onWorktreeAccountPinsChanged = vi.fn()
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never,
      onWorktreeAccountPinsChanged
    )

    await expect(service.removeAccount('account-1')).rejects.toThrow('refresh failed')

    expect(commitClaudeAccountState).toHaveBeenCalledTimes(2)
    expect(settings.claudeManagedAccounts).toEqual([account])
    expect(settings.activeClaudeManagedAccountId).toBe('account-1')
    expect(worktreeMeta['wt-1'].claudeAccountId).toBe('account-1')
    expect(readFileSync(join(managedAuthPath, '.credentials.json'), 'utf-8')).toBe('{"old":true}\n')
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).toHaveBeenCalled()
    expect(onWorktreeAccountPinsChanged).not.toHaveBeenCalled()
  })

  it('does not delete managed files when scoped Keychain cleanup fails', async () => {
    setPlatform('darwin')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const managedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    vi.mocked(deleteActiveClaudeKeychainCredentialsStrict).mockRejectedValueOnce(
      new Error('Keychain access denied')
    )
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService({} as never, {} as never, {} as never)

    await expect(
      (
        service as unknown as {
          safeRemoveManagedAuth(
            accountId: string,
            path: string,
            options: { strict: boolean }
          ): Promise<void>
        }
      ).safeRemoveManagedAuth('account-1', managedAuthPath, { strict: true })
    ).rejects.toThrow('Keychain access denied')

    expect(existsSync(managedAuthPath)).toBe(true)
  })

  it('blocks mutations only for the account owned by a live injected PTY', async () => {
    const settings = {
      claudeManagedAccounts: [
        {
          id: 'account-1',
          email: 'one@example.com',
          managedAuthPath: '/tmp/account-1/auth',
          authMethod: 'subscription-oauth' as const,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
    }
    const store = { getSettings: vi.fn(() => settings) }
    const { ClaudeAccountService } = await import('./service')
    const { markClaudePtyExited, markInjectedClaudePtySpawned } = await import('./live-pty-gate')
    const service = new ClaudeAccountService(store as never, {} as never, {} as never)

    markInjectedClaudePtySpawned('injected-pty', 'account-1')
    try {
      await expect(service.selectAccount('account-1')).rejects.toThrow('in use')
      await expect(service.reauthenticateAccount('account-1')).rejects.toThrow('in use')
      await expect(service.removeAccount('account-1')).rejects.toThrow('in use')
    } finally {
      markClaudePtyExited('injected-pty')
    }
  })

  it.each([
    ['reauthenticateAccount', 'doReauthenticateAccount'],
    ['removeAccount', 'doRemoveAccount'],
    ['selectAccount', 'doSelectAccount']
  ] as const)('excludes injected launches throughout %s', async (publicMethod, privateMethod) => {
    let finishOperation: (value: ClaudeRateLimitAccountsState) => void = () => {
      throw new Error('managed account mutation did not start')
    }
    const operation = new Promise<ClaudeRateLimitAccountsState>((resolve) => {
      finishOperation = resolve
    })
    const { ClaudeAccountService } = await import('./service')
    const { releaseInjectedClaudeAccountLaunch, reserveInjectedClaudeAccountLaunch } =
      await import('./live-pty-gate')
    const service = new ClaudeAccountService({} as never, {} as never, {} as never)
    ;(service as unknown as Record<string, ReturnType<typeof vi.fn>>)[privateMethod] = vi.fn(
      async () => operation
    )

    const pending = service[publicMethod]('account-1')
    await Promise.resolve()

    expect(() => reserveInjectedClaudeAccountLaunch('account-1')).toThrow('being changed')

    finishOperation({ accounts: [], activeAccountId: null })
    await pending
    const reservationId = reserveInjectedClaudeAccountLaunch('account-1')
    releaseInjectedClaudeAccountLaunch(reservationId)
  })

  it('excludes pinned launches for the outgoing account throughout selection sync', async () => {
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'account-1',
          email: 'one@example.com',
          managedAuthPath: '/tmp/account-1/auth',
          managedAuthRuntime: 'host' as const,
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth' as const,
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        },
        {
          id: 'account-2',
          email: 'two@example.com',
          managedAuthPath: '/tmp/account-2/auth',
          managedAuthRuntime: 'host' as const,
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth' as const,
          organizationUuid: null,
          organizationName: null,
          createdAt: 2,
          updatedAt: 2,
          lastAuthenticatedAt: 2
        }
      ],
      activeClaudeManagedAccountId: 'account-1',
      activeClaudeManagedAccountIdsByRuntime: { host: 'account-1', wsl: {} }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      })
    }
    let noteSyncStarted!: () => void
    const syncStarted = new Promise<void>((resolve) => {
      noteSyncStarted = resolve
    })
    let finishSync!: () => void
    const syncPending = new Promise<void>((resolve) => {
      finishSync = resolve
    })
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(() => {
        noteSyncStarted()
        return syncPending
      }),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const { reserveInjectedClaudeAccountLaunch } = await import('./live-pty-gate')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )

    const selection = service.selectAccount('account-2')
    await syncStarted

    expect(() => reserveInjectedClaudeAccountLaunch('account-1')).toThrow('being changed')

    finishSync()
    await selection
  })

  it('surfaces the concrete distro for a legacy default-WSL account summary', async () => {
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService({} as never, {} as never, {} as never)
    const summary = (
      service as unknown as {
        toSummary(account: ClaudeManagedAccount): { wslDistro?: string | null }
      }
    ).toSummary({
      id: 'account-1',
      email: 'one@example.com',
      managedAuthPath:
        '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\claude-accounts\\account-1\\auth',
      managedAuthRuntime: 'wsl',
      wslDistro: null,
      wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/account-1/auth',
      authMethod: 'subscription-oauth',
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    })

    expect(summary.wslDistro).toBe('Ubuntu')
  })

  it('evicts inactive rate-limit cache after successful reauth', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
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
      identity: { email: 'old@example.com', organizationUuid: null, organizationName: null }
    }))

    await service.reauthenticateAccount('account-1')

    expect(rateLimits.evictInactiveClaudeCache).toHaveBeenCalledWith('account-1')
    expect(rateLimits.refreshForClaudeAccountChange).toHaveBeenCalledWith(undefined, {
      runtime: 'host'
    })
    expect(settings.claudeManagedAccounts[0].email).toBe('old@example.com')
  })

  it('adds an account without switching the active Claude auth while PTYs are live', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
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
      activeClaudeManagedAccountIdsByRuntime: { host: 'host-account', wsl: { Ubuntu: null } }
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
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
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
      identity: { email: 'new@example.com', organizationUuid: null, organizationName: null }
    }))

    markClaudePtySpawned('live-claude-pty', 'host-account')
    try {
      await service.addAccount({ runtime: 'host' })
    } finally {
      markClaudePtyExited('live-claude-pty')
    }

    expect(settings.claudeManagedAccounts).toHaveLength(2)
    expect(settings.claudeManagedAccounts[1].email).toBe('new@example.com')
    expect(settings.activeClaudeManagedAccountId).toBe('host-account')
    expect(settings.activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'host-account',
      wsl: { Ubuntu: null }
    })
    expect(runtimeAuth.syncForCurrentSelection).not.toHaveBeenCalled()
    expect(rateLimits.refreshForClaudeAccountChange).not.toHaveBeenCalled()
    expect(rateLimits.evictInactiveClaudeCache).toHaveBeenCalledWith(
      settings.claudeManagedAccounts[1].id
    )
  })

  it('rejects adding a Claude account whose identity already exists', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const existingAuthPath = join(tempDir, 'claude-accounts', 'existing-account', 'auth')
    mkdirSync(existingAuthPath, { recursive: true })
    const existingMarkerPath = join(existingAuthPath, '.orca-managed-claude-auth')
    writeFileSync(existingMarkerPath, 'existing-account\n', 'utf-8')
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'existing-account',
          email: 'new@example.com',
          managedAuthPath: existingAuthPath,
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
      activeClaudeManagedAccountId: 'existing-account',
      activeClaudeManagedAccountIdsByRuntime: { host: 'existing-account', wsl: {} }
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
          identity: { email: string; organizationUuid: string | null; organizationName: null }
        }>
      }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: '{"new":true}\n',
      oauthAccount: { newOauth: true },
      identity: { email: 'new@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.addAccount({ runtime: 'host' })).rejects.toThrow(
      'This Claude account is already added.'
    )

    expect(settings.claudeManagedAccounts).toHaveLength(1)
    expect(readFileSync(existingMarkerPath, 'utf-8')).toBe('existing-account\n')
    // The guard fires before credentials/settings change, so rollback I/O
    // would only add latency and could mask the duplicate error.
    expect(store.updateSettings).not.toHaveBeenCalled()
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).not.toHaveBeenCalled()
    // The rejected add's throwaway managed-auth dir must be cleaned up, leaving
    // only the pre-existing account's dir behind.
    expect(readdirSync(join(tempDir, 'claude-accounts')).sort()).toEqual(['existing-account'])
  })

  it('adds a Claude account with the same email under a different organization', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const existingAuthPath = join(tempDir, 'claude-accounts', 'existing-account', 'auth')
    mkdirSync(existingAuthPath, { recursive: true })
    writeFileSync(
      join(existingAuthPath, '.orca-managed-claude-auth'),
      'existing-account\n',
      'utf-8'
    )
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'existing-account',
          email: 'new@example.com',
          managedAuthPath: existingAuthPath,
          managedAuthRuntime: 'host',
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth',
          organizationUuid: 'org-A',
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: 'existing-account',
      activeClaudeManagedAccountIdsByRuntime: { host: 'existing-account', wsl: {} }
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
          identity: { email: string; organizationUuid: string | null; organizationName: null }
        }>
      }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: '{"new":true}\n',
      oauthAccount: { newOauth: true },
      identity: { email: 'new@example.com', organizationUuid: 'org-B', organizationName: null }
    }))

    await service.addAccount({ runtime: 'host' })

    expect(settings.claudeManagedAccounts).toHaveLength(2)
    expect(settings.claudeManagedAccounts[1].email).toBe('new@example.com')
    expect(settings.claudeManagedAccounts[1].organizationUuid).toBe('org-B')
  })

  it('switches the active Claude account while PTYs are live', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const firstAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    const secondAuthPath = join(tempDir, 'claude-accounts', 'account-2', 'auth')
    mkdirSync(firstAuthPath, { recursive: true })
    mkdirSync(secondAuthPath, { recursive: true })
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'account-1',
          email: 'first@example.com',
          managedAuthPath: firstAuthPath,
          managedAuthRuntime: 'host',
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        },
        {
          id: 'account-2',
          email: 'second@example.com',
          managedAuthPath: secondAuthPath,
          managedAuthRuntime: 'host',
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 2,
          updatedAt: 2,
          lastAuthenticatedAt: 2
        }
      ],
      activeClaudeManagedAccountId: 'account-1',
      activeClaudeManagedAccountIdsByRuntime: { host: 'account-1', wsl: {} }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      })
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )

    markClaudePtySpawned('live-claude-pty', 'account-1')
    try {
      await service.selectAccount('account-2')
    } finally {
      markClaudePtyExited('live-claude-pty')
    }

    expect(settings.activeClaudeManagedAccountId).toBe('account-2')
    expect(settings.activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'account-2',
      wsl: {}
    })
    expect(runtimeAuth.syncForCurrentSelection).toHaveBeenCalledWith({ runtime: 'host' })
    expect(rateLimits.refreshForClaudeAccountChange).toHaveBeenCalledWith('account-1', {
      runtime: 'host'
    })
  })

  it('restores the previous selection when a Claude account switch fails', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const firstAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    const secondAuthPath = join(tempDir, 'claude-accounts', 'account-2', 'auth')
    mkdirSync(firstAuthPath, { recursive: true })
    mkdirSync(secondAuthPath, { recursive: true })
    let settings = {
      claudeManagedAccounts: [
        {
          id: 'account-1',
          email: 'first@example.com',
          managedAuthPath: firstAuthPath,
          managedAuthRuntime: 'host',
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        },
        {
          id: 'account-2',
          email: 'second@example.com',
          managedAuthPath: secondAuthPath,
          managedAuthRuntime: 'host',
          wslDistro: null,
          wslLinuxAuthPath: null,
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 2,
          updatedAt: 2,
          lastAuthenticatedAt: 2
        }
      ],
      activeClaudeManagedAccountId: 'account-1',
      activeClaudeManagedAccountIdsByRuntime: { host: 'account-1', wsl: {} }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      })
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {
        throw new Error('runtime sync failed')
      }),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )

    await expect(service.selectAccount('account-2')).rejects.toThrow('runtime sync failed')

    expect(settings.activeClaudeManagedAccountId).toBe('account-1')
    expect(settings.activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'account-1',
      wsl: {}
    })
    expect(runtimeAuth.forceMaterializeCurrentSelectionForRollback).toHaveBeenCalled()
    expect(rateLimits.refreshForClaudeAccountChange).not.toHaveBeenCalled()
  })

  it('selects a WSL account without changing the Windows active account', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const hostAuthPath = join(tempDir, 'claude-accounts', 'host-account', 'auth')
    const wslAuthPath = join(tempDir, 'claude-accounts', 'wsl-account', 'auth')
    mkdirSync(hostAuthPath, { recursive: true })
    mkdirSync(wslAuthPath, { recursive: true })
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
        },
        {
          id: 'wsl-account',
          email: 'wsl@example.com',
          managedAuthPath: wslAuthPath,
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/jin/.local/share/orca/claude-accounts/wsl-account/auth',
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: 'host-account',
      activeClaudeManagedAccountIdsByRuntime: { host: 'host-account', wsl: { Ubuntu: null } }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      })
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )

    const snapshot = await service.selectAccountForTarget('wsl-account', {
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })

    expect(settings.activeClaudeManagedAccountId).toBe('host-account')
    expect(settings.activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'host-account',
      wsl: { Ubuntu: 'wsl-account' }
    })
    expect(snapshot.activeAccountIdsByRuntime).toEqual({
      host: 'host-account',
      wsl: { Ubuntu: 'wsl-account' }
    })
    expect(runtimeAuth.syncForCurrentSelection).toHaveBeenCalledWith({
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
    expect(rateLimits.refreshForClaudeAccountChange).toHaveBeenCalledWith(null, {
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
  })

  it('rejects selecting a WSL account for the Windows target', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const wslAuthPath = join(tempDir, 'claude-accounts', 'wsl-account', 'auth')
    mkdirSync(wslAuthPath, { recursive: true })
    const settings = {
      claudeManagedAccounts: [
        {
          id: 'wsl-account',
          email: 'wsl@example.com',
          managedAuthPath: wslAuthPath,
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/jin/.local/share/orca/claude-accounts/wsl-account/auth',
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: null } }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn()
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )

    await expect(
      service.selectAccountForTarget('wsl-account', { runtime: 'host' })
    ).rejects.toThrow('different runtime')
    expect(runtimeAuth.syncForCurrentSelection).not.toHaveBeenCalled()
    expect(rateLimits.refreshForClaudeAccountChange).not.toHaveBeenCalled()
  })

  it('removes a WSL account without clearing the Windows active account', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
    const hostAuthPath = join(tempDir, 'claude-accounts', 'host-account', 'auth')
    const wslAuthPath = join(tempDir, 'claude-accounts', 'wsl-account', 'auth')
    mkdirSync(hostAuthPath, { recursive: true })
    mkdirSync(wslAuthPath, { recursive: true })
    writeFileSync(join(wslAuthPath, '.orca-managed-claude-auth'), 'wsl-account\n', 'utf-8')
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
        },
        {
          id: 'wsl-account',
          email: 'wsl@example.com',
          managedAuthPath: wslAuthPath,
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/jin/.local/share/orca/claude-accounts/wsl-account/auth',
          authMethod: 'subscription-oauth',
          organizationUuid: null,
          organizationName: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeClaudeManagedAccountId: 'host-account',
      activeClaudeManagedAccountIdsByRuntime: {
        host: 'host-account',
        wsl: { Ubuntu: 'wsl-account' }
      }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      getAllWorktreeMeta: vi.fn(() => ({})),
      setWorktreeMeta: vi.fn(),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      }),
      commitClaudeAccountState: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
      })
    }
    const runtimeAuth = {
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      evictInactiveClaudeCache: vi.fn(),
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      store as never,
      rateLimits as never,
      runtimeAuth as never
    )

    await service.removeAccount('wsl-account')

    expect(settings.activeClaudeManagedAccountId).toBe('host-account')
    expect(settings.activeClaudeManagedAccountIdsByRuntime).toEqual({
      host: 'host-account',
      wsl: { Ubuntu: null }
    })
    expect(rateLimits.evictInactiveClaudeCache).toHaveBeenCalledWith('wsl-account')
    expect(rateLimits.refreshForClaudeAccountChange).toHaveBeenCalledWith('wsl-account', {
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
  })

  it('removes command listeners when Claude sign-in times out', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: () => void
    }
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn()
    const destroyStdin = vi.spyOn(child.stdin, 'destroy')
    const spawnMock = vi.fn(() => child)
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    try {
      const { ClaudeAccountService } = await import('./service')
      const service = new ClaudeAccountService(
        createService() as never,
        createService() as never,
        createService() as never
      )
      const commandPromise = (
        service as unknown as {
          runClaudeCommand(
            args: string[],
            configDir: { windowsPath: string; linuxPath: string | null; wslDistro: string | null },
            timeoutMs: number,
            options?: { keepStdinOpen?: boolean }
          ): Promise<string>
        }
      ).runClaudeCommand(
        ['login'],
        { windowsPath: '/tmp/claude-auth', linuxPath: null, wslDistro: null },
        1000,
        { keepStdinOpen: true }
      )
      const rejection = expect(commandPromise).rejects.toThrow(
        'Claude sign-in took too long to finish.'
      )

      await vi.advanceTimersByTimeAsync(1000)

      await rejection
      expect(child.kill).toHaveBeenCalledTimes(1)
      expect(destroyStdin).toHaveBeenCalledTimes(1)
      expect(child.stdout.listenerCount('data')).toBe(0)
      expect(child.stderr.listenerCount('data')).toBe(0)
      expect(child.listenerCount('error')).toBe(0)
      expect(child.listenerCount('close')).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.doUnmock('node:child_process')
    }
  })

  it('pipes stdin only for the explicit Claude account login command', async () => {
    setPlatform('linux')
    vi.resetModules()
    vi.mocked(readActiveClaudeKeychainCredentials).mockResolvedValue(null)
    const loginChild = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    loginChild.stdin = new PassThrough()
    loginChild.stdout = new PassThrough()
    loginChild.stderr = new PassThrough()
    loginChild.kill = vi.fn()
    const statusChild = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    statusChild.stdout = new PassThrough()
    statusChild.stderr = new PassThrough()
    statusChild.kill = vi.fn()
    const spawnMock = vi.fn(
      (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        if (args[1] === 'login') {
          writeFileSync(
            join(options.env.CLAUDE_CONFIG_DIR!, '.credentials.json'),
            '{"claudeAiOauth":{"email":"user@example.com","accessToken":"token"}}\n',
            'utf-8'
          )
          queueMicrotask(() => loginChild.emit('close', 0))
          return loginChild
        }
        statusChild.stdout.write('{"email":"user@example.com"}\n')
        queueMicrotask(() => statusChild.emit('close', 0))
        return statusChild
      }
    )
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    try {
      const { ClaudeAccountService } = await import('./service')
      let settings = {
        claudeManagedAccounts: [] as ClaudeManagedAccount[],
        activeClaudeManagedAccountId: null,
        activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
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
        forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
      }
      const rateLimits = {
        evictInactiveClaudeCache: vi.fn(),
        refreshForClaudeAccountChange: vi.fn()
      }
      const service = new ClaudeAccountService(
        store as never,
        rateLimits as never,
        runtimeAuth as never
      )

      await service.addAccount()

      expect(spawnMock).toHaveBeenNthCalledWith(
        1,
        'claude',
        ['auth', 'login', '--claudeai'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      )
      expect(spawnMock).toHaveBeenNthCalledWith(
        2,
        'claude',
        ['auth', 'status', '--json'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      )
      expect(settings.claudeManagedAccounts[0]?.email).toBe('user@example.com')
    } finally {
      vi.doUnmock('node:child_process')
    }
  })

  it('rejects immediately when Claude sign-in is denied', async () => {
    vi.resetModules()
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
      pid: number
    }
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn()
    child.pid = 4242
    const destroyStdin = vi.spyOn(child.stdin, 'destroy')
    const spawnMock = vi.fn(() => child)
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))
    // Denial must tear down the whole detached login/browser tree (process-group kill on POSIX),
    // not just the direct child — otherwise the orphaned auth processes the `detached` spawn guards against leak.
    const killTree = vi.spyOn(process, 'kill').mockReturnValue(true)

    try {
      const { ClaudeAccountService } = await import('./service')
      const service = new ClaudeAccountService(
        createService() as never,
        createService() as never,
        createService() as never
      )
      const commandPromise = (
        service as unknown as {
          runClaudeCommand(
            args: string[],
            configDir: { windowsPath: string; linuxPath: string | null; wslDistro: string | null },
            timeoutMs: number,
            options?: { keepStdinOpen?: boolean }
          ): Promise<string>
        }
      ).runClaudeCommand(
        ['login'],
        { windowsPath: '/tmp/claude-auth', linuxPath: null, wslDistro: null },
        180_000,
        { keepStdinOpen: true }
      )

      child.stderr.write('OAuth authorization failed: access_denied\n')

      await expect(commandPromise).rejects.toThrow('Claude sign-in was denied. Please try again.')
      expect(killTree).toHaveBeenCalledWith(-child.pid)
      expect(child.kill).not.toHaveBeenCalled()
      expect(destroyStdin).toHaveBeenCalledTimes(1)
      expect(child.stdout.listenerCount('data')).toBe(0)
      expect(child.stderr.listenerCount('data')).toBe(0)
      expect(child.listenerCount('error')).toBe(0)
      expect(child.listenerCount('close')).toBe(0)
    } finally {
      killTree.mockRestore()
      vi.doUnmock('node:child_process')
    }
  })

  it('cancels an in-flight Claude account add', async () => {
    vi.resetModules()
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn()
    const destroyStdin = vi.spyOn(child.stdin, 'destroy')
    const spawnMock = vi.fn(() => child)
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    try {
      const { ClaudeAccountService } = await import('./service')
      let settings = {
        claudeManagedAccounts: [],
        activeClaudeManagedAccountId: null,
        activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
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
        forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
      }
      const rateLimits = {
        evictInactiveClaudeCache: vi.fn(),
        refreshForClaudeAccountChange: vi.fn()
      }
      const service = new ClaudeAccountService(
        store as never,
        rateLimits as never,
        runtimeAuth as never
      )

      const addPromise = service.addAccount()
      await vi.waitFor(() => {
        expect(spawnMock).toHaveBeenCalledTimes(1)
      })

      expect(service.cancelPendingLogin()).toBe(true)
      await expect(addPromise).rejects.toThrow('Claude sign-in was cancelled.')
      expect(child.kill).toHaveBeenCalledTimes(1)
      expect(destroyStdin).toHaveBeenCalledTimes(1)
      expect(service.cancelPendingLogin()).toBe(false)
      expect(settings.claudeManagedAccounts).toEqual([])
      expect(child.stdout.listenerCount('data')).toBe(0)
      expect(child.stderr.listenerCount('data')).toBe(0)
      expect(child.listenerCount('error')).toBe(0)
      expect(child.listenerCount('close')).toBe(0)
    } finally {
      vi.doUnmock('node:child_process')
    }
  })

  it('honors cancel before Claude login command starts', async () => {
    setPlatform('linux')
    vi.resetModules()
    let releaseKeychainRead: (value: string | null) => void = () => {}
    vi.mocked(readActiveClaudeKeychainCredentials).mockReturnValue(
      new Promise<string | null>((resolve) => {
        releaseKeychainRead = resolve
      })
    )
    const spawnMock = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    try {
      const { ClaudeAccountService } = await import('./service')
      let settings = {
        claudeManagedAccounts: [],
        activeClaudeManagedAccountId: null,
        activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
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
        forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
      }
      const rateLimits = {
        evictInactiveClaudeCache: vi.fn(),
        refreshForClaudeAccountChange: vi.fn()
      }
      const service = new ClaudeAccountService(
        store as never,
        rateLimits as never,
        runtimeAuth as never
      )

      const addPromise = service.addAccount()
      await vi.waitFor(() => {
        expect(readActiveClaudeKeychainCredentials).toHaveBeenCalled()
      })

      expect(service.cancelPendingLogin()).toBe(true)
      expect(service.cancelPendingLogin()).toBe(false)
      expect(spawnMock).not.toHaveBeenCalled()
      releaseKeychainRead(null)
      await expect(addPromise).rejects.toThrow('Claude sign-in was cancelled.')
      expect(spawnMock).not.toHaveBeenCalled()
      expect(service.cancelPendingLogin()).toBe(false)
      expect(settings.claudeManagedAccounts).toEqual([])
    } finally {
      vi.doUnmock('node:child_process')
    }
  })

  it('uses taskkill to cancel the Windows Claude login process tree', async () => {
    setPlatform('win32')
    vi.resetModules()
    vi.mocked(readActiveClaudeKeychainCredentials).mockResolvedValue(null)
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    child.pid = 1234
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn()
    const destroyStdin = vi.spyOn(child.stdin, 'destroy')
    const taskkill = new EventEmitter() as EventEmitter & {
      unref: ReturnType<typeof vi.fn>
    }
    taskkill.unref = vi.fn()
    const spawnMock = vi.fn((command: string) => (command === 'taskkill.exe' ? taskkill : child))
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))

    try {
      const { ClaudeAccountService } = await import('./service')
      let settings = {
        claudeManagedAccounts: [],
        activeClaudeManagedAccountId: null,
        activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
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
        forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
      }
      const rateLimits = {
        evictInactiveClaudeCache: vi.fn(),
        refreshForClaudeAccountChange: vi.fn()
      }
      const service = new ClaudeAccountService(
        store as never,
        rateLimits as never,
        runtimeAuth as never
      )

      const addPromise = service.addAccount()
      await vi.waitFor(() => {
        expect(spawnMock).toHaveBeenCalledWith(
          'claude',
          ['auth', 'login', '--claudeai'],
          expect.objectContaining({ shell: true })
        )
      })

      expect(service.cancelPendingLogin()).toBe(true)
      await expect(addPromise).rejects.toThrow('Claude sign-in was cancelled.')
      expect(child.kill).not.toHaveBeenCalled()
      expect(spawnMock).toHaveBeenCalledWith(
        'taskkill.exe',
        ['/pid', '1234', '/t', '/f'],
        expect.objectContaining({ stdio: 'ignore', windowsHide: true })
      )
      expect(taskkill.unref).toHaveBeenCalled()
      expect(destroyStdin).toHaveBeenCalledTimes(1)
      expect(service.cancelPendingLogin()).toBe(false)
    } finally {
      vi.doUnmock('node:child_process')
    }
  })

  it('rejects reauthentication when the browser session returns a different identity', async () => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
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
    tempDir = '/tmp/orca-claude-service-test'
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

describe('ClaudeAccountService custom endpoint accounts', () => {
  let tempDir: string | null = null

  beforeEach(() => {
    setPlatform('linux')
    tempDir = '/tmp/orca-claude-service-test'
    rmSync(tempDir, { recursive: true, force: true })
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  type CustomEndpointTestSettings = {
    claudeManagedAccounts: ClaudeManagedAccount[]
    activeClaudeManagedAccountId: string | null
    activeClaudeManagedAccountIdsByRuntime?: {
      host: string | null
      wsl: Record<string, string | null>
    }
  }

  function createCustomEndpointHarness(initialSettings?: Partial<CustomEndpointTestSettings>): {
    settings: () => CustomEndpointTestSettings
    store: Record<string, unknown>
    runtimeAuth: { syncForCurrentSelection: ReturnType<typeof vi.fn> }
    rateLimits: {
      evictInactiveClaudeCache: ReturnType<typeof vi.fn>
      refreshForClaudeAccountChange: ReturnType<typeof vi.fn>
    }
    worktreeMeta: Record<string, { claudeAccountId: string | null }>
  } {
    let settings: CustomEndpointTestSettings = {
      claudeManagedAccounts: [],
      activeClaudeManagedAccountId: null,
      ...initialSettings
    }
    const worktreeMeta: Record<string, { claudeAccountId: string | null }> = {}
    const store = {
      getSettings: vi.fn(() => settings),
      getAllWorktreeMeta: vi.fn(() => worktreeMeta),
      updateSettings: vi.fn((updates: Partial<CustomEndpointTestSettings>) => {
        settings = { ...settings, ...updates }
        return settings
      }),
      commitClaudeAccountState: vi.fn(
        (
          updates: Partial<CustomEndpointTestSettings>,
          assignments: Readonly<Record<string, string | null>>
        ) => {
          settings = { ...settings, ...updates }
          for (const [worktreeId, claudeAccountId] of Object.entries(assignments)) {
            worktreeMeta[worktreeId] = { claudeAccountId }
          }
        }
      )
    }
    const runtimeAuth = {
      clearLastWrittenCredentialsJson: vi.fn(),
      syncForCurrentSelection: vi.fn(async () => {}),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    const rateLimits = {
      evictInactiveClaudeCache: vi.fn(),
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
    }
    return { settings: () => settings, store, runtimeAuth, rateLimits, worktreeMeta }
  }

  async function createService(harness: ReturnType<typeof createCustomEndpointHarness>) {
    const { ClaudeAccountService } = await import('./service')
    return new ClaudeAccountService(
      harness.store as never,
      harness.rateLimits as never,
      harness.runtimeAuth as never
    )
  }

  it('adds a custom endpoint account with a 0600 settings.json and no persisted token', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)

    const state = await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'super-secret-token',
      model: null
    })

    const settings = harness.settings()
    expect(settings.claudeManagedAccounts).toHaveLength(1)
    const account = settings.claudeManagedAccounts[0]
    expect(account).toMatchObject({
      email: 'z.ai · GLM',
      managedAuthRuntime: 'host',
      authMethod: 'custom-endpoint',
      endpointLabel: 'z.ai · GLM',
      endpointBaseUrl: 'https://api.z.ai/api/anthropic',
      endpointModel: 'glm-5.1',
      organizationUuid: null,
      organizationName: null
    })
    // Global selection stays untouched: endpoint accounts are per-worktree only.
    expect(settings.activeClaudeManagedAccountId).toBeNull()

    const settingsJsonPath = join(account.managedAuthPath, 'settings.json')
    expect(existsSync(settingsJsonPath)).toBe(true)
    expect(JSON.parse(readFileSync(settingsJsonPath, 'utf-8'))).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'super-secret-token',
        ANTHROPIC_MODEL: 'glm-5.1',
        API_TIMEOUT_MS: '3000000'
      }
    })
    expect(statSync(settingsJsonPath).mode & 0o777).toBe(0o600)
    // The token must never leave the managed dir: not in settings, not in the IPC snapshot.
    expect(JSON.stringify(settings)).not.toContain('super-secret-token')
    expect(JSON.stringify(state)).not.toContain('super-secret-token')
    expect(state.accounts[0]).toMatchObject({
      email: 'z.ai · GLM',
      authMethod: 'custom-endpoint',
      endpointBaseUrl: 'https://api.z.ai/api/anthropic',
      endpointModel: 'glm-5.1'
    })
  })

  it('keeps an explicit model and trims input fields', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)

    await service.addCustomEndpointAccount({
      label: '  GLM Lab  ',
      baseUrl: ' https://api.z.ai/api/anthropic ',
      token: ' tok ',
      model: ' glm-4.7 '
    })

    const account = harness.settings().claudeManagedAccounts[0]
    expect(account.email).toBe('GLM Lab')
    expect(account.endpointModel).toBe('glm-4.7')
    const parsed = JSON.parse(
      readFileSync(join(account.managedAuthPath, 'settings.json'), 'utf-8')
    ) as { env: Record<string, string> }
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('tok')
    expect(parsed.env.ANTHROPIC_MODEL).toBe('glm-4.7')
  })

  it('writes tier mapping env vars only for provided fields and keeps 0600', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)

    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok',
      model: 'glm-5.1',
      opusModel: ' glm-5.2 ',
      sonnetModel: 'glm-5.1',
      haikuModel: '   ',
      subagentModel: undefined
    })

    const account = harness.settings().claudeManagedAccounts[0]
    const settingsJsonPath = join(account.managedAuthPath, 'settings.json')
    expect(JSON.parse(readFileSync(settingsJsonPath, 'utf-8'))).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'tok',
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.1',
        API_TIMEOUT_MS: '3000000'
      }
    })
    expect(statSync(settingsJsonPath).mode & 0o777).toBe(0o600)
  })

  it('writes the full tier mapping including the subagent model', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)

    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok',
      opusModel: 'glm-5.2',
      sonnetModel: 'glm-5.1',
      haikuModel: 'glm-4.5-air',
      subagentModel: 'glm-5.1'
    })

    const account = harness.settings().claudeManagedAccounts[0]
    const parsed = JSON.parse(
      readFileSync(join(account.managedAuthPath, 'settings.json'), 'utf-8')
    ) as { env: Record<string, string> }
    expect(parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2')
    expect(parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.1')
    expect(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-4.5-air')
    expect(parsed.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('glm-5.1')
    // Tier mapping never leaks the token out of the managed dir.
    expect(JSON.stringify(harness.settings())).not.toContain('tok')
  })

  it('omits every tier env var when no tier field is provided', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)

    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok'
    })

    const account = harness.settings().claudeManagedAccounts[0]
    expect(
      JSON.parse(readFileSync(join(account.managedAuthPath, 'settings.json'), 'utf-8'))
    ).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'tok',
        ANTHROPIC_MODEL: 'glm-5.1',
        API_TIMEOUT_MS: '3000000'
      }
    })
  })

  it('rejects tier model values with control characters or over the length cap', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)
    const base = {
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok'
    }

    await expect(
      service.addCustomEndpointAccount({ ...base, opusModel: 'glm\n5.2' })
    ).rejects.toThrow(
      'Model names must be 256 characters or fewer with no whitespace or control characters.'
    )
    await expect(
      service.addCustomEndpointAccount({ ...base, sonnetModel: 'x'.repeat(257) })
    ).rejects.toThrow(
      'Model names must be 256 characters or fewer with no whitespace or control characters.'
    )
    await expect(
      service.addCustomEndpointAccount({ ...base, haikuModel: 'glm 5' })
    ).rejects.toThrow(
      'Model names must be 256 characters or fewer with no whitespace or control characters.'
    )
    await expect(
      service.addCustomEndpointAccount({ ...base, subagentModel: '\tglm\t5' })
    ).rejects.toThrow(
      'Model names must be 256 characters or fewer with no whitespace or control characters.'
    )
    await expect(service.addCustomEndpointAccount({ ...base, model: 'glm\r5' })).rejects.toThrow(
      'Model names must be 256 characters or fewer with no whitespace or control characters.'
    )

    expect(harness.settings().claudeManagedAccounts).toHaveLength(0)
    // Validation precedes dir creation, so no auth dir is ever materialized.
    const accountsDir = join(tempDir!, 'claude-accounts')
    expect(existsSync(accountsDir) ? readdirSync(accountsDir) : []).toHaveLength(0)
  })

  it('rejects duplicate labels among custom endpoint accounts case-insensitively', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)
    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok-1'
    })

    await expect(
      service.addCustomEndpointAccount({
        label: 'Z.AI · glm',
        baseUrl: 'https://api.z.ai/api/anthropic',
        token: 'tok-2'
      })
    ).rejects.toThrow('A custom endpoint account with this label already exists.')

    expect(harness.settings().claudeManagedAccounts).toHaveLength(1)
    // Validation precedes dir creation, so no orphaned auth dir is left behind.
    expect(readdirSync(join(tempDir!, 'claude-accounts'))).toHaveLength(1)
  })

  it('rejects invalid or non-http(s) base URLs and empty label/token', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)

    await expect(
      service.addCustomEndpointAccount({ label: 'x', baseUrl: 'not-a-url', token: 't' })
    ).rejects.toThrow('The endpoint base URL must be a valid http(s) URL.')
    await expect(
      service.addCustomEndpointAccount({ label: 'x', baseUrl: 'ftp://api.z.ai', token: 't' })
    ).rejects.toThrow('The endpoint base URL must be a valid http(s) URL.')
    await expect(
      service.addCustomEndpointAccount({ label: '  ', baseUrl: 'https://api.z.ai', token: 't' })
    ).rejects.toThrow('Enter a label for the custom endpoint account.')
    await expect(
      service.addCustomEndpointAccount({ label: 'x', baseUrl: 'https://api.z.ai', token: '  ' })
    ).rejects.toThrow('Enter the endpoint API token.')

    expect(harness.settings().claudeManagedAccounts).toHaveLength(0)
  })

  it('does not treat a custom endpoint label as an OAuth duplicate identity', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)
    await service.addCustomEndpointAccount({
      label: 'person@example.com',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok'
    })
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
      identity: { email: 'person@example.com', organizationUuid: null, organizationName: null }
    }))

    await service.addAccount({ runtime: 'host' })

    expect(harness.settings().claudeManagedAccounts).toHaveLength(2)
  })

  it('rejects OAuth re-authentication for custom endpoint accounts', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)
    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok'
    })
    const accountId = harness.settings().claudeManagedAccounts[0].id

    await expect(service.reauthenticateAccount(accountId)).rejects.toThrow(
      'Custom endpoint accounts have no OAuth re-authentication; edit or re-add the endpoint instead.'
    )
  })

  it('rejects selecting a custom endpoint account globally', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)
    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok'
    })
    const accountId = harness.settings().claudeManagedAccounts[0].id

    await expect(service.selectAccount(accountId)).rejects.toThrow(
      'Custom endpoint accounts can only be assigned per worktree.'
    )
    await expect(service.selectAccountForTarget(accountId, { runtime: 'host' })).rejects.toThrow(
      'Custom endpoint accounts can only be assigned per worktree.'
    )
    expect(harness.settings().activeClaudeManagedAccountId).toBeNull()
  })

  it('removes a custom endpoint account and its managed dir', async () => {
    const harness = createCustomEndpointHarness()
    const service = await createService(harness)
    await service.addCustomEndpointAccount({
      label: 'z.ai · GLM',
      baseUrl: 'https://api.z.ai/api/anthropic',
      token: 'tok'
    })
    const account = harness.settings().claudeManagedAccounts[0]
    expect(existsSync(account.managedAuthPath)).toBe(true)

    const state = await service.removeAccount(account.id)

    expect(harness.settings().claudeManagedAccounts).toHaveLength(0)
    expect(state.accounts).toHaveLength(0)
    expect(existsSync(account.managedAuthPath)).toBe(false)
  })
})
