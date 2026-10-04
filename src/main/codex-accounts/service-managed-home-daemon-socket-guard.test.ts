import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexManagedAccount } from '../../shared/managed-account-types'
import {
  createManagedHome,
  createRateLimits,
  createRuntimeHome,
  createSettings,
  createStore,
  registerCodexAccountsTestHomes,
  testState
} from './service-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

const ACCOUNT_ID = '9dd962e2-449d-44c4-9733-0633f255064a'
const OVERRIDE_LINE = 'daemon_auto_start = false # orca: CODEX_HOME too long for the daemon socket'

function account(id: string, managedHomePath: string): CodexManagedAccount {
  return {
    id,
    email: 'user@example.com',
    managedHomePath,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

async function constructServiceFor(accounts: CodexManagedAccount[]): Promise<void> {
  const store = createStore(createSettings({ codexManagedAccounts: accounts }))
  const { CodexAccountService } = await import('./service')
  new CodexAccountService(store as never, createRateLimits() as never, createRuntimeHome() as never)
}

describe('CodexAccountService per-account daemon socket guard', () => {
  registerCodexAccountsTestHomes()

  const systemConfigPath = (): string => join(testState.fakeHomeDir, '.codex', 'config.toml')

  // Why: <userData>/codex-accounts/<uuid>/home exceeds sun_path on every host, like a real account home.
  it('guards a long account home when ~/.codex/config.toml is missing', async () => {
    const home = createManagedHome(testState.userDataDir, ACCOUNT_ID, 'model = "gpt-5"\n')

    await constructServiceFor([account(ACCOUNT_ID, home)])

    expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toBe(
      `model = "gpt-5"\n\n[features]\n${OVERRIDE_LINE}\n`
    )
    expect(existsSync(systemConfigPath())).toBe(false)
  })

  it('mirrors ~/.codex into a long account home with the guard and leaves ~/.codex clean', async () => {
    writeFileSync(systemConfigPath(), 'model = "gpt-5"\n')
    const home = createManagedHome(testState.userDataDir, ACCOUNT_ID)

    await constructServiceFor([account(ACCOUNT_ID, home)])

    expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toBe(
      `model = "gpt-5"\n\n[features]\n${OVERRIDE_LINE}\n`
    )
    expect(readFileSync(systemConfigPath(), 'utf-8')).toBe('model = "gpt-5"\n')
  })

  it('leaves a WSL home to launch prep instead of running its blocking ownership check', async () => {
    const store = createStore(createSettings())
    const { CodexAccountService } = await import('./service')
    const service = new CodexAccountService(
      store as never,
      createRateLimits() as never,
      createRuntimeHome() as never
    ) as unknown as {
      assertManagedHomePath(candidatePath: string, expectedAccountId?: string): string
      syncCanonicalConfigIntoManagedHome(
        managedHomePath: string,
        canonicalConfig: null,
        expectedAccountId: string
      ): void
    }
    const assertManagedHomePath = vi.spyOn(service, 'assertManagedHomePath')

    service.syncCanonicalConfigIntoManagedHome(
      '\\\\wsl.localhost\\Ubuntu\\home\\u\\.local\\share\\orca\\codex-accounts\\acct\\home',
      null,
      'acct'
    )

    expect(assertManagedHomePath).not.toHaveBeenCalled()
  })

  // Why: no writable Windows temp root is short enough for a home that fits the 108-byte limit.
  it.skipIf(process.platform === 'win32')(
    'removes a stale override once the account home fits',
    async () => {
      const longUserData = testState.userDataDir
      const shortUserData = mkdtempSync(join('/tmp', 'cx-'))
      testState.userDataDir = shortUserData
      process.env.ORCA_USER_DATA_PATH = shortUserData
      try {
        const home = createManagedHome(
          shortUserData,
          'a',
          `model = "m"\n\n[features]\n${OVERRIDE_LINE}\n`
        )

        await constructServiceFor([account('a', home)])

        expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toBe('model = "m"\n')
      } finally {
        testState.userDataDir = longUserData
        process.env.ORCA_USER_DATA_PATH = longUserData
        rmSync(shortUserData, { recursive: true, force: true })
      }
    }
  )
})
