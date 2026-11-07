import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'

// One sentinel per run: every path below must keep it inside account A's vault settings.json.
const SENTINEL = 'sk-ant-oat01-ORCA1039-containment-sentinel'
const TEST_ROOT = join(tmpdir(), 'orca-claude-long-lived-token-containment')
const HOME = join(TEST_ROOT, 'home')
const USER_DATA = join(TEST_ROOT, 'user-data')

vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>()
  const homedir = (): string => HOME
  return { ...actual, homedir, default: { ...actual, homedir } }
})
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

function filesUnder(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** Every file under `root` whose bytes contain the sentinel. */
function filesHoldingSentinel(root: string): string[] {
  return filesUnder(root).filter((path) => readFileSync(path).includes(SENTINEL))
}

function createVault(accountId: string, settings: Record<string, unknown>): string {
  const vault = join(USER_DATA, 'claude-accounts', accountId, 'auth')
  mkdirSync(vault, { recursive: true })
  writeFileSync(join(vault, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  writeFileSync(join(vault, 'settings.json'), JSON.stringify(settings), 'utf-8')
  return vault
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

async function createService(accounts: Record<string, unknown>[]) {
  let settings = { claudeManagedAccounts: accounts, activeClaudeManagedAccountId: null }
  const store = {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn((updates: Partial<typeof settings>) => {
      settings = { ...settings, ...updates }
      return settings
    })
  }
  const rateLimits = {
    evictInactiveClaudeCache: vi.fn(),
    clearClaudeAccountAuthVerdict: vi.fn(),
    getActiveClaudeSessionModel: vi.fn(() => null),
    getState: vi.fn(() => ({})),
    refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
  }
  const { ClaudeAccountService } = await import('./service')
  return {
    service: new ClaudeAccountService(store as never, rateLimits as never, {} as never),
    getSettings: () => settings
  }
}

// A user plugin with a hook and a global MCP server, so the sync has something to copy.
function seedHome(): void {
  const pluginRoot = join(HOME, '.claude', 'plugins', 'cache', 'mkt', 'memo', '1.0.0')
  mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
  writeFileSync(
    join(pluginRoot, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/stop.sh' }] }] }
    })
  )
  writeFileSync(join(pluginRoot, 'stop.sh'), '#!/bin/sh\n')
  writeFileSync(
    join(HOME, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'memo@mkt': [{ scope: 'user', installPath: pluginRoot }] } })
  )
  writeFileSync(
    join(HOME, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'memo@mkt': true }, permissions: { allow: ['Read'] } })
  )
  writeFileSync(
    join(HOME, '.claude.json'),
    JSON.stringify({ mcpServers: { docs: { command: 'docs-mcp' } } })
  )
}

const vaultEnv = { env: { CLAUDE_CODE_OAUTH_TOKEN: SENTINEL } }

describe('long-lived token containment (ORCA-1039)', () => {
  beforeEach(() => {
    setPlatform('linux')
    resetClaudeKeychainMocks()
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(join(HOME, '.claude'), { recursive: true })
    seedHome()
  })

  afterEach(() => {
    restorePlatform()
    vi.restoreAllMocks()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('global config sync keeps the token in its own vault and copies it nowhere', async () => {
    const vaultA = createVault('account-a', vaultEnv)
    const vaultB = createVault('account-b', {})
    const { service } = await createService([
      account('account-a', 'a@example.com', vaultA),
      account('account-b', 'b@example.com', vaultB)
    ])
    const { collectGlobalHooks } = await import('./plugin-hooks-inheritance')
    const hookIds = collectGlobalHooks(HOME).map((hook) => hook.id)
    expect(hookIds).not.toHaveLength(0)

    service.resyncGlobalConfigIntoManagedVaults({
      mcpServerNames: ['docs'],
      skillNames: [],
      hookIds,
      writeGlobalHooks: true
    })

    const synced = JSON.parse(readFileSync(join(vaultA, 'settings.json'), 'utf-8'))
    expect(synced.hooks.Stop).toBeDefined()
    expect(synced.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SENTINEL)
    expect(filesHoldingSentinel(TEST_ROOT)).toEqual([join(vaultA, 'settings.json')])
  })

  it('home settings mirroring never carries the vault env out, and its report omits it', async () => {
    const vaultA = createVault('account-a', vaultEnv)
    const { buildInheritedVaultSettings, describeVaultSettingsInheritance } =
      await import('./vault-settings-inheritance')

    const merged = buildInheritedVaultSettings(
      vaultA,
      HOME,
      readFileSync(join(vaultA, 'settings.json'), 'utf-8')
    )
    const report = describeVaultSettingsInheritance({
      accountId: 'account-a',
      vaultAuthPath: vaultA,
      homeDir: HOME,
      readVaultSettings: () => readFileSync(join(vaultA, 'settings.json'), 'utf-8')
    })

    expect(JSON.parse(merged ?? '{}').env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SENTINEL)
    expect(JSON.stringify(report)).not.toContain(SENTINEL)
    expect(filesHoldingSentinel(HOME)).toEqual([])
  })

  it('the hook and statusline rewrite keeps the token in the vault, not in the shared scripts', async () => {
    const vaultA = createVault('account-a', {
      ...vaultEnv,
      statusLine: { type: 'command', command: 'my-line' }
    })
    const { claudeHookService } = await import('../claude/hook-service')
    const { configureClaudeStatusLineOwnershipAccounts, replaceUserOwnedClaudeStatusLines } =
      await import('../claude/statusline-ownership')
    configureClaudeStatusLineOwnershipAccounts(
      () => [account('account-a', 'a@example.com', vaultA)] as never
    )

    const instrumented = claudeHookService.ensureInjectedVaultInstrumentation(
      readFileSync(join(vaultA, 'settings.json'), 'utf-8')
    )
    const result = replaceUserOwnedClaudeStatusLines()

    expect(JSON.parse(instrumented ?? '{}').env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SENTINEL)
    expect(result.failedCount).toBe(0)
    expect(JSON.stringify(result)).not.toContain(SENTINEL)
    const rewritten = JSON.parse(readFileSync(join(vaultA, 'settings.json'), 'utf-8'))
    expect(rewritten.statusLine.command).not.toBe('my-line')
    expect(rewritten.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SENTINEL)
    expect(filesUnder(join(HOME, '.orca', 'agent-hooks'))).not.toHaveLength(0)
    expect(filesHoldingSentinel(HOME)).toEqual([])
  })

  it('what reaches paired clients and remote hosts omits the token', async () => {
    const vaultA = createVault('account-a', { ...vaultEnv, enabledPlugins: { 'memo@mkt': true } })
    const { service } = await createService([account('account-a', 'a@example.com', vaultA)])
    await service.setLongLivedToken('account-a', SENTINEL)
    const { readClaudeMemberMcpInventory } = await import('./member-mcp-inventory')

    const inventory = await readClaudeMemberMcpInventory({
      configFile: join(HOME, '.claude.json'),
      configDir: vaultA,
      repoPath: null
    })

    expect(JSON.stringify(service.listAccounts())).not.toContain(SENTINEL)
    expect(JSON.stringify(inventory)).not.toContain(SENTINEL)
  })

  it('status and dead-hook reports read the vault without echoing its env', async () => {
    const vaultA = createVault('account-a', {
      ...vaultEnv,
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/gone/plugin/stop.sh' }] }] }
    })
    const { collectNewDeadHookScripts, formatDeadHookNotice } =
      await import('../claude/dead-hook-report')
    const { configureClaudeStatusLineOwnershipAccounts, getClaudeStatusLineOwnership } =
      await import('../claude/statusline-ownership')
    configureClaudeStatusLineOwnershipAccounts(
      () => [account('account-a', 'a@example.com', vaultA)] as never
    )

    const dead = collectNewDeadHookScripts(
      [join(vaultA, 'settings.json')],
      { readFile: (path) => readFileSync(path, 'utf-8'), exists: () => false },
      new Set()
    )

    expect(dead).not.toHaveLength(0)
    expect(JSON.stringify([dead, formatDeadHookNotice(dead)])).not.toContain(SENTINEL)
    expect(JSON.stringify(getClaudeStatusLineOwnership())).not.toContain(SENTINEL)
  })

  it('a corrupt vault file is never logged, so its bytes cannot reach a crash or diagnostic log', async () => {
    // Why unquoted and prefix-free: V8's JSON.parse error quotes ~10 chars after the bad
    // token, so the secret part itself must sit there for a leak to be visible.
    const secret = 'ZQ1039secret-corrupt-vault'
    const corrupt = `{"env":{"CLAUDE_CODE_OAUTH_TOKEN":${secret}}}`
    const vaultA = createVault('account-a', {})
    writeFileSync(join(vaultA, 'settings.json'), corrupt)
    const logged: unknown[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => logged.push(args))
    }
    const { claudeHookService } = await import('../claude/hook-service')
    const { mergeHooksIntoVaultSettings, collectGlobalHooks } =
      await import('./plugin-hooks-inheritance')
    const { buildInheritedVaultSettings } = await import('./vault-settings-inheritance')
    const { configureClaudeStatusLineOwnershipAccounts, replaceUserOwnedClaudeStatusLines } =
      await import('../claude/statusline-ownership')
    configureClaudeStatusLineOwnershipAccounts(
      () => [account('account-a', 'a@example.com', vaultA)] as never
    )
    const { service } = await createService([account('account-a', 'a@example.com', vaultA)])

    expect(claudeHookService.ensureInjectedVaultInstrumentation(corrupt)).toBeNull()
    expect(mergeHooksIntoVaultSettings(corrupt, collectGlobalHooks(HOME))).toBeNull()
    buildInheritedVaultSettings(vaultA, HOME, corrupt)
    replaceUserOwnedClaudeStatusLines()
    service.syncGlobalConfigForAccount('account-a')
    await expect(service.setLongLivedToken('account-a', null)).rejects.not.toThrow(
      secret.slice(0, 6)
    )

    expect(readFileSync(join(vaultA, 'settings.json'), 'utf-8')).toBe(corrupt)
    expect(JSON.stringify(logged.map((args) => String(args)))).not.toContain(secret.slice(0, 6))
  })

  it('clearing the token leaves no copy of it anywhere, temp files included', async () => {
    const vaultA = createVault('account-a', { hooks: { Stop: [] } })
    const { service } = await createService([account('account-a', 'a@example.com', vaultA)])
    await service.setLongLivedToken('account-a', SENTINEL)
    expect(filesHoldingSentinel(TEST_ROOT)).toEqual([join(vaultA, 'settings.json')])

    await service.setLongLivedToken('account-a', null)

    expect(filesHoldingSentinel(TEST_ROOT)).toEqual([])
  })
})
