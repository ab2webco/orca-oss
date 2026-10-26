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
  setPlatform,
  testState
} from './runtime-auth-service-test-harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeAccountSelectionTarget } from './runtime-selection'

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

describe('ClaudeRuntimeAuthService injected accounts', () => {
  beforeEach(() => {
    resetRuntimeAuthTestState()
  })

  afterEach(() => {
    cleanupRuntimeAuthTestState()
  })

  it('injects a worktree-pinned WSL account instead of the global WSL selection', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const globalAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'global-account',
      createClaudeCredentialsJson('global@example.com', 'global-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('pinned-account', pinnedAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/pinned/auth'
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
      wslDistro: 'Ubuntu',
      overrideAccountId: 'pinned-account'
    })

    expect(preparation).toMatchObject({
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      wslLinuxConfigDir: '/home/alice/.local/share/orca/claude-accounts/pinned/auth',
      provenance: 'managed:pinned-account:wsl:injected:Ubuntu',
      stripAuthEnv: true
    })
    // The override bypasses materialization entirely: the global WSL selection
    // (still pointing at global-account) must be left untouched.
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('hasInjectedAccountOverride reports whether a target resolves to a valid pinned account', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)],
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    // A target whose overrideAccountId resolves to a valid owned host account
    // is reported as injected — this is the synchronous check the PTY spawn
    // gate uses to exempt the launch from the global switch-block.
    expect(
      service.hasInjectedAccountOverride({
        runtime: 'host',
        overrideAccountId: 'pinned-host-account'
      })
    ).toBe(true)

    // No override at all: falls back to global selection, not injected.
    expect(service.hasInjectedAccountOverride({ runtime: 'host' })).toBe(false)

    // Override pointing at an account that does not exist: falls back to
    // global selection, not injected.
    expect(
      service.hasInjectedAccountOverride({
        runtime: 'host',
        overrideAccountId: 'no-such-account'
      })
    ).toBe(false)

    store.updateSettings({ activeClaudeManagedAccountId: 'pinned-host-account' })
    expect(
      service.hasInjectedAccountOverride({
        runtime: 'host',
        overrideAccountId: 'pinned-host-account'
      })
    ).toBe(true)
  })

  it('probes WSL ownership asynchronously once and reuses the cached result', async () => {
    setPlatform('win32')
    const linuxAuthPath = '/home/alice/.local/share/orca/claude-accounts/pinned-wsl/auth'
    const canonicalLinuxAuthPath =
      '/home/alice/.local/share/orca/claude-accounts/pinned-wsl-canonical/auth'
    const managedAuthPath =
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\claude-accounts\\pinned-wsl\\auth'
    let finishProbe = (_error: Error | null, _stdout: string, _stderr: string): void => {
      throw new Error('WSL ownership probe did not start')
    }
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        finishProbe = callback
        return { kill: vi.fn() }
      }
    )
    vi.doMock('node:child_process', () => ({ execFile }))
    vi.doMock('../wsl', async () => {
      const actual = (await vi.importActual('../wsl')) as Record<string, unknown>
      return {
        ...actual,
        getCachedWslDistros: () => ['Ubuntu'],
        getDefaultWslDistro: () => 'Ubuntu',
        listWslDistrosAsync: async () => ['Ubuntu'],
        toWindowsWslPath: (linuxPath: string, distro: string) =>
          `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, '\\')}`
      }
    })
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('pinned-wsl', managedAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: linuxAuthPath
        })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)
    const target = {
      runtime: 'wsl' as const,
      wslDistro: 'Ubuntu',
      overrideAccountId: 'pinned-wsl'
    }

    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)

      expect(service.hasInjectedAccountOverride(target)).toBe(true)
      expect(execFile).not.toHaveBeenCalled()

      const first = service.prepareForClaudeLaunch(target)
      const second = service.prepareForClaudeLaunch(target)
      await Promise.resolve()
      expect(execFile).toHaveBeenCalledTimes(1)
      // The production execFile has a custom promisifier returning { stdout,
      // stderr }; this lightweight mock must provide that same resolved shape.
      finishProbe(
        null,
        { stdout: `${canonicalLinuxAuthPath}\n`, stderr: '' } as unknown as string,
        ''
      )

      const preparations = await Promise.all([first, second])
      expect(preparations[0].envPatch).toEqual({ CLAUDE_CONFIG_DIR: canonicalLinuxAuthPath })
      expect((await service.prepareForClaudeLaunch(target)).envPatch).toEqual({
        CLAUDE_CONFIG_DIR: canonicalLinuxAuthPath
      })
      expect(execFile).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('node:child_process')
    }
  })

  it('deduplicates simultaneous cold default-WSL distro lookups', async () => {
    setPlatform('win32')
    let resolveDistros: (distros: string[]) => void = () => {
      throw new Error('WSL distro lookup did not start')
    }
    const listWslDistrosAsync = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveDistros = resolve
        })
    )
    vi.doMock('../wsl', async () => {
      const actual = (await vi.importActual('../wsl')) as Record<string, unknown>
      return { ...actual, listWslDistrosAsync }
    })
    const store = createStore(createSettings())
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const resolveTarget = (
      service as unknown as {
        resolveWslDefaultTargetForLaunch(target: {
          runtime: 'wsl'
          wslDistro: null
        }): Promise<ClaudeAccountSelectionTarget>
      }
    ).resolveWslDefaultTargetForLaunch.bind(service)

    const first = resolveTarget({ runtime: 'wsl', wslDistro: null })
    const second = resolveTarget({ runtime: 'wsl', wslDistro: null })
    await Promise.resolve()

    expect(listWslDistrosAsync).toHaveBeenCalledTimes(1)
    resolveDistros(['Ubuntu'])
    await expect(Promise.all([first, second])).resolves.toEqual([
      { runtime: 'wsl', wslDistro: 'Ubuntu' },
      { runtime: 'wsl', wslDistro: 'Ubuntu' }
    ])
  })

  it('prepares an injected account without entering the shared auth mutation queue', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const sync = vi.spyOn(service, 'syncForCurrentSelection')

    const preparation = await service.prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'pinned-host-account'
    })

    expect(sync).not.toHaveBeenCalled()
    expect(preparation).toMatchObject({
      configDir: pinnedAuthPath,
      envPatch: { CLAUDE_CONFIG_DIR: pinnedAuthPath },
      provenance: 'managed:pinned-host-account:injected'
    })
  })

  // ORCA-189: a pinned launch never reads ~/.claude/settings.json, so the user's
  // no-AI-attribution rule silently stopped applying in every managed session.
  it('inherits the user home settings into the vault before a pinned launch', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    writeFileSync(
      join(pinnedAuthPath, 'settings.json'),
      `${JSON.stringify({ theme: 'dark', env: { ANTHROPIC_AUTH_TOKEN: 'vault-token' } })}\n`,
      'utf-8'
    )
    mkdirSync(join(testState.fakeHomeDir, '.claude'), { recursive: true })
    writeFileSync(
      join(testState.fakeHomeDir, '.claude', 'settings.json'),
      JSON.stringify({
        includeCoAuthoredBy: false,
        attribution: { commit: '', pr: '' },
        permissions: { allow: ['Bash(npm test)'] },
        env: { ANTHROPIC_AUTH_TOKEN: 'home-token' }
      }),
      'utf-8'
    )
    const store = createStore(
      createSettings({
        claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
      })
    )
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    await service.prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'pinned-host-account'
    })

    const vault = JSON.parse(readFileSync(join(pinnedAuthPath, 'settings.json'), 'utf-8'))
    expect(vault.includeCoAuthoredBy).toBe(false)
    expect(vault.attribution).toEqual({ commit: '', pr: '' })
    expect(vault.permissions).toEqual({ allow: ['Bash(npm test)'] })
    // The vault keeps its own identity- and Orca-owned keys.
    expect(vault.env).toEqual({ ANTHROPIC_AUTH_TOKEN: 'vault-token' })
    expect(vault.theme).toBe('dark')
  })

  it('injects a pinned custom-endpoint account without seeding the scoped Keychain (macOS)', async () => {
    // Custom-endpoint accounts have no Anthropic credentials: only a marker and
    // a settings.json whose env carries the endpoint token for the CLI.
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
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { writeActiveClaudeKeychainCredentials, writeManagedClaudeKeychainCredentials } =
      await import('./keychain')
    const service = new ClaudeRuntimeAuthService(store as never)

    const preparation = await service.prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'endpoint-account'
    })

    expect(preparation).toMatchObject({
      configDir: managedAuthPath,
      envPatch: { CLAUDE_CONFIG_DIR: managedAuthPath },
      stripAuthEnv: true,
      injectedAccountId: 'endpoint-account',
      provenance: 'managed:endpoint-account:injected'
    })
    // The seed path is credential-based and must be skipped for endpoint accounts.
    expect(writeActiveClaudeKeychainCredentials).not.toHaveBeenCalled()
    expect(writeManagedClaudeKeychainCredentials).not.toHaveBeenCalled()
  })
})
