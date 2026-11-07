import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'

const TEST_ROOT = join(tmpdir(), 'orca-claude-service-long-lived-token-test')
const FAKE_TOKEN = 'fixture-token-not-a-real-credential'

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

function createVault(accountId: string): string {
  const managedAuthPath = join(TEST_ROOT, 'claude-accounts', accountId, 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  writeFileSync(
    join(managedAuthPath, 'settings.json'),
    JSON.stringify({ hooks: { Stop: [] } }),
    'utf-8'
  )
  return managedAuthPath
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
  const service = new ClaudeAccountService(store as never, rateLimits as never, {} as never)
  return { service, getSettings: () => settings }
}

function account(id: string, email: string, managedAuthPath: string, extra = {}) {
  return {
    id,
    email,
    managedAuthPath,
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...extra
  }
}

describe('ClaudeAccountService long-lived token (ORCA-1039)', () => {
  beforeEach(() => {
    setPlatform('linux')
    resetClaudeKeychainMocks()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  afterEach(() => {
    restorePlatform()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('stores the token only in the vault settings env, by email, and records when', async () => {
    const vault = createVault('account-a')
    const { service, getSettings } = await createService([
      account('account-a', 'A@Example.com', vault)
    ])

    await service.setLongLivedToken('a@example.com', `${FAKE_TOKEN}\n`)

    const written = JSON.parse(readFileSync(join(vault, 'settings.json'), 'utf-8'))
    expect(written).toEqual({ hooks: { Stop: [] }, env: { CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN } })
    if (process.platform !== 'win32') {
      expect(statSync(join(vault, 'settings.json')).mode & 0o777).toBe(0o600)
    }
    const stored = getSettings().claudeManagedAccounts[0] as { longLivedTokenSetAt?: number }
    expect(stored.longLivedTokenSetAt).toBeGreaterThan(0)
    expect(JSON.stringify(getSettings())).not.toContain(FAKE_TOKEN)
  })

  it('clears the token and the record', async () => {
    const vault = createVault('account-a')
    const { service, getSettings } = await createService([
      account('account-a', 'a@example.com', vault)
    ])
    await service.setLongLivedToken('account-a', FAKE_TOKEN)

    await service.setLongLivedToken('account-a', null)

    expect(JSON.parse(readFileSync(join(vault, 'settings.json'), 'utf-8'))).toEqual({
      hooks: { Stop: [] }
    })
    const stored = getSettings().claudeManagedAccounts[0] as { longLivedTokenSetAt?: number }
    expect(stored.longLivedTokenSetAt ?? null).toBeNull()
  })

  it('refuses custom-endpoint, WSL and unknown accounts', async () => {
    const vault = createVault('account-a')
    const { service } = await createService([
      account('endpoint', 'z.ai', vault, { authMethod: 'custom-endpoint' }),
      account('wsl', 'w@example.com', vault, { managedAuthRuntime: 'wsl' })
    ])
    await expect(service.setLongLivedToken('endpoint', FAKE_TOKEN)).rejects.toThrow(
      /Claude sign-in/
    )
    await expect(service.setLongLivedToken('wsl', FAKE_TOKEN)).rejects.toThrow(/WSL/)
    await expect(service.setLongLivedToken('nobody@example.com', FAKE_TOKEN)).rejects.toThrow(
      /No managed Claude account/
    )
  })
})
