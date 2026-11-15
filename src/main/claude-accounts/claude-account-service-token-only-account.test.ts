import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'

const TEST_ROOT = join(tmpdir(), 'orca-claude-service-token-only-account-test')
const FAKE_TOKEN = 'fixture-token-not-a-real-credential'

const tokenCheck = vi.hoisted(() => ({
  checkClaudeLongLivedToken: vi.fn(async () => ({ state: 'verified', checkedAt: 1 }))
}))

vi.mock('electron', () => ({ app: { getPath: () => TEST_ROOT } }))
vi.mock('../codex-cli/command', () => ({
  resolveClaudeCommand: vi.fn(() => 'claude'),
  resolveCliCommandOrNull: vi.fn(() => 'claude')
}))
vi.mock('../startup/hydrate-shell-path', () => ({
  hydrateShellPath: vi.fn(async () => ({ ok: false, segments: [], failureReason: 'disabled' })),
  mergePathSegments: vi.fn((segments: string[]) => segments)
}))
vi.mock('../rate-limits/claude-long-lived-token-check', () => tokenCheck)
vi.mock('./keychain', () => ({
  deleteActiveClaudeKeychainCredentialsStrict: vi.fn(async () => {}),
  deleteManagedClaudeKeychainCredentials: vi.fn(async () => {}),
  readActiveClaudeKeychainCredentials: vi.fn(),
  readActiveClaudeKeychainCredentialsStrict: vi.fn(),
  readManagedClaudeKeychainCredentials: vi.fn(),
  writeActiveClaudeKeychainCredentials: vi.fn(async () => {}),
  writeManagedClaudeKeychainCredentials: vi.fn(async () => {})
}))

type TestAccount = Record<string, unknown> & { id: string; email: string; managedAuthPath: string }

function createVault(accountId: string, env: Record<string, string> = {}): string {
  const managedAuthPath = join(TEST_ROOT, 'claude-accounts', accountId, 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  writeFileSync(join(managedAuthPath, 'settings.json'), JSON.stringify({ env }), 'utf-8')
  return managedAuthPath
}

function account(id: string, email: string, managedAuthPath: string, extra = {}): TestAccount {
  return {
    id,
    email,
    managedAuthPath,
    managedAuthRuntime: 'host',
    authMethod: 'subscription-oauth',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...extra
  }
}

async function createService(accounts: TestAccount[]) {
  let settings = {
    claudeManagedAccounts: accounts,
    activeClaudeManagedAccountId: null as string | null,
    activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
  }
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
    refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
  }
  const runtimeAuth = {
    clearLastWrittenCredentialsJson: vi.fn(),
    syncForCurrentSelection: vi.fn(async () => {}),
    forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
  }
  const { ClaudeAccountService } = await import('./service')
  const service = new ClaudeAccountService(
    store as never,
    rateLimits as never,
    runtimeAuth as never
  )
  return { service, getSettings: () => settings }
}

function vaultDirs(): string[] {
  const root = join(TEST_ROOT, 'claude-accounts')
  return existsSync(root) ? readdirSync(root) : []
}

describe('ClaudeAccountService token-only accounts (ORCA-1215)', () => {
  beforeEach(() => {
    setPlatform('linux')
    resetClaudeKeychainMocks()
    tokenCheck.checkClaudeLongLivedToken.mockResolvedValue({ state: 'verified', checkedAt: 1 })
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  afterEach(() => {
    restorePlatform()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('adds an account from a label and a token, with no stored login and no change of selection', async () => {
    const { service, getSettings } = await createService([])

    const state = await service.addLongLivedTokenAccount('  Team Max  ', `${FAKE_TOKEN}\n`)

    const added = getSettings().claudeManagedAccounts[0] as TestAccount & {
      tokenOnly?: boolean
      longLivedTokenSetAt?: number
    }
    expect(added.email).toBe('Team Max')
    expect(added.authMethod).toBe('subscription-oauth')
    expect(added.tokenOnly).toBe(true)
    expect(added.longLivedTokenSetAt).toBeGreaterThan(0)
    const settingsJson = JSON.parse(
      readFileSync(join(added.managedAuthPath, 'settings.json'), 'utf-8')
    )
    expect(settingsJson.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(FAKE_TOKEN)
    const claudeJson = JSON.parse(
      readFileSync(join(added.managedAuthPath, '.claude.json'), 'utf-8')
    )
    expect(claudeJson.hasCompletedOnboarding).toBe(true)
    expect(existsSync(join(added.managedAuthPath, '.credentials.json'))).toBe(false)
    expect(getSettings().activeClaudeManagedAccountId).toBeNull()
    expect(state.accounts[0]).toMatchObject({ email: 'Team Max', tokenOnly: true })
    expect(JSON.stringify(getSettings())).not.toContain(FAKE_TOKEN)
    expect(JSON.stringify(state)).not.toContain(FAKE_TOKEN)
  })

  it('refuses a label that is an existing account email, without creating a vault', async () => {
    const vault = createVault('account-a')
    const { service, getSettings } = await createService([
      account('account-a', 'A@Example.com', vault)
    ])

    await expect(service.addLongLivedTokenAccount('a@example.com', FAKE_TOKEN)).rejects.toThrow(
      /already added/
    )
    expect(() => service.assertLongLivedTokenAccountLabelIsFree('A@example.com')).toThrow(
      /already added/
    )
    expect(getSettings().claudeManagedAccounts).toHaveLength(1)
    expect(vaultDirs()).toEqual(['account-a'])
  })

  it('does not count a custom endpoint label as a Claude identity', async () => {
    const vault = createVault('endpoint')
    const { service, getSettings } = await createService([
      account('endpoint', 'Team Max', vault, { authMethod: 'custom-endpoint' })
    ])

    await service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)

    expect(getSettings().claudeManagedAccounts).toHaveLength(2)
  })

  it('refuses a token another account on this host already stores, naming that account', async () => {
    const vault = createVault('account-a', { CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN })
    const { service, getSettings } = await createService([
      account('account-a', 'a@example.com', vault)
    ])

    const error = await service.addLongLivedTokenAccount('Someone else', FAKE_TOKEN).then(
      () => null,
      (cause: Error) => cause
    )

    expect(error?.message).toMatch(/already stored for a@example\.com/)
    expect(error?.message).not.toContain(FAKE_TOKEN)
    expect(getSettings().claudeManagedAccounts).toHaveLength(1)
    expect(vaultDirs()).toEqual(['account-a'])
  })

  it('refuses a token Claude rejects and leaves nothing behind', async () => {
    tokenCheck.checkClaudeLongLivedToken.mockResolvedValue({ state: 'rejected', checkedAt: 1 })
    const { service, getSettings } = await createService([])

    await expect(service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)).rejects.toThrow(
      /rejected this token/
    )
    expect(getSettings().claudeManagedAccounts).toHaveLength(0)
    expect(vaultDirs()).toEqual([])
  })

  it('adds the account when the token check is inconclusive (offline)', async () => {
    tokenCheck.checkClaudeLongLivedToken.mockResolvedValue({ state: 'undecided', checkedAt: 1 })
    const { service, getSettings } = await createService([])

    await service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)

    expect(getSettings().claudeManagedAccounts).toHaveLength(1)
  })

  it('refuses an empty label and a malformed token without echoing the token', async () => {
    const { service } = await createService([])

    await expect(service.addLongLivedTokenAccount('   ', FAKE_TOKEN)).rejects.toThrow(/name/)
    await expect(
      service.addLongLivedTokenAccount('Team Max', `${FAKE_TOKEN} extra`)
    ).rejects.toThrow(/whitespace/)
    expect(vaultDirs()).toEqual([])
  })

  it('refuses to clear the only credential of a token-only account, but replaces it', async () => {
    const { service, getSettings } = await createService([])
    await service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)
    const added = getSettings().claudeManagedAccounts[0]

    await expect(service.setLongLivedToken(added.id, null)).rejects.toThrow(/Remove the account/)
    await service.setLongLivedToken(added.id, `${FAKE_TOKEN}-next`)

    const settingsJson = JSON.parse(
      readFileSync(join(added.managedAuthPath, 'settings.json'), 'utf-8')
    )
    expect(settingsJson.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(`${FAKE_TOKEN}-next`)
  })

  it('never makes a token-only account the shared login', async () => {
    const { service, getSettings } = await createService([])
    await service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)
    const added = getSettings().claudeManagedAccounts[0]

    await expect(service.selectAccount(added.id)).rejects.toThrow(/per worktree/)
    expect(getSettings().activeClaudeManagedAccountId).toBeNull()
  })

  it('lets Sign in again adopt the signed-in identity of a token-only account', async () => {
    const { service, getSettings } = await createService([])
    await service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)
    const added = getSettings().claudeManagedAccounts[0]
    ;(
      service as unknown as { runClaudeLoginAndCapture: () => Promise<unknown> }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: '{"claudeAiOauth":{"accessToken":"x"}}\n',
      oauthAccount: { emailAddress: 'max@example.com' },
      identity: { email: 'max@example.com', organizationUuid: 'org-1', organizationName: 'Org' }
    }))

    await service.reauthenticateAccount(added.id)

    const updated = getSettings().claudeManagedAccounts[0] as TestAccount & { tokenOnly?: boolean }
    expect(updated.email).toBe('max@example.com')
    expect(updated.organizationUuid).toBe('org-1')
    expect(updated.tokenOnly ?? false).toBe(false)
  })

  it('refuses Sign in again on a token-only account as an identity that is already added', async () => {
    const vault = createVault('account-a')
    const { service, getSettings } = await createService([
      account('account-a', 'max@example.com', vault)
    ])
    await service.addLongLivedTokenAccount('Team Max', FAKE_TOKEN)
    const added = getSettings().claudeManagedAccounts[1]
    ;(
      service as unknown as { runClaudeLoginAndCapture: () => Promise<unknown> }
    ).runClaudeLoginAndCapture = vi.fn(async () => ({
      credentialsJson: '{"claudeAiOauth":{"accessToken":"x"}}\n',
      oauthAccount: { emailAddress: 'max@example.com' },
      identity: { email: 'max@example.com', organizationUuid: null, organizationName: null }
    }))

    await expect(service.reauthenticateAccount(added.id)).rejects.toThrow(/already added/)
    const unchanged = getSettings().claudeManagedAccounts[1] as TestAccount & {
      tokenOnly?: boolean
    }
    expect(unchanged.email).toBe('Team Max')
    expect(unchanged.tokenOnly).toBe(true)
  })
})
