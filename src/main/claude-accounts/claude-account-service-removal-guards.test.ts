import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRateLimitAccountsState } from '../../shared/types'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'
import { deleteActiveClaudeKeychainCredentialsStrict } from './keychain'

const CLAUDE_SERVICE_TEST_ROOT = join(tmpdir(), 'orca-claude-service-removal-guards-test')

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

describe('ClaudeAccountService removal and live PTY guards', () => {
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

  it('durably restores account state before credentials are touched when removal refresh fails', async () => {
    setPlatform('linux')
    tempDir = CLAUDE_SERVICE_TEST_ROOT
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
      clearClaudeAccountAuthVerdict: vi.fn(),
      getActiveClaudeSessionModel: vi.fn(() => null),
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
    tempDir = CLAUDE_SERVICE_TEST_ROOT
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

  it('allows deleting a noncandidate account during an ownerless shared launch', async () => {
    const { ClaudeAccountService } = await import('./service')
    const { releaseSharedClaudeAccountLaunch, reserveSharedClaudeAccountLaunch } =
      await import('./live-pty-gate')
    const service = new ClaudeAccountService({} as never, {} as never, {} as never)
    const result = { accounts: [], activeAccountId: null }
    ;(service as unknown as Record<string, ReturnType<typeof vi.fn>>).doRemoveAccount = vi.fn(
      async () => result
    )
    ;(service as unknown as Record<string, ReturnType<typeof vi.fn>>).doReauthenticateAccount =
      vi.fn(async () => result)
    const reservationId = reserveSharedClaudeAccountLaunch(null)
    try {
      await expect(service.removeAccount('account-1')).resolves.toBe(result)
      await expect(service.reauthenticateAccount('account-1')).rejects.toThrow(
        'global Claude terminal launch is still starting'
      )
    } finally {
      releaseSharedClaudeAccountLaunch(reservationId)
    }
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
      refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
      getActiveClaudeSessionModel: vi.fn(() => null)
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
})
