/* eslint-disable max-lines -- test suite covers Claude runtime auth refresh, identity guards, and snapshot restore cases */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultSettings } from '../../shared/constants'
import type { ClaudeManagedAccount, GlobalSettings } from '../../shared/types'
import { isOauthTokenExpiring, refreshClaudeOauthCredentials } from './oauth-refresh'
import type { ClaudeAccountSelectionTarget } from './runtime-selection'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const hostPlatform = process.platform
const testState = {
  userDataDir: '',
  fakeHomeDir: '',
  activeKeychainCredentials: null as string | null,
  scopedKeychainCredentials: null as string | null,
  legacyKeychainCredentials: null as string | null,
  throwScopedKeychainRead: false,
  throwLegacyKeychainRead: false,
  throwRuntimeKeychainWrite: false,
  throwLegacyRuntimeKeychainWrite: false,
  throwScopedKeychainWrite: false,
  runtimeWriteConfigDir: null as string | null,
  managedKeychainCredentials: new Map<string, string>()
}

function expectedRuntimeConfigDir(): string {
  return join(testState.fakeHomeDir, '.claude')
}

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))

// Why: these tests exercise materialize/read-back/snapshot logic, not the
// network OAuth refresh (covered by oauth-refresh.test.ts). Default the token
// to "not expiring" so the proactive switch-in refresh never fires here and
// existing expectations hold; individual tests can override these mocks.
vi.mock('./oauth-refresh', () => ({
  isOauthTokenExpiring: vi.fn(() => false),
  refreshClaudeOauthCredentials: vi.fn(async () => null)
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

vi.mock('./keychain', () => ({
  readActiveClaudeKeychainCredentials: vi.fn(async (configDir?: string) => {
    if (configDir) {
      if (configDir !== expectedRuntimeConfigDir()) {
        return testState.legacyKeychainCredentials
      }
      return testState.scopedKeychainCredentials ?? testState.legacyKeychainCredentials
    }
    return testState.legacyKeychainCredentials
  }),
  writeActiveClaudeKeychainCredentials: vi.fn(async (contents: string, configDir?: string) => {
    if (configDir) {
      if (configDir !== expectedRuntimeConfigDir()) {
        throw new Error(`Unexpected Claude config dir: ${configDir}`)
      }
      if (testState.throwScopedKeychainWrite) {
        throw new Error('scoped keychain write failed')
      }
      testState.scopedKeychainCredentials = contents
    } else {
      testState.legacyKeychainCredentials = contents
    }
    testState.activeKeychainCredentials = contents
  }),
  deleteActiveClaudeKeychainCredentials: vi.fn(async () => {
    testState.scopedKeychainCredentials = null
    testState.legacyKeychainCredentials = null
    testState.activeKeychainCredentials = null
  }),
  deleteActiveClaudeKeychainCredentialsStrict: vi.fn(async (configDir?: string) => {
    if (configDir) {
      if (configDir !== expectedRuntimeConfigDir()) {
        throw new Error(`Unexpected Claude config dir: ${configDir}`)
      }
      testState.scopedKeychainCredentials = null
    } else {
      testState.legacyKeychainCredentials = null
    }
    testState.activeKeychainCredentials = null
  }),
  readActiveClaudeKeychainCredentialsStrict: vi.fn(async (configDir?: string) =>
    configDir
      ? (() => {
          if (testState.throwScopedKeychainRead) {
            throw new Error('scoped keychain read failed')
          }
          return configDir === expectedRuntimeConfigDir()
            ? testState.scopedKeychainCredentials
            : null
        })()
      : (() => {
          if (testState.throwLegacyKeychainRead) {
            throw new Error('legacy keychain read failed')
          }
          return testState.legacyKeychainCredentials
        })()
  ),
  writeActiveClaudeKeychainCredentialsForRuntime: vi.fn(
    async (contents: string, configDir: string) => {
      if (configDir !== expectedRuntimeConfigDir()) {
        throw new Error(`Unexpected Claude config dir: ${configDir}`)
      }
      if (testState.throwRuntimeKeychainWrite) {
        throw new Error('runtime keychain write failed')
      }
      testState.runtimeWriteConfigDir = configDir
      testState.scopedKeychainCredentials = contents
      if (testState.throwLegacyRuntimeKeychainWrite) {
        throw new Error('legacy runtime keychain write failed')
      }
      testState.legacyKeychainCredentials = contents
      testState.activeKeychainCredentials = contents
    }
  ),
  readManagedClaudeKeychainCredentials: vi.fn(
    async (accountId: string) => testState.managedKeychainCredentials.get(accountId) ?? null
  ),
  writeManagedClaudeKeychainCredentials: vi.fn(async (accountId: string, contents: string) => {
    testState.managedKeychainCredentials.set(accountId, contents)
  })
}))

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

function createSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    ...getDefaultSettings(testState.fakeHomeDir),
    ...overrides
  }
}

function createStore(settings: GlobalSettings) {
  return {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
      settings = {
        ...settings,
        ...updates,
        notifications: {
          ...settings.notifications,
          ...updates.notifications
        }
      }
      return settings
    })
  }
}

function createManagedClaudeAuth(
  rootDir: string,
  accountId: string,
  credentialsJson: string,
  oauthAccountJson = `{"accountUuid":"${accountId}"}\n`
): string {
  const managedAuthPath = join(rootDir, 'claude-accounts', accountId, 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  writeFileSync(join(managedAuthPath, '.credentials.json'), credentialsJson, 'utf-8')
  writeFileSync(join(managedAuthPath, 'oauth-account.json'), oauthAccountJson, 'utf-8')
  testState.managedKeychainCredentials.set(accountId, credentialsJson)
  return managedAuthPath
}

function createClaudeAccount(
  id: string,
  managedAuthPath: string,
  overrides: Partial<ClaudeManagedAccount> = {}
): ClaudeManagedAccount {
  return {
    id,
    email: 'user@example.com',
    managedAuthPath,
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function createClaudeCredentialsJson(
  email: string,
  accessToken: string,
  organizationUuid: string | null = null,
  expiresAt = Date.now() + 60_000
): string {
  return `${JSON.stringify({
    claudeAiOauth: {
      email,
      ...(organizationUuid ? { organizationUuid } : {}),
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      expiresAt
    }
  })}\n`
}

function createClaudeCredentialsWithoutEmail(
  accessToken: string,
  organizationUuid: string | null = null,
  options: { expiresAt?: number; refreshToken?: string } = {}
): string {
  return `${JSON.stringify({
    claudeAiOauth: {
      ...(organizationUuid ? { organizationUuid } : {}),
      accessToken,
      refreshToken: options.refreshToken ?? `${accessToken}-refresh`,
      expiresAt: options.expiresAt ?? Date.now() + 60_000
    }
  })}\n`
}

function readManagedCredentialsForTest(accountId: string, managedAuthPath: string): string | null {
  if (process.platform === 'darwin') {
    return testState.managedKeychainCredentials.get(accountId) ?? null
  }
  return readFileSync(join(managedAuthPath, '.credentials.json'), 'utf-8')
}

function readRuntimeOauthAccountForTest(): unknown {
  const configPath = join(testState.fakeHomeDir, '.claude.json')
  if (!existsSync(configPath)) {
    return null
  }
  return (
    (JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>).oauthAccount ?? null
  )
}

describe('ClaudeRuntimeAuthService', () => {
  beforeEach(() => {
    setPlatform('darwin')
    vi.resetModules()
    vi.clearAllMocks()
    testState.activeKeychainCredentials = null
    testState.scopedKeychainCredentials = null
    testState.legacyKeychainCredentials = null
    testState.throwScopedKeychainRead = false
    testState.throwLegacyKeychainRead = false
    testState.throwRuntimeKeychainWrite = false
    testState.throwLegacyRuntimeKeychainWrite = false
    testState.throwScopedKeychainWrite = false
    testState.runtimeWriteConfigDir = null
    testState.managedKeychainCredentials.clear()
    testState.userDataDir = mkdtempSync(join(tmpdir(), 'orca-claude-runtime-'))
    testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-claude-home-'))
    mkdirSync(join(testState.fakeHomeDir, '.claude'), { recursive: true })
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    rmSync(testState.userDataDir, { recursive: true, force: true })
    rmSync(testState.fakeHomeDir, { recursive: true, force: true })
  })

  it('rematerializes unchanged managed credentials when the runtime file is missing', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)

    rmSync(runtimeCredentialsPath, { force: true })
    await service.prepareForClaudeLaunch()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)
    expect(testState.runtimeWriteConfigDir).toBe(expectedRuntimeConfigDir())
  })

  it('restores system default instead of materializing corrupt managed credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(testState.userDataDir, 'account-1', '{not-json')
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('restores system default instead of materializing wrong-shaped managed credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(testState.userDataDir, 'account-1', '{}\n')
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('does not materialize managed credentials from unowned auth paths', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    const unownedAuthPath = join(testState.fakeHomeDir, 'unowned-claude-auth')
    mkdirSync(unownedAuthPath, { recursive: true })
    writeFileSync(join(unownedAuthPath, '.credentials.json'), managedCredentials, 'utf-8')
    writeFileSync(
      join(unownedAuthPath, 'oauth-account.json'),
      `${JSON.stringify({ accountUuid: 'account-1' })}\n`,
      'utf-8'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', unownedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
  })

  it('adopts canonical legacy managed auth paths without existing markers', async () => {
    setPlatform('linux')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.credentials.json'), managedCredentials, 'utf-8')
    writeFileSync(
      join(managedAuthPath, 'oauth-account.json'),
      '{"accountUuid":"account-1"}\n',
      'utf-8'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    const markerPath = join(managedAuthPath, '.orca-managed-claude-auth')
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)
    expect(lstatSync(markerPath).isFile()).toBe(true)
    expect(readFileSync(markerPath, 'utf-8')).toBe('account-1\n')
  })

  it('rejects symlinked managed credential children', async () => {
    setPlatform('linux')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const escapedCredentials = createClaudeCredentialsJson('user@example.com', 'escaped')
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    const escapedCredentialsPath = join(testState.fakeHomeDir, 'escaped-credentials.json')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      join(managedAuthPath, 'oauth-account.json'),
      '{"accountUuid":"account-1"}\n',
      'utf-8'
    )
    writeFileSync(escapedCredentialsPath, escapedCredentials, 'utf-8')
    symlinkSync(escapedCredentialsPath, join(managedAuthPath, '.credentials.json'))
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
  })

  it('restores system auth when switching from an owned account to an unowned account', async () => {
    setPlatform('linux')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const ownedCredentials = createClaudeCredentialsJson('owned@example.com', 'owned')
    const unownedCredentials = createClaudeCredentialsJson('unowned@example.com', 'unowned')
    const systemOauthAccount = { accountUuid: 'system-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    const ownedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      ownedCredentials
    )
    const unownedAuthPath = join(testState.fakeHomeDir, 'unowned-claude-auth')
    mkdirSync(unownedAuthPath, { recursive: true })
    writeFileSync(join(unownedAuthPath, '.credentials.json'), unownedCredentials, 'utf-8')
    let settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', ownedAuthPath, { email: 'owned@example.com' }),
        createClaudeAccount('account-2', unownedAuthPath, { email: 'unowned@example.com' })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
        settings = {
          ...settings,
          ...updates,
          notifications: {
            ...settings.notifications,
            ...updates.notifications
          }
        }
        return settings
      })
    }

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    store.updateSettings({ activeClaudeManagedAccountId: 'account-1' })
    await service.syncForCurrentSelection()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(ownedCredentials)

    store.updateSettings({ activeClaudeManagedAccountId: 'account-2' })
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('restores system auth when the previously synced account is no longer in settings', async () => {
    setPlatform('linux')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const ownedCredentials = createClaudeCredentialsJson('owned@example.com', 'owned')
    const systemOauthAccount = { accountUuid: 'system-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    const ownedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      ownedCredentials
    )
    const unownedAuthPath = join(testState.fakeHomeDir, 'unowned-claude-auth')
    mkdirSync(unownedAuthPath, { recursive: true })
    let settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', ownedAuthPath, { email: 'owned@example.com' })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
        settings = {
          ...settings,
          ...updates,
          notifications: {
            ...settings.notifications,
            ...updates.notifications
          }
        }
        return settings
      })
    }

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    store.updateSettings({ activeClaudeManagedAccountId: 'account-1' })
    await service.syncForCurrentSelection()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(ownedCredentials)

    store.updateSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-2', unownedAuthPath, { email: 'unowned@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-2'
    })
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('restores system auth when switching from an owned account to missing credentials', async () => {
    setPlatform('linux')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const account1Credentials = createClaudeCredentialsJson('one@example.com', 'one')
    const systemOauthAccount = { accountUuid: 'system-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Credentials
    )
    const managedAuthPath2 = join(testState.userDataDir, 'claude-accounts', 'account-2', 'auth')
    mkdirSync(managedAuthPath2, { recursive: true })
    writeFileSync(join(managedAuthPath2, '.orca-managed-claude-auth'), 'account-2\n', 'utf-8')
    writeFileSync(
      join(managedAuthPath2, 'oauth-account.json'),
      '{"accountUuid":"account-2"}\n',
      'utf-8'
    )
    let settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
        settings = {
          ...settings,
          ...updates,
          notifications: {
            ...settings.notifications,
            ...updates.notifications
          }
        }
        return settings
      })
    }

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    store.updateSettings({ activeClaudeManagedAccountId: 'account-1' })
    await service.syncForCurrentSelection()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1Credentials)

    store.updateSettings({ activeClaudeManagedAccountId: 'account-2' })
    await service.syncForCurrentSelection()

    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('removes runtime credentials when deselecting with a missing system-default snapshot', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(existsSync(runtimeCredentialsPath)).toBe(false)
    if (process.platform === 'darwin') {
      expect(testState.scopedKeychainCredentials).toBeNull()
      expect(testState.legacyKeychainCredentials).toBeNull()
    }
  })

  it('falls back to atomic write when the unchanged check cannot read the target', async () => {
    if (hostPlatform === 'win32') {
      return
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const rotatedCredentials = createClaudeCredentialsJson('user@example.com', 'rotated')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    testState.managedKeychainCredentials.set('account-1', rotatedCredentials)
    writeFileSync(join(managedAuthPath, '.credentials.json'), rotatedCredentials, 'utf-8')
    chmodSync(runtimeCredentialsPath, 0o000)
    try {
      await service.syncForCurrentSelection()
    } finally {
      if (existsSync(runtimeCredentialsPath)) {
        chmodSync(runtimeCredentialsPath, 0o600)
      }
      warn.mockRestore()
    }

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(rotatedCredentials)
  })

  it('tightens credential file permissions when unchanged content is already present', async () => {
    if (hostPlatform === 'win32') {
      return
    }

    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    chmodSync(runtimeCredentialsPath, 0o644)
    await service.syncForCurrentSelection()

    expect(statSync(runtimeCredentialsPath).mode & 0o777).toBe(0o600)
  })

  it('reads back refreshed credentials when the Claude identity still matches', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const refreshedCredentials = createClaudeCredentialsJson('user@example.com', 'refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('rejects wrong-shaped refreshed credentials during read-back', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const wrongShapedRefresh = `${JSON.stringify({
      claudeAiOauth: {
        email: 'user@example.com',
        expiresAt: Date.now() + 120_000
      }
    })}\n`
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, wrongShapedRefresh, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(originalCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(originalCredentials)
  })

  it('reads back verified same-account credentials on first sync after restart', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'original',
      null,
      1_000
    )
    const refreshedCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'refreshed',
      null,
      2_000
    )
    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('rejects older same-account Claude credentials on first sync after restart', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const staleRuntimeCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'stale',
      null,
      1_000
    )
    const managedCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'managed-newer',
      null,
      2_000
    )
    writeFileSync(runtimeCredentialsPath, staleRuntimeCredentials, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(managedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)
  })

  it('rejects runtime read-back from a different Claude identity', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const selectedCredentials = createClaudeCredentialsJson('user@example.com', 'selected')
    const staleCredentials = createClaudeCredentialsJson('other@example.com', 'stale')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(selectedCredentials)
  })

  it('rejects runtime read-back from the same Claude email in a different organization', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const selectedCredentials = createClaudeCredentialsJson('user@example.com', 'selected', 'org-b')
    const staleCredentials = createClaudeCredentialsJson('user@example.com', 'stale', 'org-a')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-b' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(selectedCredentials)
  })

  it('rejects same-email Claude read-back using stored managed organization identity', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const selectedCredentials = createClaudeCredentialsJson('user@example.com', 'selected', 'org-b')
    const staleCredentials = createClaudeCredentialsJson('user@example.com', 'stale', 'org-a')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(selectedCredentials)
  })

  it('rejects same-email Claude read-back using stored oauth-account organization identity', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const selectedCredentials = createClaudeCredentialsJson('user@example.com', 'selected')
    const staleCredentials = createClaudeCredentialsJson('user@example.com', 'stale', 'org-a')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials,
      '{"organizationUuid":"org-b"}\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(selectedCredentials)
  })

  it('rejects no-email Claude read-back when organization identity conflicts', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const selectedCredentials = createClaudeCredentialsJson('user@example.com', 'selected', 'org-b')
    const staleCredentials = createClaudeCredentialsWithoutEmail('stale', 'org-a')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-b' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(selectedCredentials)
  })

  it('rejects no-email refreshed credentials even when organization identity matches', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original', 'org-a')
    const refreshedCredentials = createClaudeCredentialsWithoutEmail('refreshed', 'org-a')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-a' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(originalCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(originalCredentials)
  })

  it('preserves rejected runtime refreshes while a Claude terminal is live on Windows', async () => {
    setPlatform('win32')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original', 'org-a')
    const refreshedCredentials = createClaudeCredentialsWithoutEmail('refreshed', 'org-a')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-a' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    markClaudePtySpawned('live-claude-pty')
    try {
      writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
      await service.syncForCurrentSelection()

      expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
      expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
    } finally {
      markClaudePtyExited('live-claude-pty')
    }

    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('does not persist live runtime refreshes with conflicting organization identity', async () => {
    setPlatform('win32')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original', 'org-a')
    const conflictingCredentials = createClaudeCredentialsWithoutEmail('refreshed', 'org-b')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-a' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    markClaudePtySpawned('live-claude-pty')
    try {
      writeFileSync(runtimeCredentialsPath, conflictingCredentials, 'utf-8')
      await service.syncForCurrentSelection()

      expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(originalCredentials)
      expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(conflictingCredentials)
    } finally {
      markClaudePtyExited('live-claude-pty')
    }
  })

  it('rematerializes managed credentials over a wiped runtime blob while a Claude terminal is live', async () => {
    setPlatform('win32')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original', 'org-a')
    // Why: Claude CLI wipes tokens in place (keeps identity fields) after an
    // invalid_grant refresh — the exact blob shape this regression guards.
    const parsedOriginal = JSON.parse(originalCredentials) as {
      claudeAiOauth: Record<string, unknown>
    }
    const wipedCredentials = `${JSON.stringify({
      claudeAiOauth: {
        ...parsedOriginal.claudeAiOauth,
        accessToken: '',
        refreshToken: '',
        expiresAt: 0
      }
    })}\n`
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-a' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    markClaudePtySpawned('live-claude-pty')
    try {
      writeFileSync(runtimeCredentialsPath, wipedCredentials, 'utf-8')
      await service.syncForCurrentSelection()

      expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(originalCredentials)
      expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(originalCredentials)
    } finally {
      markClaudePtyExited('live-claude-pty')
    }
  })

  it('rejects unverifiable refreshed runtime credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsWithoutEmail('original')
    const refreshedCredentials = createClaudeCredentialsWithoutEmail('refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(originalCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(originalCredentials)
  })

  it('reads back identity-less refreshed credentials when the refresh token matches', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const refreshToken = 'same-managed-refresh-token'
    const originalCredentials = createClaudeCredentialsWithoutEmail('original', null, {
      expiresAt: 1_000,
      refreshToken
    })
    const refreshedCredentials = createClaudeCredentialsWithoutEmail('refreshed', null, {
      expiresAt: 2_000,
      refreshToken
    })
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { organizationUuid: 'org-from-account' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('reads back identity-less refreshed credentials when runtime oauth metadata matches', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const originalCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'original',
      'org-a',
      1_000
    )
    const refreshedCredentials = createClaudeCredentialsWithoutEmail('refreshed', null, {
      expiresAt: 2_000,
      refreshToken: 'rotated-refresh-token'
    })
    writeFileSync(runtimeConfigPath, '{}\n', 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials,
      '{"accountUuid":"account-uuid-1","emailAddress":"user@example.com","organizationUuid":"org-a"}\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, {
          email: 'user@example.com',
          organizationUuid: 'org-a'
        })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('rules out other identity-less accounts with different refresh tokens', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1RefreshToken = 'account-1-refresh-token'
    const account1OriginalCredentials = createClaudeCredentialsWithoutEmail('account-1', null, {
      expiresAt: 1_000,
      refreshToken: account1RefreshToken
    })
    const account1RefreshedCredentials = createClaudeCredentialsWithoutEmail(
      'account-1-refreshed',
      null,
      {
        expiresAt: 2_000,
        refreshToken: account1RefreshToken
      }
    )
    const account2Credentials = createClaudeCredentialsWithoutEmail('account-2', null, {
      refreshToken: 'account-2-refresh-token'
    })
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1OriginalCredentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'other@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, account1RefreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(
      account1RefreshedCredentials
    )
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(account2Credentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1RefreshedCredentials)
  })

  it('restores the system default after rejecting unverifiable managed credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    const originalCredentials = createClaudeCredentialsWithoutEmail('original')
    const refreshedCredentials = createClaudeCredentialsWithoutEmail('refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
  })

  it('restores system default after same-identity managed Claude refresh on deselect', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed', 'org-1')
    const externalCredentials = createClaudeCredentialsJson('user@example.com', 'external', 'org-1')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, {
          organizationUuid: 'org-1'
        })
      ]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, externalCredentials, 'utf-8')
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(externalCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
  })

  it('preserves external stale Claude credentials without writing them to managed storage', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const selectedCredentials = createClaudeCredentialsJson('selected@example.com', 'selected')
    const staleCredentials = createClaudeCredentialsJson('stale@example.com', 'stale')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      selectedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'selected@example.com' })
      ]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, staleCredentials, 'utf-8')
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(selectedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(staleCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('does not persist unverifiable stale Claude credentials into another active account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Credentials = createClaudeCredentialsJson('one@example.com', 'one')
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two')
    const staleUnverifiableCredentials = createClaudeCredentialsWithoutEmail('stale')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Credentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    settings.activeClaudeManagedAccountId = 'account-2'
    await service.syncForCurrentSelection()
    writeFileSync(runtimeCredentialsPath, staleUnverifiableCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(account2Credentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2Credentials)
  })

  it('materializes only the selected managed account into shared Claude runtime files', async () => {
    setPlatform('linux')
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Credentials = createClaudeCredentialsJson('one@example.com', 'one-token')
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two-token')
    const account1Oauth = '{"accountUuid":"account-1","emailAddress":"one@example.com"}\n'
    const account2Oauth = '{"accountUuid":"account-2","emailAddress":"two@example.com"}\n'
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Credentials,
      account1Oauth
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials,
      account2Oauth
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    await service.syncForCurrentSelection()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1Credentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({
      accountUuid: 'account-1',
      emailAddress: 'one@example.com'
    })

    settings.activeClaudeManagedAccountId = 'account-2'
    await service.syncForCurrentSelection()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2Credentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({
      accountUuid: 'account-2',
      emailAddress: 'two@example.com'
    })

    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1Credentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({
      accountUuid: 'account-1',
      emailAddress: 'one@example.com'
    })

    // Why: switching rewrites only the shared Claude runtime surface; the
    // managed account files remain per-account sources of truth.
    expect(readFileSync(join(managedAuthPath1, '.credentials.json'), 'utf-8')).toBe(
      account1Credentials
    )
    expect(readFileSync(join(managedAuthPath2, '.credentials.json'), 'utf-8')).toBe(
      account2Credentials
    )
    expect(readFileSync(join(managedAuthPath1, 'oauth-account.json'), 'utf-8')).toBe(account1Oauth)
    expect(readFileSync(join(managedAuthPath2, 'oauth-account.json'), 'utf-8')).toBe(account2Oauth)
  })

  it('does not carry the reauth read-back skip across Claude account switches', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Credentials = createClaudeCredentialsJson('one@example.com', 'one')
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two')
    const account2RefreshedCredentials = createClaudeCredentialsJson(
      'two@example.com',
      'two-refreshed'
    )
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Credentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    service.clearLastWrittenCredentialsJson()
    settings.activeClaudeManagedAccountId = 'account-2'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, account2RefreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(
      account2RefreshedCredentials
    )
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2RefreshedCredentials)
  })

  it('does not apply inactive-account Claude reauth skip to the active account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Credentials = createClaudeCredentialsJson('one@example.com', 'one')
    const account1RefreshedCredentials = createClaudeCredentialsJson(
      'one@example.com',
      'one-refreshed'
    )
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Credentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, account1RefreshedCredentials, 'utf-8')
    service.clearLastWrittenCredentialsJson('account-2')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(
      account1RefreshedCredentials
    )
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1RefreshedCredentials)
  })

  it('keeps external Claude logout when deselecting managed account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    rmSync(runtimeCredentialsPath, { force: true })
    testState.activeKeychainCredentials = null
    testState.scopedKeychainCredentials = null
    testState.legacyKeychainCredentials = null
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(existsSync(runtimeCredentialsPath)).toBe(false)
    expect(testState.scopedKeychainCredentials).toBeNull()
    expect(testState.legacyKeychainCredentials).toBeNull()
  })

  it('reads back refreshed active keychain credentials on macOS', async () => {
    if (process.platform !== 'darwin') {
      return
    }

    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const refreshedCredentials = createClaudeCredentialsJson('user@example.com', 'refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    testState.scopedKeychainCredentials = refreshedCredentials
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
  })

  it('reads back refreshed legacy keychain credentials on old Claude Code builds', async () => {
    if (process.platform !== 'darwin') {
      return
    }

    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const refreshedCredentials = createClaudeCredentialsJson('user@example.com', 'refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    testState.scopedKeychainCredentials = originalCredentials
    testState.legacyKeychainCredentials = refreshedCredentials
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
    expect(testState.scopedKeychainCredentials).toBe(refreshedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(refreshedCredentials)
  })

  it('rejects stale legacy keychain credentials after a fresher managed write', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const staleCredentials = createClaudeCredentialsJson('user@example.com', 'stale', null, 1_000)
    const managedCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'managed-newer',
      null,
      2_000
    )
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    testState.scopedKeychainCredentials = managedCredentials
    testState.legacyKeychainCredentials = staleCredentials
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(managedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)
    expect(testState.scopedKeychainCredentials).toBe(managedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(managedCredentials)
  })

  it('uses fresher file credentials when scoped keychain is stale', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const staleCredentials = createClaudeCredentialsJson('user@example.com', 'stale', null, 1_000)
    const managedCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'managed',
      null,
      2_000
    )
    const refreshedCredentials = createClaudeCredentialsJson(
      'user@example.com',
      'refreshed',
      null,
      3_000
    )
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    testState.scopedKeychainCredentials = staleCredentials
    testState.legacyKeychainCredentials = managedCredentials
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
    expect(testState.scopedKeychainCredentials).toBe(refreshedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(refreshedCredentials)
  })

  it('restores system default when mismatched Claude keychain auth appears before deselect', async () => {
    if (process.platform !== 'darwin') {
      return
    }

    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalKeychainCredentials = createClaudeCredentialsJson(
      'external@example.com',
      'external'
    )
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    testState.scopedKeychainCredentials = externalKeychainCredentials
    testState.legacyKeychainCredentials = externalKeychainCredentials
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(externalKeychainCredentials)
    expect(testState.legacyKeychainCredentials).toBe(externalKeychainCredentials)
  })

  it('restores unchanged scoped keychain while preserving external legacy keychain logout', async () => {
    if (process.platform !== 'darwin') {
      return
    }

    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    testState.legacyKeychainCredentials = null
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBeNull()
  })

  it('preserves external scoped keychain login while restoring unchanged legacy keychain', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalScopedCredentials = createClaudeCredentialsJson(
      'external@example.com',
      'external'
    )
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { readActiveClaudeKeychainCredentials } = await import('./keychain')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    expect(readActiveClaudeKeychainCredentials).toHaveBeenCalledWith(expectedRuntimeConfigDir())

    testState.scopedKeychainCredentials = externalScopedCredentials
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(externalScopedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('restores oauth metadata when credentials prove managed ownership', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account' }
    const externalOauthAccount = { accountUuid: 'external-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: externalOauthAccount })}\n`,
      'utf-8'
    )
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('restores owned oauth metadata when external credentials change but metadata does not', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalCredentials = createClaudeCredentialsJson('external@example.com', 'external')
    const systemOauthAccount = { accountUuid: 'system-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, externalCredentials, 'utf-8')
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(externalCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('restores owned oauth metadata when only keychain proves managed ownership', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalCredentials = createClaudeCredentialsJson('external@example.com', 'external')
    const systemOauthAccount = { accountUuid: 'system-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials,
      'null\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, externalCredentials, 'utf-8')
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(externalCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('uses managed credentials as ownership baseline after restart with partial external changes', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalScopedCredentials = createClaudeCredentialsJson(
      'external@example.com',
      'external'
    )
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: systemCredentials,
        configOauthAccount: null,
        keychainCredentialsJson: systemCredentials,
        scopedKeychainCredentialsJson: systemCredentials,
        legacyKeychainCredentialsJson: systemCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    testState.scopedKeychainCredentials = externalScopedCredentials
    testState.legacyKeychainCredentials = managedCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(externalScopedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('preserves external file and scoped login while restoring unchanged legacy keychain', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalCredentials = createClaudeCredentialsJson('external@example.com', 'external')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, externalCredentials, 'utf-8')
    testState.scopedKeychainCredentials = externalCredentials
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(externalCredentials)
    expect(testState.scopedKeychainCredentials).toBe(externalCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('restores legacy keychain credentials from old system-default snapshots', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: systemCredentials,
        configOauthAccount: null,
        keychainCredentialsJson: systemCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    testState.scopedKeychainCredentials = managedCredentials
    testState.legacyKeychainCredentials = managedCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('does not recapture managed file as system default after a partial keychain write failure', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    testState.throwRuntimeKeychainWrite = true
    await expect(service.syncForCurrentSelection()).rejects.toThrow('runtime keychain write failed')

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    testState.throwRuntimeKeychainWrite = false
    await service.syncForCurrentSelection()

    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('restores scoped keychain after legacy runtime keychain write fails', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    testState.throwLegacyRuntimeKeychainWrite = true
    await expect(service.syncForCurrentSelection()).rejects.toThrow(
      'legacy runtime keychain write failed'
    )

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('keeps managed ownership baseline when keychain restore fails and retries', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    settings.activeClaudeManagedAccountId = null
    testState.throwScopedKeychainWrite = true
    await expect(service.syncForCurrentSelection()).rejects.toThrow('scoped keychain write failed')

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(managedCredentials)
    testState.throwScopedKeychainWrite = false
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('preserves previous keychain snapshot after restart following partial restore failure', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    let service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    settings.activeClaudeManagedAccountId = null
    testState.throwScopedKeychainWrite = true
    await expect(service.syncForCurrentSelection()).rejects.toThrow('scoped keychain write failed')

    testState.throwScopedKeychainWrite = false
    service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
  })

  it('does not enter managed mode when keychain snapshot capture fails', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    testState.throwScopedKeychainRead = true
    await expect(service.syncForCurrentSelection()).rejects.toThrow(
      'Cannot capture current Claude Keychain credentials'
    )

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials)
    warn.mockRestore()
  })

  it('treats corrupt system-default snapshots as missing and clears owned runtime auth', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(snapshotPath, '{not-json', 'utf-8')
    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = managedCredentials
    testState.legacyKeychainCredentials = managedCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(existsSync(snapshotPath)).toBe(false)
    expect(existsSync(runtimeCredentialsPath)).toBe(false)
    expect(readRuntimeOauthAccountForTest()).toBeNull()
    expect(testState.scopedKeychainCredentials).toBeNull()
    expect(testState.legacyKeychainCredentials).toBeNull()
    warn.mockRestore()
  })

  it('treats wrong-shaped system-default snapshots as missing and clears owned runtime auth', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: { token: 'system' },
        keychainCredentialsJson: managedCredentials,
        scopedKeychainCredentialsJson: { token: 'scoped' },
        legacyKeychainCredentialsJson: managedCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = managedCredentials
    testState.legacyKeychainCredentials = managedCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(existsSync(snapshotPath)).toBe(false)
    expect(existsSync(runtimeCredentialsPath)).toBe(false)
    expect(readRuntimeOauthAccountForTest()).toBeNull()
    expect(testState.scopedKeychainCredentials).toBeNull()
    expect(testState.legacyKeychainCredentials).toBeNull()
    warn.mockRestore()
  })

  it('treats snapshots missing all keychain credential fields as invalid', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: null,
        configOauthAccount: null,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    testState.scopedKeychainCredentials = managedCredentials
    testState.legacyKeychainCredentials = managedCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(existsSync(snapshotPath)).toBe(false)
    expect(existsSync(runtimeCredentialsPath)).toBe(false)
    expect(testState.scopedKeychainCredentials).toBeNull()
    expect(testState.legacyKeychainCredentials).toBeNull()
    warn.mockRestore()
  })

  it('treats snapshots missing credentialsJson as invalid and clears missing-managed runtime auth', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        configOauthAccount: null,
        keychainCredentialsJson: null,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, staleManagedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'managed@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.prepareForClaudeLaunch()

    expect(existsSync(snapshotPath)).toBe(true)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(staleManagedCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'account-1' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
    warn.mockRestore()
  })

  it('clears missing-managed oauth metadata when only keychain proves ownership', async () => {
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'managed@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.prepareForClaudeLaunch()

    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'account-1' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
  })

  it('preserves missing-managed oauth metadata without credential ownership proof', async () => {
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const externalCredentials = createClaudeCredentialsJson('external@example.com', 'external')
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    const managedOauthAccount = { accountUuid: 'account-1' }
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: managedOauthAccount })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = externalCredentials
    testState.legacyKeychainCredentials = externalCredentials
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'managed@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.prepareForClaudeLaunch()

    expect(readRuntimeOauthAccountForTest()).toEqual(managedOauthAccount)
    expect(testState.scopedKeychainCredentials).toBe(externalCredentials)
    expect(testState.legacyKeychainCredentials).toBe(externalCredentials)
  })

  it('preserves invalid external runtime oauth metadata when deselecting', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(runtimeConfigPath, `${JSON.stringify({})}\n`, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials,
      'null\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeConfigPath, '{not-json', 'utf-8')
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readFileSync(runtimeConfigPath, 'utf-8')).toBe('{not-json')
  })

  it('preserves invalid runtime config while materializing managed credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(runtimeConfigPath, '{not-json', 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)
    expect(testState.scopedKeychainCredentials).toBe(managedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(managedCredentials)
    expect(readFileSync(runtimeConfigPath, 'utf-8')).toBe('{not-json')

    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readFileSync(runtimeConfigPath, 'utf-8')).toBe('{not-json')
  })

  it('preserves non-object runtime config while materializing managed credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(runtimeConfigPath, '[]', 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(managedCredentials)
    expect(readFileSync(runtimeConfigPath, 'utf-8')).toBe('[]')
  })

  it('does not use skipped oauth writes as ownership proof on deselect', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const externalCredentials = createClaudeCredentialsJson('external@example.com', 'external')
    const managedOauthAccount = { accountUuid: 'account-1' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(runtimeConfigPath, '{not-json', 'utf-8')
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials,
      `${JSON.stringify(managedOauthAccount)}\n`
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, externalCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: managedOauthAccount })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = externalCredentials
    testState.legacyKeychainCredentials = externalCredentials
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(externalCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(managedOauthAccount)
    expect(testState.scopedKeychainCredentials).toBe(externalCredentials)
    expect(testState.legacyKeychainCredentials).toBe(externalCredentials)
  })

  it('preserves external oauth logout when managed oauth metadata is null', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'system-account' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = systemCredentials
    testState.legacyKeychainCredentials = systemCredentials
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials,
      'null\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    rmSync(runtimeCredentialsPath, { force: true })
    testState.scopedKeychainCredentials = null
    testState.legacyKeychainCredentials = null
    writeFileSync(runtimeConfigPath, `${JSON.stringify({})}\n`, 'utf-8')
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(existsSync(runtimeCredentialsPath)).toBe(false)
    expect(readRuntimeOauthAccountForTest()).toBeNull()
    expect(testState.scopedKeychainCredentials).toBeNull()
    expect(testState.legacyKeychainCredentials).toBeNull()
  })

  it('restores reordered owned oauth metadata using stable json equality', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account', emailAddress: 'system@example.com' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials,
      '{"accountUuid":"account-1","emailAddress":"user@example.com"}\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    writeFileSync(
      runtimeConfigPath,
      '{"oauthAccount":{"emailAddress":"user@example.com","accountUuid":"account-1"}}\n',
      'utf-8'
    )
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('restores owned oauth metadata during rollback after removing the added account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account' }
    writeFileSync(runtimeCredentialsPath, systemCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount })}\n`,
      'utf-8'
    )
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials,
      '{"accountUuid":"account-1"}\n'
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()

    settings.activeClaudeManagedAccountId = null
    settings.claudeManagedAccounts = []
    await service.forceMaterializeCurrentSelectionForRollback()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount)
  })

  it('reads back refreshed file credentials when keychain reads fail', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const refreshedCredentials = createClaudeCredentialsJson('user@example.com', 'refreshed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    testState.throwScopedKeychainRead = true
    testState.throwLegacyKeychainRead = true
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(refreshedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCredentials)
    warn.mockRestore()
  })

  it('captures a fresh system-default snapshot when re-entering managed mode', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const systemCredentials1 = createClaudeCredentialsJson('system1@example.com', 'system1')
    const systemCredentials2 = createClaudeCredentialsJson('system2@example.com', 'system2')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, systemCredentials1, 'utf-8')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()
    writeFileSync(runtimeCredentialsPath, systemCredentials2, 'utf-8')

    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials2)
  })

  it('refreshes keychain and oauth snapshot surfaces when the credentials file is unchanged', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const systemCredentials1 = createClaudeCredentialsJson('system1@example.com', 'system1')
    const systemCredentials2 = createClaudeCredentialsJson('system2@example.com', 'system2')
    const managedCredentials = createClaudeCredentialsJson('user@example.com', 'managed')
    const systemOauthAccount1 = { accountUuid: 'system-account-1' }
    const systemOauthAccount2 = { accountUuid: 'system-account-2' }
    writeFileSync(runtimeCredentialsPath, systemCredentials1, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount1 })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = systemCredentials1
    testState.legacyKeychainCredentials = systemCredentials1
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)]
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, managedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: systemOauthAccount2 })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = systemCredentials2
    testState.legacyKeychainCredentials = systemCredentials2
    settings.activeClaudeManagedAccountId = 'account-1'
    await service.syncForCurrentSelection()
    settings.activeClaudeManagedAccountId = null
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(systemCredentials1)
    expect(readRuntimeOauthAccountForTest()).toEqual(systemOauthAccount2)
    expect(testState.scopedKeychainCredentials).toBe(systemCredentials2)
    expect(testState.legacyKeychainCredentials).toBe(systemCredentials2)
  })

  it('reads back refreshed credentials for the outgoing Claude account before switching', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Original = createClaudeCredentialsJson('one@example.com', 'one-original')
    const account1Refreshed = createClaudeCredentialsJson('one@example.com', 'one-refreshed')
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Original
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, account1Refreshed, 'utf-8')
    settings.activeClaudeManagedAccountId = 'account-2'
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(account1Refreshed)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2Credentials)
  })

  it('switches accounts without persisting unverified live runtime credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Original = createClaudeCredentialsJson('one@example.com', 'one-original', 'org-a')
    const unverifiedLiveCredentials = createClaudeCredentialsWithoutEmail('one-live', 'org-b')
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two', 'org-c')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Original
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, {
          email: 'one@example.com',
          organizationUuid: 'org-a'
        }),
        createClaudeAccount('account-2', managedAuthPath2, {
          email: 'two@example.com',
          organizationUuid: 'org-c'
        })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    markClaudePtySpawned('live-claude-pty')
    try {
      writeFileSync(runtimeCredentialsPath, unverifiedLiveCredentials, 'utf-8')
      settings.activeClaudeManagedAccountId = 'account-2'

      await service.syncForCurrentSelection()
    } finally {
      markClaudePtyExited('live-claude-pty')
    }

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(account1Original)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2Credentials)
    if (process.platform === 'darwin') {
      expect(testState.scopedKeychainCredentials).toBe(account2Credentials)
    }
  })

  it('routes refreshed Claude credentials to the matching managed account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Original = createClaudeCredentialsJson('one@example.com', 'one-original')
    const account1Refreshed = createClaudeCredentialsJson('one@example.com', 'one-refreshed')
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Original
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-2'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    // A stale account-1 Claude process refreshed the shared runtime file after
    // Orca selected account-2. Persist that refresh to account-1, then restore
    // the selected account in the shared Claude runtime credentials.
    writeFileSync(runtimeCredentialsPath, account1Refreshed, 'utf-8')
    testState.scopedKeychainCredentials = account1Refreshed
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(account1Refreshed)
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(account2Credentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2Credentials)
    if (process.platform === 'darwin') {
      expect(testState.scopedKeychainCredentials).toBe(account2Credentials)
      expect(testState.legacyKeychainCredentials).toBe(account2Credentials)
    }
  })

  it('rejects stale cold-start read-back for inactive matching account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1ManagedNewer = createClaudeCredentialsJson(
      'one@example.com',
      'one-managed-newer',
      null,
      5_000
    )
    const account1RuntimeStale = createClaudeCredentialsJson(
      'one@example.com',
      'one-runtime-stale',
      null,
      2_000
    )
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two', null, 1_000)
    writeFileSync(runtimeCredentialsPath, account1RuntimeStale, 'utf-8')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1ManagedNewer
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'two@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-2'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(account1ManagedNewer)
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(account2Credentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account2Credentials)
  })

  it('rejects ambiguous Claude read-back instead of choosing a managed account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('same@example.com', 'same-original')
    const refreshedCredentials = createClaudeCredentialsJson('same@example.com', 'same-refreshed')
    const activeCredentials = createClaudeCredentialsJson('active@example.com', 'active')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      originalCredentials
    )
    const managedAuthPath3 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-3',
      activeCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'same@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, { email: 'same@example.com' }),
        createClaudeAccount('account-3', managedAuthPath3, { email: 'active@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-3'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedCredentials, 'utf-8')
    testState.scopedKeychainCredentials = refreshedCredentials
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(originalCredentials)
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(originalCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(activeCredentials)
    if (process.platform === 'darwin') {
      expect(testState.scopedKeychainCredentials).toBe(activeCredentials)
      expect(testState.legacyKeychainCredentials).toBe(activeCredentials)
    }
  })

  it('rejects same-email read-back when another account needs organization proof', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const noOrgCredentials = createClaudeCredentialsJson('same@example.com', 'no-org')
    const orgCredentials = createClaudeCredentialsJson('same@example.com', 'org', 'org-b')
    const refreshedWithoutOrg = createClaudeCredentialsJson('same@example.com', 'refreshed')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      noOrgCredentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      orgCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'same@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, {
          email: 'same@example.com',
          organizationUuid: 'org-b'
        })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, refreshedWithoutOrg, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(noOrgCredentials)
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(orgCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(noOrgCredentials)
  })

  it('ignores unrelated org-scoped accounts when reading back no-org credentials', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Credentials = createClaudeCredentialsJson('one@example.com', 'one')
    const account1RefreshedCredentials = createClaudeCredentialsJson(
      'one@example.com',
      'one-refreshed'
    )
    const account2Credentials = createClaudeCredentialsJson('two@example.com', 'two', 'org-b')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Credentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      account2Credentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, {
          email: 'two@example.com',
          organizationUuid: 'org-b'
        })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, account1RefreshedCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(
      account1RefreshedCredentials
    )
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(account2Credentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1RefreshedCredentials)
  })

  it('rejects same-email read-back with conflicting organization for no-org accounts', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const noOrgCredentials = createClaudeCredentialsJson('same@example.com', 'no-org')
    const orgCredentials = createClaudeCredentialsJson('same@example.com', 'org', 'org-b')
    const conflictingOrgCredentials = createClaudeCredentialsJson(
      'same@example.com',
      'conflicting-org',
      'org-c'
    )
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      noOrgCredentials
    )
    const managedAuthPath2 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-2',
      orgCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'same@example.com' }),
        createClaudeAccount('account-2', managedAuthPath2, {
          email: 'same@example.com',
          organizationUuid: 'org-b'
        })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    writeFileSync(runtimeCredentialsPath, conflictingOrgCredentials, 'utf-8')
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(noOrgCredentials)
    expect(readManagedCredentialsForTest('account-2', managedAuthPath2)).toBe(orgCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(noOrgCredentials)
  })

  it('preserves unknown runtime auth when invalid active account has no ownership proof', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account' }
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: systemCredentials,
        configOauthAccount: systemOauthAccount,
        keychainCredentialsJson: systemCredentials,
        scopedKeychainCredentialsJson: systemCredentials,
        legacyKeychainCredentialsJson: systemCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, staleManagedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'missing-account' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      activeClaudeManagedAccountId: 'missing-account'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(store.updateSettings).toHaveBeenCalledWith({
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
    })
    expect(preparation.configDir).toBe(join(testState.fakeHomeDir, '.claude'))
    expect(preparation.stripAuthEnv).toBe(false)
    expect(preparation.provenance).toBe('system')
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(staleManagedCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'missing-account' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
  })

  it('restores system snapshot when active account credentials are missing but runtime matches account', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account' }
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: systemCredentials,
        configOauthAccount: systemOauthAccount,
        keychainCredentialsJson: systemCredentials,
        scopedKeychainCredentialsJson: systemCredentials,
        legacyKeychainCredentialsJson: systemCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, staleManagedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'managed@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation.provenance).toBe('system')
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(staleManagedCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'account-1' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
  })

  it('keeps missing-managed selection until cleanup can retry after keychain failure', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account' }
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: systemCredentials,
        configOauthAccount: systemOauthAccount,
        keychainCredentialsJson: systemCredentials,
        scopedKeychainCredentialsJson: systemCredentials,
        legacyKeychainCredentialsJson: systemCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(runtimeCredentialsPath, staleManagedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'managed@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    testState.throwScopedKeychainWrite = true
    const failedPreparation = await service.prepareForClaudeLaunch()

    expect(failedPreparation.provenance).toBe('system')
    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(staleManagedCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'account-1' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)

    testState.throwScopedKeychainWrite = false
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation.provenance).toBe('system')
    expect(store.getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
  })

  it('restores missing-managed oauth metadata when only keychain proves ownership', async () => {
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const snapshotPath = join(
      testState.userDataDir,
      'claude-runtime-auth',
      'system-default-auth.json'
    )
    const systemCredentials = createClaudeCredentialsJson('system@example.com', 'system')
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    const systemOauthAccount = { accountUuid: 'system-account' }
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(join(testState.userDataDir, 'claude-runtime-auth'), { recursive: true })
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({
        credentialsJson: systemCredentials,
        configOauthAccount: systemOauthAccount,
        keychainCredentialsJson: systemCredentials,
        scopedKeychainCredentialsJson: systemCredentials,
        legacyKeychainCredentialsJson: systemCredentials,
        capturedAt: Date.now()
      })}\n`,
      'utf-8'
    )
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'account-1' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, { email: 'managed@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.prepareForClaudeLaunch()

    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'account-1' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
  })

  it('preserves unknown runtime auth when invalid active account has no system snapshot', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const runtimeConfigPath = join(testState.fakeHomeDir, '.claude.json')
    const staleManagedCredentials = createClaudeCredentialsJson('managed@example.com', 'managed')
    writeFileSync(runtimeCredentialsPath, staleManagedCredentials, 'utf-8')
    writeFileSync(
      runtimeConfigPath,
      `${JSON.stringify({ oauthAccount: { accountUuid: 'missing-account' } })}\n`,
      'utf-8'
    )
    testState.scopedKeychainCredentials = staleManagedCredentials
    testState.legacyKeychainCredentials = staleManagedCredentials
    const settings = createSettings({
      activeClaudeManagedAccountId: 'missing-account'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation.provenance).toBe('system')
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(staleManagedCredentials)
    expect(readRuntimeOauthAccountForTest()).toEqual({ accountUuid: 'missing-account' })
    expect(testState.scopedKeychainCredentials).toBe(staleManagedCredentials)
    expect(testState.legacyKeychainCredentials).toBe(staleManagedCredentials)
  })

  it('uses account WSL runtime for untargeted Claude preparation instead of stale terminal WSL settings', async () => {
    setPlatform('win32')
    vi.doMock('../wsl', () => ({
      getCachedWslDistros: () => ['Ubuntu'],
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => null,
      listWslDistrosAsync: async () => ['Ubuntu'],
      toWindowsWslPath: (value: string) => value
    }))
    const ubuntuAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'ubuntu-account',
      createClaudeCredentialsJson('ubuntu@example.com', 'ubuntu-token')
    )
    const settings = createSettings({
      localAccountRuntime: 'wsl',
      localAccountWslDistro: 'Ubuntu',
      terminalWindowsShell: 'wsl.exe',
      terminalWindowsWslDistro: 'Debian',
      claudeManagedAccounts: [
        createClaudeAccount('ubuntu-account', ubuntuAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/ubuntu/auth'
        })
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: {
        host: null,
        wsl: { Ubuntu: 'ubuntu-account' }
      }
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation).toMatchObject({
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      wslLinuxConfigDir: '/home/alice/.local/share/orca/claude-accounts/ubuntu/auth',
      provenance: 'managed:ubuntu-account:wsl:Ubuntu',
      stripAuthEnv: true
    })
  })

  it('uses the global WSL runtime for untargeted Claude preparation under auto', async () => {
    setPlatform('win32')
    vi.doMock('../wsl', () => ({
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => null,
      toWindowsWslPath: (value: string) => value
    }))
    const ubuntuAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'ubuntu-account',
      createClaudeCredentialsJson('ubuntu@example.com', 'ubuntu-token')
    )
    const settings = createSettings({
      localAccountRuntime: 'auto',
      localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' },
      claudeManagedAccounts: [
        createClaudeAccount('ubuntu-account', ubuntuAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/ubuntu/auth'
        })
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: {
        host: null,
        wsl: { Ubuntu: 'ubuntu-account' }
      }
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation).toMatchObject({
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      provenance: 'managed:ubuntu-account:wsl:Ubuntu'
    })
  })

  it('ignores a persisted WSL account-runtime pin on non-Windows hosts', async () => {
    setPlatform('darwin')
    vi.doMock('../wsl', () => ({
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => null,
      toWindowsWslPath: (value: string) => value
    }))
    const settings = createSettings({
      localAccountRuntime: 'wsl',
      localAccountWslDistro: 'Ubuntu'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation).toMatchObject({
      runtime: 'host',
      wslDistro: null,
      provenance: 'system',
      stripAuthEnv: false
    })
  })

  it('keeps untargeted Claude preparation on host when account runtime is host', async () => {
    setPlatform('win32')
    vi.doMock('../wsl', () => ({
      getCachedWslDistros: () => ['Ubuntu'],
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => null,
      listWslDistrosAsync: async () => ['Ubuntu'],
      toWindowsWslPath: (value: string) => value
    }))
    const settings = createSettings({
      localAccountRuntime: 'host',
      terminalWindowsShell: 'wsl.exe',
      terminalWindowsWslDistro: 'Debian'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(preparation).toMatchObject({
      runtime: 'host',
      wslDistro: null,
      provenance: 'system',
      stripAuthEnv: false
    })
  })

  it('clears a selected WSL managed account when its credentials are missing', async () => {
    const managedAuthPath = join(testState.userDataDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/account-1/auth'
        })
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: 'account-1' } }
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch({
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })

    expect(store.updateSettings).toHaveBeenCalledWith({
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: null } }
    })
    expect(preparation.runtime).toBe('wsl')
    expect(preparation.provenance).toBe('wsl:Ubuntu:system')
    expect(preparation.stripAuthEnv).toBe(true)
  })

  it('uses the default distro selection for WSL-default Claude preparation', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    vi.doMock('../wsl', () => ({
      getCachedWslDistros: () => ['Ubuntu'],
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => join(testState.userDataDir, 'wsl-home'),
      listWslDistrosAsync: async () => ['Ubuntu'],
      toWindowsWslPath: (value: string) => value
    }))
    const ubuntuAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'ubuntu-account',
      createClaudeCredentialsJson('ubuntu@example.com', 'ubuntu-token')
    )
    const debianAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'debian-account',
      createClaudeCredentialsJson('debian@example.com', 'debian-token')
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('ubuntu-account', ubuntuAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/ubuntu/auth'
        }),
        createClaudeAccount('debian-account', debianAuthPath, {
          managedAuthRuntime: 'wsl',
          wslDistro: 'Debian',
          wslLinuxAuthPath: '/home/alice/.local/share/orca/claude-accounts/debian/auth'
        })
      ],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: {
        host: null,
        wsl: { Ubuntu: 'ubuntu-account', Debian: 'debian-account' }
      }
    })
    const store = createStore(settings)

    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)
      const preparation = await service.prepareForClaudeLaunch({
        runtime: 'wsl',
        wslDistro: null
      })

      expect(preparation).toMatchObject({
        runtime: 'wsl',
        wslDistro: 'Ubuntu',
        wslLinuxConfigDir: '/home/alice/.local/share/orca/claude-accounts/ubuntu/auth',
        provenance: 'managed:ubuntu-account:wsl:Ubuntu',
        stripAuthEnv: true
      })
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
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
    markClaudePtySpawned('global-pty')
    try {
      const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
      const service = new ClaudeRuntimeAuthService(store as never)
      await expect(
        service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'account-1' })
      ).rejects.toThrow('running global Claude terminal')
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
    markClaudePtySpawned('global-pty-2')
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
    // The exact stuck state from the field: a null-bound global terminal plus
    // the pinned session's own live CLI.
    markClaudePtySpawned('global-pty')
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
      ).rejects.toThrow('running global Claude terminal')
      await expect(
        service.prepareForClaudeLaunch({ runtime: 'host', overrideAccountId: 'account-1' })
      ).rejects.toThrow('running global Claude terminal')
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
      ).rejects.toThrow('running global Claude terminal')
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

  it('does not clobber fresh Claude credentials after clearLastWrittenCredentialsJson', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const originalCredentials = createClaudeCredentialsJson('user@example.com', 'original')
    const reauthedCredentials = createClaudeCredentialsJson('user@example.com', 'reauthed')
    const managedAuthPath = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      originalCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [createClaudeAccount('account-1', managedAuthPath)],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    testState.managedKeychainCredentials.set('account-1', reauthedCredentials)
    writeFileSync(join(managedAuthPath, '.credentials.json'), reauthedCredentials, 'utf-8')
    service.clearLastWrittenCredentialsJson()
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath)).toBe(reauthedCredentials)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(reauthedCredentials)
  })

  it('leaves host system-default credentials untouched before launch', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const expired = createClaudeCredentialsJson('system@example.com', 'system-expired', null, 1_000)
    writeFileSync(runtimeCredentialsPath, expired, 'utf-8')
    testState.scopedKeychainCredentials = expired
    testState.legacyKeychainCredentials = expired
    const settings = createSettings({
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)

    vi.mocked(isOauthTokenExpiring).mockReturnValue(true)
    vi.mocked(refreshClaudeOauthCredentials).mockResolvedValue(
      createClaudeCredentialsJson('system@example.com', 'system-refreshed')
    )

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    const preparation = await service.prepareForClaudeLaunch()

    expect(isOauthTokenExpiring).not.toHaveBeenCalled()
    expect(refreshClaudeOauthCredentials).not.toHaveBeenCalled()
    expect(preparation.provenance).toBe('system')
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(expired)
    expect(testState.scopedKeychainCredentials).toBe(expired)
    expect(testState.legacyKeychainCredentials).toBe(expired)

    vi.mocked(isOauthTokenExpiring).mockReturnValue(false)
    vi.mocked(refreshClaudeOauthCredentials).mockResolvedValue(null)
  })

  it('proactively refreshes and persists an expiring account on switch-in', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const account1Stale = createClaudeCredentialsJson('one@example.com', 'one-stale', null, 1_000)
    const account1Refreshed = createClaudeCredentialsJson(
      'one@example.com',
      'one-refreshed',
      null,
      9_999_999_999_999
    )
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      account1Stale
    )
    // Start on the system default (no active managed account), then switch in.
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' })
      ],
      activeClaudeManagedAccountId: null
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    // Now switch into account-1: token is expiring, so the service must refresh
    // and persist the rotation before materializing.
    vi.mocked(isOauthTokenExpiring).mockReturnValueOnce(true)
    vi.mocked(refreshClaudeOauthCredentials).mockResolvedValueOnce(account1Refreshed)
    store.updateSettings({ activeClaudeManagedAccountId: 'account-1' })
    await service.syncForCurrentSelection()

    expect(refreshClaudeOauthCredentials).toHaveBeenCalledWith(account1Stale)
    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(account1Refreshed)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(account1Refreshed)
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

  it('refreshes the active account with an expired token when no Claude PTY is live', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const expired = createClaudeCredentialsJson('one@example.com', 'one-expired', null, 1_000)
    const refreshedCreds = createClaudeCredentialsJson(
      'one@example.com',
      'one-refreshed',
      null,
      9_999_999_999_999
    )
    const managedAuthPath1 = createManagedClaudeAuth(testState.userDataDir, 'account-1', expired)
    // account-1 is ALREADY the active account (seeded), so this is a re-sync of
    // the active account, not a switch-in — the path that was previously missed.
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    vi.mocked(isOauthTokenExpiring).mockReturnValue(true)
    vi.mocked(refreshClaudeOauthCredentials).mockResolvedValue(refreshedCreds)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(refreshClaudeOauthCredentials).toHaveBeenCalled()
    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(refreshedCreds)
    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(refreshedCreds)

    vi.mocked(isOauthTokenExpiring).mockReturnValue(false)
    vi.mocked(refreshClaudeOauthCredentials).mockResolvedValue(null)
  })

  it('does not refresh the active account while a Claude PTY is live', async () => {
    const expired = createClaudeCredentialsJson('one@example.com', 'one-expired', null, 1_000)
    const managedAuthPath1 = createManagedClaudeAuth(testState.userDataDir, 'account-1', expired)
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    vi.mocked(isOauthTokenExpiring).mockReturnValue(true)
    vi.mocked(refreshClaudeOauthCredentials).mockResolvedValue(
      createClaudeCredentialsJson('one@example.com', 'should-not-be-used', null, 9_999_999_999_999)
    )

    const { markClaudePtySpawned, markClaudePtyExited } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)

    markClaudePtySpawned('pty-live-1')
    try {
      const preparation = await service.prepareForRateLimitFetch()
      // A live Claude owns the credentials; refreshing here would race its
      // rotation, so the proactive refresh must be skipped entirely.
      expect(refreshClaudeOauthCredentials).not.toHaveBeenCalled()
      expect(preparation.managedRefreshDeferredByLivePty).toBe(true)
    } finally {
      markClaudePtyExited('pty-live-1')
      vi.mocked(isOauthTokenExpiring).mockReturnValue(false)
      vi.mocked(refreshClaudeOauthCredentials).mockResolvedValue(null)
    }
  })

  it('adopts a rotated-refresh-token runtime credential on cold-start read-back', async () => {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    // Same expiry on both sides (cold start), but the runtime refresh token has
    // rotated — proof the CLI refreshed. Must be read back into managed storage.
    const managedCredentials = createClaudeCredentialsJson(
      'one@example.com',
      'one-old',
      null,
      3_000
    )
    const runtimeRotated = `${JSON.stringify({
      claudeAiOauth: {
        email: 'one@example.com',
        accessToken: 'one-rotated',
        refreshToken: 'one-rotated-refresh',
        expiresAt: 3_000
      }
    })}\n`
    writeFileSync(runtimeCredentialsPath, runtimeRotated, 'utf-8')
    const managedAuthPath1 = createManagedClaudeAuth(
      testState.userDataDir,
      'account-1',
      managedCredentials
    )
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-1', managedAuthPath1, { email: 'one@example.com' })
      ],
      activeClaudeManagedAccountId: 'account-1'
    })
    const store = createStore(settings)

    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-1', managedAuthPath1)).toBe(runtimeRotated)
  })
})
