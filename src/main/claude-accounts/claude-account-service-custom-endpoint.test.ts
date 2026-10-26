import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'
import { restorePlatform, setPlatform } from './claude-account-service-test-harness'
import {
  readActiveClaudeKeychainCredentialsStrict,
  writeManagedClaudeKeychainCredentials
} from './keychain'

const CLAUDE_SERVICE_TEST_ROOT = join(tmpdir(), 'orca-claude-service-custom-endpoint-test')

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

describe('ClaudeAccountService custom endpoint accounts', () => {
  let tempDir: string | null = null

  beforeEach(() => {
    setPlatform('linux')
    tempDir = CLAUDE_SERVICE_TEST_ROOT
    rmSync(tempDir, { recursive: true, force: true })
  })

  afterEach(() => {
    restorePlatform()
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
      clearClaudeAccountAuthVerdict: vi.fn(),
      getActiveClaudeSessionModel: vi.fn(() => null),
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
})

describe('ClaudeAccountService.addAccountFromConfigDir', () => {
  const managedRoot = CLAUDE_SERVICE_TEST_ROOT
  let sourceDir: string | null = null

  beforeEach(() => {
    setPlatform('linux')
    rmSync(managedRoot, { recursive: true, force: true })
    sourceDir = null
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockReset()
    vi.mocked(writeManagedClaudeKeychainCredentials).mockReset().mockResolvedValue()
  })

  afterEach(() => {
    restorePlatform()
    rmSync(managedRoot, { recursive: true, force: true })
    if (sourceDir) {
      rmSync(sourceDir, { recursive: true, force: true })
    }
  })

  function makeDeps() {
    let settings = {
      claudeManagedAccounts: [] as ClaudeManagedAccount[],
      activeClaudeManagedAccountId: null as string | null,
      activeClaudeManagedAccountIdsByRuntime: { host: null as string | null, wsl: {} }
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<typeof settings>) => {
        settings = { ...settings, ...updates }
        return settings
      })
    }
    const rateLimits = { evictInactiveClaudeCache: vi.fn() }
    const runtimeAuth = {
      clearLastWrittenCredentialsJson: vi.fn(),
      forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
    }
    return { store, rateLimits, runtimeAuth, getSettings: () => settings }
  }

  it('registers a managed account by capturing an authenticated config dir', async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'orca-claude-source-'))
    writeFileSync(
      join(sourceDir, '.credentials.json'),
      '{"claudeAiOauth":{"accessToken":"tok"}}\n',
      'utf-8'
    )
    writeFileSync(
      join(sourceDir, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'new@example.com' } }),
      'utf-8'
    )

    const deps = makeDeps()
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      deps.store as never,
      deps.rateLimits as never,
      deps.runtimeAuth as never
    )
    // Why: avoid spawning a real `claude auth status` subprocess in the test.
    ;(service as unknown as { runClaudeCommand: () => Promise<string> }).runClaudeCommand = vi.fn(
      async () => '{"email":"new@example.com"}'
    )

    const result = await service.addAccountFromConfigDir(sourceDir)

    const accounts = deps.getSettings().claudeManagedAccounts
    expect(accounts).toHaveLength(1)
    expect(accounts[0].email).toBe('new@example.com')
    expect(result.accounts[0]?.email).toBe('new@example.com')
    expect(readFileSync(join(accounts[0].managedAuthPath, '.credentials.json'), 'utf-8')).toBe(
      '{"claudeAiOauth":{"accessToken":"tok"}}\n'
    )
    expect(deps.runtimeAuth.clearLastWrittenCredentialsJson).toHaveBeenCalledWith(accounts[0].id)
  })

  it('captures only the config-scoped macOS Keychain credential', async () => {
    setPlatform('darwin')
    sourceDir = mkdtempSync(join(tmpdir(), 'orca-claude-source-keychain-'))
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (configDir) =>
      configDir ? '{"claudeAiOauth":{"accessToken":"scoped"}}' : 'legacy-credentials'
    )
    const deps = makeDeps()
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      deps.store as never,
      deps.rateLimits as never,
      deps.runtimeAuth as never
    )
    ;(service as unknown as { runClaudeCommand: () => Promise<string> }).runClaudeCommand = vi.fn(
      async () => '{"email":"new@example.com"}'
    )

    await service.addAccountFromConfigDir(sourceDir)

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(sourceDir)
    expect(writeManagedClaudeKeychainCredentials).toHaveBeenCalledWith(
      expect.any(String),
      '{"claudeAiOauth":{"accessToken":"scoped"}}'
    )
  })

  it('does not mistake an unchanged legacy Keychain credential for the temp login', async () => {
    setPlatform('darwin')
    sourceDir = mkdtempSync(join(tmpdir(), 'orca-claude-source-keychain-empty-'))
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (configDir) =>
      configDir ? null : 'legacy-credentials'
    )
    const deps = makeDeps()
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      deps.store as never,
      deps.rateLimits as never,
      deps.runtimeAuth as never
    )
    ;(service as unknown as { runClaudeCommand: () => Promise<string> }).runClaudeCommand = vi.fn(
      async () => '{"email":"existing@example.com"}'
    )

    await expect(service.addAccountFromConfigDir(sourceDir)).rejects.toThrow(
      'no OAuth credentials were captured'
    )
    expect(deps.getSettings().claudeManagedAccounts).toHaveLength(0)
  })

  it('captures a legacy Keychain credential that changed after login began', async () => {
    setPlatform('darwin')
    sourceDir = mkdtempSync(join(tmpdir(), 'orca-claude-source-keychain-legacy-'))
    const previousCredentials = '{"claudeAiOauth":{"accessToken":"previous"}}'
    const newCredentials = '{"claudeAiOauth":{"accessToken":"new","email":"new@example.com"}}'
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (configDir) =>
      configDir ? null : newCredentials
    )
    const deps = makeDeps()
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      deps.store as never,
      deps.rateLimits as never,
      deps.runtimeAuth as never
    )
    ;(service as unknown as { runClaudeCommand: () => Promise<string> }).runClaudeCommand = vi.fn(
      async () => '{"email":"new@example.com"}'
    )

    await service.addAccountFromConfigDir(sourceDir, {
      previousLegacyCredentialsSha256: createHash('sha256')
        .update(previousCredentials)
        .digest('hex')
    })

    expect(writeManagedClaudeKeychainCredentials).toHaveBeenCalledWith(
      expect.any(String),
      newCredentials
    )
    expect(deps.getSettings().claudeManagedAccounts[0]?.email).toBe('new@example.com')
  })

  it('still registers when the daemon cannot spawn `claude auth status`', async () => {
    // Why: `allowFailure` covers a non-zero exit but not a spawn error, so a daemon
    // started with a minimal PATH would hard-fail an add the user already signed in for.
    sourceDir = mkdtempSync(join(tmpdir(), 'orca-claude-source-nostatus-'))
    writeFileSync(
      join(sourceDir, '.credentials.json'),
      '{"claudeAiOauth":{"accessToken":"tok"}}\n',
      'utf-8'
    )
    writeFileSync(
      join(sourceDir, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'new@example.com' } }),
      'utf-8'
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = makeDeps()
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      deps.store as never,
      deps.rateLimits as never,
      deps.runtimeAuth as never
    )
    ;(service as unknown as { runClaudeCommand: () => Promise<string> }).runClaudeCommand = vi.fn(
      async () => {
        throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
      }
    )

    const result = await service.addAccountFromConfigDir(sourceDir)

    expect(result.accounts[0]?.email).toBe('new@example.com')
    expect(deps.getSettings().claudeManagedAccounts).toHaveLength(1)
    warn.mockRestore()
  })

  it('rejects and rolls back when the config dir has no credentials', async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'orca-claude-source-empty-'))
    const deps = makeDeps()
    const { ClaudeAccountService } = await import('./service')
    const service = new ClaudeAccountService(
      deps.store as never,
      deps.rateLimits as never,
      deps.runtimeAuth as never
    )

    await expect(service.addAccountFromConfigDir(sourceDir)).rejects.toThrow(
      /No Claude credentials found/
    )
    expect(deps.getSettings().claudeManagedAccounts).toHaveLength(0)
    expect(deps.runtimeAuth.forceMaterializeCurrentSelectionForRollback).toHaveBeenCalled()
  })
})
