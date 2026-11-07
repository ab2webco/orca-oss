import {
  cleanupRuntimeAuthTestState,
  createClaudeAccount,
  createClaudeCredentialsJson,
  createClaudeCredentialsWithoutEmail,
  createElectronMock,
  createKeychainMock,
  createManagedClaudeAuth,
  createOauthRefreshMock,
  createSettings,
  createStore,
  readManagedCredentialsForTest,
  resetRuntimeAuthTestState,
  setPlatform,
  testState
} from './runtime-auth-service-test-harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron', () => createElectronMock())
vi.mock('./oauth-refresh', () => createOauthRefreshMock())
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return { ...actual, homedir: () => testState.fakeHomeDir }
})
vi.mock('./keychain', () => createKeychainMock())

// ORCA-1039: two accounts in one organization ended up holding one refresh chain.
describe('ClaudeRuntimeAuthService refresh-chain aliasing', () => {
  beforeEach(() => {
    resetRuntimeAuthTestState()
    setPlatform('win32')
  })

  afterEach(() => {
    cleanupRuntimeAuthTestState()
  })

  async function setUpTwoAccountsInOneOrganization() {
    const accountACredentials = createClaudeCredentialsJson('a@example.com', 'token-a', 'org-a')
    const accountBCredentials = createClaudeCredentialsJson('b@example.com', 'token-b', 'org-a')
    const pathA = createManagedClaudeAuth(testState.userDataDir, 'account-a', accountACredentials)
    const pathB = createManagedClaudeAuth(testState.userDataDir, 'account-b', accountBCredentials)
    const settings = createSettings({
      claudeManagedAccounts: [
        createClaudeAccount('account-a', pathA, {
          organizationUuid: 'org-a',
          email: 'a@example.com'
        }),
        createClaudeAccount('account-b', pathB, {
          organizationUuid: 'org-a',
          email: 'b@example.com'
        })
      ],
      activeClaudeManagedAccountId: 'account-a'
    })
    const store = createStore(settings)
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const liveGate = await import('./live-pty-gate')
    const service = new ClaudeRuntimeAuthService(store as never)
    await service.syncForCurrentSelection()
    return { service, settings, pathA, pathB, accountACredentials, accountBCredentials, liveGate }
  }

  it('does not adopt another same-organization account chain into the selected account', async () => {
    const { service, pathA, accountACredentials, liveGate } =
      await setUpTwoAccountsInOneOrganization()
    // No email, and B's CLI already rotated it, so nothing but the organization ties it to A.
    const runtimeBlobOnBChain = createClaudeCredentialsWithoutEmail('token-b-2', 'org-a', {
      refreshToken: 'token-b-refresh-rotated'
    })

    liveGate.markClaudePtySpawned('live-claude-pty')
    try {
      writeFileSync(
        join(testState.fakeHomeDir, '.claude', '.credentials.json'),
        runtimeBlobOnBChain,
        'utf-8'
      )
      await service.syncForCurrentSelection()
    } finally {
      liveGate.markClaudePtyExited('live-claude-pty')
    }

    expect(readManagedCredentialsForTest('account-a', pathA)).toBe(accountACredentials)
  })

  it('does not write another account chain into the outgoing account while switching', async () => {
    const { service, settings, pathA, accountACredentials, liveGate } =
      await setUpTwoAccountsInOneOrganization()
    const runtimeBlobOnBChain = createClaudeCredentialsWithoutEmail('token-b-2', 'org-a', {
      refreshToken: 'token-b-refresh'
    })

    liveGate.markClaudePtySpawned('live-claude-pty')
    try {
      writeFileSync(
        join(testState.fakeHomeDir, '.claude', '.credentials.json'),
        runtimeBlobOnBChain,
        'utf-8'
      )
      settings.activeClaudeManagedAccountId = 'account-b'
      await service.syncForCurrentSelection()
    } finally {
      liveGate.markClaudePtyExited('live-claude-pty')
    }

    expect(readManagedCredentialsForTest('account-a', pathA)).toBe(accountACredentials)
  })

  it('refuses a read-back labelled as the selected account that carries another account chain', async () => {
    const { service, pathA, pathB, accountACredentials, accountBCredentials } =
      await setUpTwoAccountsInOneOrganization()
    // A's email on B's current refresh token: the July duplicate shape, which identity cannot catch.
    const mislabelledBChain = createClaudeCredentialsJson('a@example.com', 'token-b', 'org-a')

    writeFileSync(
      join(testState.fakeHomeDir, '.claude', '.credentials.json'),
      mislabelledBChain,
      'utf-8'
    )
    await service.syncForCurrentSelection()

    expect(readManagedCredentialsForTest('account-a', pathA)).toBe(accountACredentials)
    expect(readManagedCredentialsForTest('account-b', pathB)).toBe(accountBCredentials)
  })
})
