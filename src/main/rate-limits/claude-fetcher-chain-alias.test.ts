import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchManagedAccountUsage } from './claude-fetcher'
import {
  primeClaudeFetcherMocks,
  restorePlatform,
  setPlatform
} from './claude-fetcher-test-harness'
import { fetchViaPty } from './claude-pty'
import {
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials,
  writeManagedClaudeKeychainCredentials
} from '../claude-accounts/keychain'
import { configureManagedClaudeRefreshAccounts } from '../claude-accounts/claude-managed-refresh-chain'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'

const { netFetchMock, readFileMock, resolveProxyMock, setProxyMock, appGetPathMock } = vi.hoisted(
  () => ({
    netFetchMock: vi.fn(),
    readFileMock: vi.fn(),
    resolveProxyMock: vi.fn(),
    setProxyMock: vi.fn(),
    appGetPathMock: vi.fn()
  })
)

const fakeHome = vi.hoisted(() => ({ dir: '' }))

// Why: the alias registry lives under the home directory; a fixture must never write there.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return { ...actual, homedir: () => fakeHome.dir }
})
vi.mock('node:fs/promises', () => ({ readFile: readFileMock }))
vi.mock('electron', () => ({
  app: { getPath: appGetPathMock },
  net: { fetch: netFetchMock },
  session: { defaultSession: { resolveProxy: resolveProxyMock, setProxy: setProxyMock } }
}))
vi.mock('./claude-pty', () => ({ fetchViaPty: vi.fn() }))
vi.mock('../claude-accounts/keychain', () => ({
  deleteActiveClaudeKeychainCredentialsStrict: vi.fn(async () => {}),
  readActiveClaudeKeychainCredentials: vi.fn(),
  readActiveClaudeKeychainCredentialsStrict: vi.fn(),
  readManagedClaudeKeychainCredentials: vi.fn(),
  writeActiveClaudeKeychainCredentials: vi.fn(async () => {}),
  writeManagedClaudeKeychainCredentials: vi.fn(async () => {})
}))

// Fixed expiry so equal chains compare equal across calls.
const EXPIRES_AT = Date.now() + 60 * 60_000
const credentials = (refreshToken: string): string =>
  JSON.stringify({
    claudeAiOauth: { accessToken: `${refreshToken}-access`, refreshToken, expiresAt: EXPIRES_AT }
  })

function ownedVault(root: string, id: string): ClaudeManagedAccount {
  const managedAuthPath = join(root, 'claude-accounts', id, 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${id}\n`, 'utf-8')
  return {
    id,
    email: `${id}@example.com`,
    managedAuthPath: realpathSync(managedAuthPath),
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

describe('usage panel supplement and refresh-chain ownership (ORCA-1039)', () => {
  let tempDir: string | null = null

  beforeEach(() => {
    primeClaudeFetcherMocks({
      netFetchMock,
      readFileMock,
      resolveProxyMock,
      setProxyMock,
      appGetPathMock
    })
  })

  afterEach(() => {
    restorePlatform()
    configureManagedClaudeRefreshAccounts(() => [])
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not persist a staged credential that carries another account chain', async () => {
    setPlatform('darwin')
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-alias-')))
    fakeHome.dir = join(tempDir, 'home')
    appGetPathMock.mockReturnValue(tempDir)
    const accountA = ownedVault(tempDir, 'account-a')
    const accountB = ownedVault(tempDir, 'account-b')
    configureManagedClaudeRefreshAccounts(() => [accountA, accountB])
    const managed = new Map([
      ['account-a', credentials('chain-a')],
      ['account-b', credentials('chain-b')]
    ])
    vi.mocked(readManagedClaudeKeychainCredentials).mockImplementation(
      async (id: string) => managed.get(id) ?? null
    )
    // Only after the preview CLI ran does A's staged item hold B's chain.
    let previewRan = false
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (configDir) =>
      previewRan && configDir === accountA.managedAuthPath ? credentials('chain-b') : null
    )
    vi.mocked(fetchViaPty).mockImplementationOnce(async () => {
      previewRan = true
      return {
        provider: 'claude',
        session: { usedPercent: 12, windowMinutes: 300, resetsAt: null, resetDescription: null },
        weekly: { usedPercent: 34, windowMinutes: 10080, resetsAt: null, resetDescription: null },
        updatedAt: 1,
        error: null,
        status: 'ok'
      }
    })

    await fetchManagedAccountUsage(
      { id: 'account-a', managedAuthPath: accountA.managedAuthPath },
      { allowUsagePanelSupplement: true }
    )

    expect(previewRan).toBe(true)
    expect(vi.mocked(writeManagedClaudeKeychainCredentials).mock.calls).not.toContainEqual([
      'account-a',
      credentials('chain-b')
    ])
  })
})
