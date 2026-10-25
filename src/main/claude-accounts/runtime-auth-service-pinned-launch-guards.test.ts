import {
  cleanupRuntimeAuthTestState,
  createClaudeAccount,
  createClaudeCredentialsJson,
  createElectronMock,
  createKeychainMock,
  createManagedClaudeAuth,
  createOauthRefreshMock,
  createSettings,
  createStore,
  resetRuntimeAuthTestState,
  testState
} from './runtime-auth-service-test-harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'
import { isOauthTokenExpiring, refreshClaudeOauthCredentials } from './oauth-refresh'

vi.mock('electron', () => createElectronMock())

vi.mock('./oauth-refresh', () => createOauthRefreshMock())

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

vi.mock('./keychain', () => createKeychainMock())

describe('ClaudeRuntimeAuthService pinned launch guards', () => {
  beforeEach(() => {
    resetRuntimeAuthTestState()
  })

  afterEach(() => {
    cleanupRuntimeAuthTestState()
  })

  it('keeps an explicit pin isolated when it matches the global account', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', pinnedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    const preparation = await service.prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'account-1'
    })

    expect(preparation).toMatchObject({
      configDir: pinnedAuthPath,
      envPatch: { CLAUDE_CONFIG_DIR: pinnedAuthPath },
      injectedAccountId: 'account-1',
      provenance: 'managed:account-1:injected'
    })
  })

  it('fails closed when a same-as-global explicit pin cannot be resolved', async () => {
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    vi.spyOn(
      service as unknown as {
        resolveInjectedAccount(): Promise<ClaudeManagedAccount | null>
      },
      'resolveInjectedAccount'
    ).mockResolvedValue(null)

    await expect(
      service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'account-1' })
    ).rejects.toThrow('assigned to this worktree is unavailable')
  })

  it('reserves a global account through PTY spawn preparation', async () => {
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { releaseSharedClaudeAccountLaunch, reserveInjectedClaudeAccountLaunch } =
      await import('./live-pty-gate')
    const service = new ClaudeRuntimeAuthService(store as never)

    const preparation = await service.prepareForClaudeLaunch(undefined, {
      reservePtyAccount: true
    })
    try {
      expect(preparation.sharedAccountReservationId).toEqual(expect.any(String))
      expect(() => reserveInjectedClaudeAccountLaunch('account-1')).toThrow(
        'being launched globally'
      )
    } finally {
      releaseSharedClaudeAccountLaunch(preparation.sharedAccountReservationId)
    }
  })

  // ORCA-553 acceptance: an automation's launch-scoped account is not blocked by the global one.
  it('launches with a launch-scoped account while the global account is in use by an assigned worktree', async () => {
    const globalAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const automationAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      createClaudeCredentialsJson('two@example.com', 'token-two')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', globalAuthPath),
        createClaudeAccount('account-2', automationAuthPath, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const {
      markClaudePtyExited,
      markInjectedClaudePtySpawned,
      releaseInjectedClaudeAccountLaunch
    } = await import('./live-pty-gate')
    markInjectedClaudePtySpawned('assigned-worktree-pty', 'account-1')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)

      await expect(
        service.prepareForClaudeLaunch(undefined, { reservePtyAccount: true })
      ).rejects.toThrow('in use by an assigned worktree')
      const preparation = await service.prepareForClaudeLaunch(
        { runtime: 'host', overrideAccountId: 'account-2' },
        { reservePtyAccount: true }
      )
      expect(preparation).toMatchObject({ injectedAccountId: 'account-2' })
      expect(preparation.sharedAccountReservationId).toBeUndefined()
      releaseInjectedClaudeAccountLaunch(preparation.injectedAccountReservationId)
    } finally {
      markClaudePtyExited('assigned-worktree-pty')
    }
  })

  it('rejects a same-account pin while the shared global CLI still owns its token', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', pinnedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    // Why the account argument: the global CLI runs THIS account's chain, and the
    // gate now blocks the account it can name instead of every account (ORCA-190).
    markClaudePtySpawned('global-pty', 'account-1')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)
      await expect(
        service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'account-1' })
      ).rejects.toThrow('already in use by a global terminal')
    } finally {
      markClaudePtyExited('global-pty')
    }
  })

  it('launches a pinned custom-endpoint account even while a global terminal is live', async () => {
    // A custom-endpoint account reads a static token from its own settings.json,
    // so a live shared terminal has no single-use OAuth chain to fork — the
    // failover target (always custom-endpoint) must stay launchable and reattachable.
    const managedAuthPath = join(
      testState.userDataDir,
      'claude-accounts',
      'endpoint-account',
      'auth'
    )
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'endpoint-account\n', 'utf-8')
    writeFileSync(
      join(managedAuthPath, 'settings.json'),
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic' } })}\n`,
      'utf-8'
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('endpoint-account', managedAuthPath, {
          email: 'z.ai · GLM',
          authMethod: 'custom-endpoint',
          endpointLabel: 'z.ai · GLM',
          endpointBaseUrl: 'https://api.z.ai/api/anthropic',
          endpointModel: 'glm-5.1'
        })
      ]
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markClaudePtySpawned, reserveInjectedClaudeAccountLaunch } =
      await import('./live-pty-gate')
    // A global terminal with an unknown (null) account binding — the exact state
    // that used to block every pinned launch.
    markClaudePtySpawned('global-pty')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)

      const preparation = await service.prepareForClaudeLaunch(
        { runtime: 'host', overrideAccountId: 'endpoint-account' },
        { reservePtyAccount: true }
      )

      expect(preparation).toMatchObject({
        injectedAccountId: 'endpoint-account',
        provenance: 'managed:endpoint-account:injected'
      })
      // The reservation must have succeeded despite the live global terminal.
      expect(preparation.injectedAccountReservationId).toEqual(expect.any(String))
    } finally {
      markClaudePtyExited('global-pty')
    }

    // Sanity: without the exemption, the low-level gate still blocks a normal
    // (OAuth) reservation while that global terminal is live.
    markClaudePtySpawned('global-pty-2', 'some-oauth-account')
    try {
      expect(() => reserveInjectedClaudeAccountLaunch('some-oauth-account')).toThrow(
        'already in use by a global terminal'
      )
      expect(() =>
        reserveInjectedClaudeAccountLaunch('endpoint-account', { allowLiveSharedPtys: true })
      ).not.toThrow()
    } finally {
      markClaudePtyExited('global-pty-2')
    }
  })

  it('allows reattaching to a live injected OAuth PTY despite a live global terminal', async () => {
    // Reattach cannot fork the refresh chain: the pinned CLI process already
    // owns it. Only the reattach path is exempt — fresh launches still block.
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', pinnedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markClaudePtySpawned, markInjectedClaudePtySpawned } =
      await import('./live-pty-gate')
    // The exact stuck state from the field: a global terminal on this same account
    // plus the pinned session's own live CLI.
    markClaudePtySpawned('global-pty', 'account-1')
    markInjectedClaudePtySpawned('injected-session', 'account-1')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)

      const preparation = await service.prepareForClaudeLaunch(
        { runtime: 'host', overrideAccountId: 'account-1' },
        { reservePtyAccount: true, reattachLiveInjectedPtyId: 'injected-session' }
      )
      expect(preparation).toMatchObject({
        injectedAccountId: 'account-1',
        provenance: 'managed:account-1:injected'
      })

      // A DIFFERENT session id (or none) is a fresh launch and must still block.
      await expect(
        service.prepareForClaudeLaunch(
          { runtime: 'host', overrideAccountId: 'account-1' },
          { reattachLiveInjectedPtyId: 'some-other-session' }
        )
      ).rejects.toThrow('already in use by a global terminal')
      await expect(
        service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'account-1' })
      ).rejects.toThrow('already in use by a global terminal')
    } finally {
      markClaudePtyExited('global-pty')
      markClaudePtyExited('injected-session')
    }
  })

  it('rejects pinned account A after the global selection switches from live A to B', async () => {
    const accountAPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-a',
      createClaudeCredentialsJson('a@example.com', 'token-a')
    )
    const accountBPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-b',
      createClaudeCredentialsJson('b@example.com', 'token-b')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-a', accountAPath),
        createClaudeAccount('account-b', accountBPath)
      ],
      activeClaudeManagedAccountId: 'account-b'
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    markClaudePtySpawned('global-a-pty', 'account-a')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)

      await expect(
        service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'account-a' })
      ).rejects.toThrow('already in use by a global terminal')
    } finally {
      markClaudePtyExited('global-a-pty')
    }
  })

  it('refuses to materialize shared auth while the same injected account is live', async () => {
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markInjectedClaudePtySpawned } = await import('./live-pty-gate')
    markInjectedClaudePtySpawned('injected-pty', 'account-1')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)

      await expect(service.syncForCurrentSelection()).rejects.toThrow('assigned worktree')
    } finally {
      markClaudePtyExited('injected-pty')
    }
  })

  it('switches global accounts without reading back over a live pinned predecessor', async () => {
    const accountAPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-a',
      createClaudeCredentialsJson('a@example.com', 'token-a')
    )
    const accountBPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-b',
      createClaudeCredentialsJson('b@example.com', 'token-b')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-a', accountAPath),
        createClaudeAccount('account-b', accountBPath)
      ],
      activeClaudeManagedAccountId: 'account-a'
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()
    const readBack = vi.spyOn(
      service as unknown as {
        readBackRefreshedTokens(...args: unknown[]): Promise<unknown>
      },
      'readBackRefreshedTokens'
    )
    const { markClaudePtyExited, markInjectedClaudePtySpawned } = await import('./live-pty-gate')
    markInjectedClaudePtySpawned('injected-a', 'account-a')
    try {
      store.updateSettings({
        activeClaudeManagedAccountId: 'account-b',
        activeClaudeManagedAccountIdsByRuntime: { host: 'account-b', wsl: {} }
      })

      await service.syncForCurrentSelection()

      expect(readBack).not.toHaveBeenCalled()
    } finally {
      markClaudePtyExited('injected-a')
    }
  })

  it('fails closed when the pinned account WSL distro does not match the launch', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-debian-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const ubuntuAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'ubuntu-account',
      createClaudeCredentialsJson('ubuntu@example.com', 'ubuntu-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('pinned-debian-account', pinnedAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Debian',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/pinned-debian/auth'
        }),
        createClaudeAccount('ubuntu-account', ubuntuAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/ubuntu/auth'
        })
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: 'ubuntu-account' } }
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await expect(
      service.prepareForClaudeLaunch({
        runtime: 'wsl',
        wslDistro: 'Ubuntu',
        overrideAccountId: 'pinned-debian-account'
      })
    ).rejects.toThrow('assigned to this worktree is unavailable')
  })

  it('injects a default-WSL pinned account (wslDistro: null) when the launch resolves to the default distro', async () => {
    // Regression: resolveWslDefaultTarget turns a distro-less WSL launch into
    // the concrete default distro, so a default-WSL account stored with
    // wslDistro: null must still match (both canonicalize to the default)
    // instead of silently falling back to the global WSL selection.
    vi.doMock('../wsl', async () => {
      const actual = (await vi.importActual('../wsl')) as Record<string, unknown>
      return {
        ...actual,
        getCachedWslDistros: () => ['Ubuntu'],
        getDefaultWslDistro: () => 'Ubuntu',
        listWslDistrosAsync: async () => ['Ubuntu']
      }
    })
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'default-wsl-account',
      createClaudeCredentialsJson('default@example.com', 'default-token')
    )
    const globalAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'global-account',
      createClaudeCredentialsJson('global@example.com', 'global-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('default-wsl-account', pinnedAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: null,
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/default-wsl/auth'
        }),
        createClaudeAccount('global-account', globalAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/global/auth'
        })
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: 'global-account' } }
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch({
      runtime: 'wsl',
      wslDistro: null,
      overrideAccountId: 'default-wsl-account'
    })

    expect(preparation).toMatchObject({
      runtime: 'wsl',
      wslDistro: null,
      wslLinuxConfigDir: '/home/alice/.local/share/orca/claude-accounts/default-wsl/auth',
      provenance: 'managed:default-wsl-account:wsl:injected:',
      stripAuthEnv: true
    })
    // The pin resolved: the global WSL selection is left untouched...
    expect(store.updateSettings).not.toHaveBeenCalled()
    // ...and the PTY spawn gate sees it as injected.
    expect(
      service.hasInjectedAccountOverride({
        runtime: 'wsl',
        wslDistro: null,
        overrideAccountId: 'default-wsl-account'
      })
    ).toBe(true)
  })

  it('does not re-seed the scoped Keychain when Claude already owns valid creds for an injected host account (macOS)', async () => {
    // Regression: injected host launches seed the config-dir-scoped Keychain
    // from the managed copy. Once Claude owns that scoped service it may hold a
    // rotated refresh token (injected accounts are CLI-owned, no read-back);
    // re-seeding the static managed copy would clobber it. If valid creds
    // already exist in the scoped service, leave them.
    const managed = createClaudeCredentialsJson('pinned@example.com', 'managed-token', null, 1_000)
    const managedAuthPath = createManagedClaudeAuth(testState.userDataDir, 'pinned-host', managed)
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host', managedAuthPath)],
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)

    const keychain = await import('./keychain')
    const readStrict = vi.mocked(keychain.readActiveClaudeKeychainCredentialsStrict)
    const originalReadImpl = readStrict.getMockImplementation()
    const rotated = createClaudeCredentialsJson('pinned@example.com', 'rotated-token', null, 2_000)
    // Claude's scoped service for this account's own config dir already holds
    // rotated creds.
    readStrict.mockImplementation(async (configDir?: string) =>
      configDir === managedAuthPath
        ? rotated
        : originalReadImpl
          ? originalReadImpl(configDir)
          : null
    )
    const write = vi.mocked(keychain.writeActiveClaudeKeychainCredentials)

    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)
      await service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'pinned-host' })

      // The rotated scoped creds must survive: no re-seed write to the account's
      // own config dir.
      expect(write).not.toHaveBeenCalledWith(expect.anything(), managedAuthPath)
      expect(testState.managedKeychainCredentials.get('pinned-host')).toBe(rotated)
    } finally {
      if (originalReadImpl) {
        readStrict.mockImplementation(originalReadImpl)
      } else {
        readStrict.mockReset()
      }
    }
  })

  it('adopts fresher injected scoped credentials before using the account globally (macOS)', async () => {
    const managed = createClaudeCredentialsJson('user@example.com', 'managed-token', null, 1_000)
    const rotated = createClaudeCredentialsJson('user@example.com', 'rotated-token', null, 2_000)
    const managedAuthPath = createManagedClaudeAuth(testState.userDataDir, 'account-1', managed)
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const keychain = await import('./keychain')
    const readStrict = vi.mocked(keychain.readActiveClaudeKeychainCredentialsStrict)
    const originalReadImpl = readStrict.getMockImplementation()
    readStrict.mockImplementation(async (configDir?: string) =>
      configDir === managedAuthPath
        ? rotated
        : originalReadImpl
          ? originalReadImpl(configDir)
          : null
    )

    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)
      await service.syncForCurrentSelection({ runtime: 'host' })

      expect(testState.managedKeychainCredentials.get('account-1')).toBe(rotated)
    } finally {
      if (originalReadImpl) {
        readStrict.mockImplementation(originalReadImpl)
      } else {
        readStrict.mockReset()
      }
    }
  })

  it('fails closed when a WSL-pinned account is used for a host launch', async () => {
    const wslAccountPath = createManagedClaudeAuth(
      testState.userDataDir,
      'wsl-account',
      createClaudeCredentialsJson('wsl@example.com', 'wsl-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('wsl-account', wslAccountPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/wsl-account/auth'
        })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await expect(
      service.prepareForClaudeLaunch({
        runtime: 'host',
        overrideAccountId: 'wsl-account'
      })
    ).rejects.toThrow('assigned to this worktree is unavailable')
  })

  it('fails closed when the pinned account no longer exists', async () => {
    const settings = createSettings({ claudeManagedAccounts: [] })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    await expect(
      service.prepareForClaudeLaunch({
        runtime: 'host',
        overrideAccountId: 'deleted-account'
      })
    ).rejects.toThrow('assigned to this worktree is unavailable')
  })

  it('repairs an existing injected scoped Keychain copy after global refresh', async () => {
    const account1Stale = createClaudeCredentialsJson('one@example.com', 'one-stale', null, 1_000)
    const account1Refreshed = createClaudeCredentialsJson(
      'one@example.com',
      'one-refreshed',
      null,
      9_999_999_999_999
    )
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Stale
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'one@example.com' })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)
    const keychain = await import('./keychain')
    const readStrict = vi.mocked(keychain.readActiveClaudeKeychainCredentialsStrict)
    const writeScoped = vi.mocked(keychain.writeActiveClaudeKeychainCredentials)
    const originalReadImpl = readStrict.getMockImplementation()
    const originalWriteImpl = writeScoped.getMockImplementation()
    let injectedScopedCredentials = account1Stale
    readStrict.mockImplementation(async (configDir?: string) =>
      configDir === managedAuthPath
        ? injectedScopedCredentials
        : originalReadImpl
          ? originalReadImpl(configDir)
          : null
    )
    writeScoped.mockImplementation(async (contents: string, configDir?: string) => {
      if (configDir === managedAuthPath) {
        injectedScopedCredentials = contents
        return
      }
      await originalWriteImpl?.(contents, configDir)
    })

    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)
      await service.syncForCurrentSelection()
      vi.mocked(isOauthTokenExpiring).mockReturnValueOnce(true)
      vi.mocked(refreshClaudeOauthCredentials).mockResolvedValueOnce(account1Refreshed)
      store.updateSettings({ activeClaudeManagedAccountId: 'account-1' })

      await service.syncForCurrentSelection()

      expect(injectedScopedCredentials).toBe(account1Refreshed)
    } finally {
      if (originalReadImpl) {
        readStrict.mockImplementation(originalReadImpl)
      }
      if (originalWriteImpl) {
        writeScoped.mockImplementation(originalWriteImpl)
      }
    }
  })

  it('reads the active account usage from its own config dir while a pinned CLI owns it', async () => {
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'one-token', null, 9_999_999_999_999)
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { markInjectedClaudePtySpawned, markClaudePtyExited } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    markInjectedClaudePtySpawned('pinned-pty-1', 'account-1')
    try {
      // Why: syncing here used to throw 'in use by an assigned worktree', leaving
      // the ACTIVE account's usage permanently stuck on a refresh error.
      const preparation = await service.prepareForRateLimitFetch()
      expect(preparation.configDir).toBe(managedAuthPath1)
      expect(preparation.managedRefreshDeferredByLivePty).toBe(true)
      expect(preparation.provenance).toBe('managed:account-1:live-pinned-read')
      expect(refreshClaudeOauthCredentials).not.toHaveBeenCalled()
    } finally {
      markClaudePtyExited('pinned-pty-1')
    }
  })
})
