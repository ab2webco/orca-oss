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
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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

describe('ClaudeRuntimeAuthService vault instrumentation and shared home', () => {
  beforeEach(() => {
    resetRuntimeAuthTestState()
  })

  afterEach(() => {
    cleanupRuntimeAuthTestState()
  })

  it('merges the managed hook + statusline into a pinned host vault on launch prep', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    // Vault starts with only Orca-owned isolation keys — no hooks, no statusLine.
    writeFileSync(
      join(pinnedAuthPath, 'settings.json'),
      `${JSON.stringify({ skipDangerousModePermissionPrompt: true, theme: 'dark' })}\n`,
      'utf-8'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    await service.prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'pinned-host-account'
    })

    const vaultSettings = JSON.parse(
      readFileSync(join(pinnedAuthPath, 'settings.json'), 'utf-8')
    ) as {
      skipDangerousModePermissionPrompt?: boolean
      theme?: string
      hooks?: Record<string, { hooks: { command: string }[] }[]>
      statusLine?: { type: string; command: string }
    }
    // Existing isolation keys preserved.
    expect(vaultSettings.skipDangerousModePermissionPrompt).toBe(true)
    expect(vaultSettings.theme).toBe('dark')
    // Managed hook present on every load-bearing event → Orca learns the session id.
    for (const event of ['UserPromptSubmit', 'Stop', 'PreToolUse']) {
      expect(vaultSettings.hooks?.[event]?.[0]?.hooks?.[0]?.command ?? '').toContain(
        'agent-hooks/claude-hook'
      )
    }
    // Managed statusline present → pinned usage posts.
    expect(vaultSettings.statusLine?.type).toBe('command')
    expect(vaultSettings.statusLine?.command).toContain('claude-statusline')
  })

  it('instruments a pinned custom-endpoint vault while preserving its env token', async () => {
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
      `${JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'secret-endpoint-token'
        }
      })}\n`,
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
    const service = new ClaudeRuntimeAuthService(store as never)

    await service.prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'endpoint-account'
    })

    const vaultSettings = JSON.parse(
      readFileSync(join(managedAuthPath, 'settings.json'), 'utf-8')
    ) as {
      env?: Record<string, string>
      hooks?: Record<string, { hooks: { command: string }[] }[]>
      statusLine?: { command: string }
    }
    // The endpoint token env must never be clobbered by the merge.
    expect(vaultSettings.env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'secret-endpoint-token'
    })
    expect(vaultSettings.hooks?.Stop?.[0]?.hooks?.[0]?.command ?? '').toContain(
      'agent-hooks/claude-hook'
    )
    expect(vaultSettings.statusLine?.command).toContain('claude-statusline')
  })

  it('does not rewrite a pinned vault whose instrumentation is already current', async () => {
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

    const target: ClaudeAccountSelectionTarget = {
      runtime: 'host',
      overrideAccountId: 'pinned-host-account'
    }
    await service.prepareForClaudeLaunch(target)
    const vaultSettingsPath = join(pinnedAuthPath, 'settings.json')
    const firstContent = readFileSync(vaultSettingsPath, 'utf-8')
    const firstMtimeMs = statSync(vaultSettingsPath).mtimeMs

    // A second prep (e.g. reattach) must be a no-op: identical content, no rewrite.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await service.prepareForClaudeLaunch(target)

    expect(readFileSync(vaultSettingsPath, 'utf-8')).toBe(firstContent)
    expect(statSync(vaultSettingsPath).mtimeMs).toBe(firstMtimeMs)
  })

  it('joins the shared Claude home to the shared transcript store on a non-pinned launch', async () => {
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
    const homeProjects = join(testState.fakeHomeDir, '.claude', 'projects', '-Users-dev-repo')
    mkdirSync(homeProjects, { recursive: true })
    writeFileSync(join(homeProjects, 'from-home.jsonl'), '{"m":"home"}\n', 'utf-8')

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    await new ClaudeRuntimeAuthService(store as never).prepareForClaudeLaunch()

    // Why: non-pinned sessions and plain terminals outside Orca read this home, so
    // leaving it out of the store keeps `/resume` split from every pinned vault.
    expect(
      readFileSync(
        join(
          testState.userDataDir,
          'claude-transcripts',
          'projects',
          '-Users-dev-repo',
          'from-home.jsonl'
        ),
        'utf-8'
      )
    ).toBe('{"m":"home"}\n')
    expect(lstatSync(join(testState.fakeHomeDir, '.claude', 'projects')).isSymbolicLink()).toBe(
      true
    )
  })

  it('migrates a vault whose only claim on the account is this launch own reservation', async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    mkdirSync(join(pinnedAuthPath, 'projects', '-Users-dev-repo'), { recursive: true })
    writeFileSync(
      join(pinnedAuthPath, 'projects', '-Users-dev-repo', 'past.jsonl'),
      '{"m":"past"}\n',
      'utf-8'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')

    // reservePtyAccount is how real launches call this: the reservation lands
    // before instrumentation runs, so a guard counting reservations would read
    // this very launch as a live CLI and never migrate anything.
    await new ClaudeRuntimeAuthService(store as never).prepareForClaudeLaunch(
      { runtime: 'host', overrideAccountId: 'pinned-host-account' },
      { reservePtyAccount: true }
    )

    expect(lstatSync(join(pinnedAuthPath, 'projects')).isSymbolicLink()).toBe(true)
  })

  it("links a vault while another universe's Claude CLI is live", async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const vaultProjects = join(pinnedAuthPath, 'projects', '-Users-dev-repo')
    mkdirSync(vaultProjects, { recursive: true })
    writeFileSync(join(vaultProjects, 'past.jsonl'), '{"m":"past"}\n', 'utf-8')
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    // Why this must not defer: that CLI appends under the shared home, never under
    // this vault — and on a fan-out machine some CLI is always live somewhere, so
    // a global guard would leave this vault permanently unlinked (ORCA-111).
    markClaudePtySpawned('live-elsewhere', 'some-other-account')

    await new ClaudeRuntimeAuthService(store as never).prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'pinned-host-account'
    })

    expect(lstatSync(join(pinnedAuthPath, 'projects')).isSymbolicLink()).toBe(true)
    expect(
      readFileSync(
        join(
          testState.userDataDir,
          'claude-transcripts',
          'projects',
          '-Users-dev-repo',
          'past.jsonl'
        ),
        'utf-8'
      )
    ).toBe('{"m":"past"}\n')
    markClaudePtyExited('live-elsewhere')
  })

  it("links a vault while a shared-home CLI pinned to the vault's own account is live", async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const vaultProjects = join(pinnedAuthPath, 'projects', '-Users-dev-repo')
    mkdirSync(vaultProjects, { recursive: true })
    writeFileSync(join(vaultProjects, 'past.jsonl'), '{"m":"past"}\n', 'utf-8')
    const homeProjects = join(testState.fakeHomeDir, '.claude', 'projects', '-Users-dev-repo')
    mkdirSync(homeProjects, { recursive: true })
    writeFileSync(join(homeProjects, 'live.jsonl'), '{"m":"mid-append"}\n', 'utf-8')
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
    })
    const store = createStore(settings)
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    // Why the account id must not be the guard key: a shared PTY's account names
    // the credential it holds, not the universe it writes — it appends under
    // ~/.claude, so it cannot be mid-append on anything inside this vault.
    markClaudePtySpawned('shared-own-account', 'pinned-host-account')

    new ClaudeRuntimeAuthService(store as never).linkTranscriptUniversesWhenQuiet()

    expect(lstatSync(join(pinnedAuthPath, 'projects')).isSymbolicLink()).toBe(true)
    // The same PTY defers the universe it actually writes: the shared home.
    expect(lstatSync(join(testState.fakeHomeDir, '.claude', 'projects')).isSymbolicLink()).toBe(
      false
    )
    expect(existsSync(join(homeProjects, 'live.jsonl'))).toBe(true)
    markClaudePtyExited('shared-own-account')
  })

  it("defers a vault while the vault's own universe has a live injected CLI", async () => {
    const pinnedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'pinned-host-account',
      createClaudeCredentialsJson('pinned@example.com', 'pinned-token')
    )
    const vaultProjects = join(pinnedAuthPath, 'projects', '-Users-dev-repo')
    mkdirSync(vaultProjects, { recursive: true })
    writeFileSync(join(vaultProjects, 'live.jsonl'), '{"m":"mid-append"}\n', 'utf-8')
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('pinned-host-account', pinnedAuthPath)]
    })
    const store = createStore(settings)
    const { markInjectedClaudeCliExited, markInjectedClaudePtySpawned } =
      await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    markInjectedClaudePtySpawned('own-injected', 'pinned-host-account')

    await new ClaudeRuntimeAuthService(store as never).prepareForClaudeLaunch({
      runtime: 'host',
      overrideAccountId: 'pinned-host-account'
    })

    expect(existsSync(join(vaultProjects, 'live.jsonl'))).toBe(true)
    expect(lstatSync(join(pinnedAuthPath, 'projects')).isSymbolicLink()).toBe(false)
    markInjectedClaudeCliExited('own-injected', 'pinned-host-account')
  })

  it('defers the shared-home migration while any Claude CLI is live', async () => {
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
    const homeProjects = join(testState.fakeHomeDir, '.claude', 'projects', '-Users-dev-repo')
    mkdirSync(homeProjects, { recursive: true })
    writeFileSync(join(homeProjects, 'live.jsonl'), '{"m":"mid-append"}\n', 'utf-8')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    markClaudePtySpawned('live-home', null)

    await new ClaudeRuntimeAuthService(store as never).prepareForClaudeLaunch()

    expect(lstatSync(join(testState.fakeHomeDir, '.claude', 'projects')).isSymbolicLink()).toBe(
      false
    )
    expect(existsSync(join(homeProjects, 'live.jsonl'))).toBe(true)
    markClaudePtyExited('live-home')
  })

  it('joins the shared home while only an injected vault CLI is live', async () => {
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
    const homeProjects = join(testState.fakeHomeDir, '.claude', 'projects', '-Users-dev-repo')
    mkdirSync(homeProjects, { recursive: true })
    writeFileSync(join(homeProjects, 'from-home.jsonl'), '{"m":"home"}\n', 'utf-8')
    const { markInjectedClaudeCliExited, markInjectedClaudePtySpawned } =
      await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    // An injected CLI appends inside its own vault, never under ~/.claude.
    markInjectedClaudePtySpawned('pinned-elsewhere', 'some-other-account')

    await new ClaudeRuntimeAuthService(store as never).prepareForClaudeLaunch()

    expect(lstatSync(join(testState.fakeHomeDir, '.claude', 'projects')).isSymbolicLink()).toBe(
      true
    )
    markInjectedClaudeCliExited('pinned-elsewhere', 'some-other-account')
  })

  it('joins the home and every quiet host vault without any launch', async () => {
    const vaultOne = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    mkdirSync(join(vaultOne, 'projects', '-Users-dev-repo'), { recursive: true })
    writeFileSync(
      join(vaultOne, 'projects', '-Users-dev-repo', 'one.jsonl'),
      '{"m":"1"}\n',
      'utf-8'
    )
    const vaultTwo = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      createClaudeCredentialsJson('two@example.com', 'token-two')
    )
    mkdirSync(join(vaultTwo, 'projects', '-Users-dev-repo'), { recursive: true })
    writeFileSync(
      join(vaultTwo, 'projects', '-Users-dev-repo', 'two.jsonl'),
      '{"m":"2"}\n',
      'utf-8'
    )
    const wslVault = join(testState.userDataDir, 'claude-accounts', 'wsl-account', 'auth')
    mkdirSync(join(wslVault, 'projects', '-Users-dev-repo'), { recursive: true })
    writeFileSync(
      join(wslVault, 'projects', '-Users-dev-repo', 'wsl.jsonl'),
      '{"m":"w"}\n',
      'utf-8'
    )
    const homeProjects = join(testState.fakeHomeDir, '.claude', 'projects', '-Users-dev-repo')
    mkdirSync(homeProjects, { recursive: true })
    writeFileSync(join(homeProjects, 'home.jsonl'), '{"m":"h"}\n', 'utf-8')
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', vaultOne),
        createClaudeAccount('account-2', vaultTwo),
        createClaudeAccount('wsl-account', wslVault, { managedAuthRuntime: 'wsl' })
      ]
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')

    // Why no launch precedes this: a vault that is never launched is exactly the
    // one the account switch needs already linked (ORCA-111).
    new ClaudeRuntimeAuthService(store as never).linkTranscriptUniversesWhenQuiet()

    const sharedDir = join(
      testState.userDataDir,
      'claude-transcripts',
      'projects',
      '-Users-dev-repo'
    )
    expect(lstatSync(join(testState.fakeHomeDir, '.claude', 'projects')).isSymbolicLink()).toBe(
      true
    )
    expect(lstatSync(join(vaultOne, 'projects')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(vaultTwo, 'projects')).isSymbolicLink()).toBe(true)
    // A WSL vault's projects live inside the distro; this host-side dir must stay untouched.
    expect(lstatSync(join(wslVault, 'projects')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(sharedDir, 'one.jsonl'), 'utf-8')).toBe('{"m":"1"}\n')
    expect(readFileSync(join(sharedDir, 'two.jsonl'), 'utf-8')).toBe('{"m":"2"}\n')
    expect(readFileSync(join(sharedDir, 'home.jsonl'), 'utf-8')).toBe('{"m":"h"}\n')
    expect(existsSync(join(sharedDir, 'wsl.jsonl'))).toBe(false)
  })

  it('defers only the universe with a live CLI and links it once that CLI exits', async () => {
    const vaultOne = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      createClaudeCredentialsJson('one@example.com', 'token-one')
    )
    mkdirSync(join(vaultOne, 'projects', '-Users-dev-repo'), { recursive: true })
    writeFileSync(
      join(vaultOne, 'projects', '-Users-dev-repo', 'one.jsonl'),
      '{"m":"1"}\n',
      'utf-8'
    )
    const vaultTwo = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      createClaudeCredentialsJson('two@example.com', 'token-two')
    )
    mkdirSync(join(vaultTwo, 'projects', '-Users-dev-repo'), { recursive: true })
    writeFileSync(
      join(vaultTwo, 'projects', '-Users-dev-repo', 'two.jsonl'),
      '{"m":"2"}\n',
      'utf-8'
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', vaultOne),
        createClaudeAccount('account-2', vaultTwo)
      ]
    })
    const store = createStore(settings)
    const { markInjectedClaudeCliExited, markInjectedClaudePtySpawned } =
      await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    markInjectedClaudePtySpawned('busy-pty', 'account-1')

    service.linkTranscriptUniversesWhenQuiet()

    expect(lstatSync(join(vaultOne, 'projects')).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(vaultTwo, 'projects')).isSymbolicLink()).toBe(true)

    markInjectedClaudeCliExited('busy-pty', 'account-1')
    service.linkTranscriptUniversesWhenQuiet()

    expect(lstatSync(join(vaultOne, 'projects')).isSymbolicLink()).toBe(true)
    expect(
      readFileSync(
        join(
          testState.userDataDir,
          'claude-transcripts',
          'projects',
          '-Users-dev-repo',
          'one.jsonl'
        ),
        'utf-8'
      )
    ).toBe('{"m":"1"}\n')
  })
})
