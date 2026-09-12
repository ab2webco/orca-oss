/**
 * ORCA-482: a Codex account that lives on a remote server is re-authenticated by
 * importing a CODEX_HOME the server signed into, because the client has no shell
 * there. What separates this from `add` is that the row keeps its id and managed
 * home — so every worktree pinned to it survives — and that a sign-in returning a
 * different identity is refused instead of silently repointing those pins.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  createCodexAuthJson,
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

function existingAccount(): GlobalSettings['codexManagedAccounts'] {
  return [
    {
      id: 'account-1',
      email: 'owner@example.com',
      managedHomePath: createManagedHome(
        testState.userDataDir,
        'account-1',
        '',
        createCodexAuthJson('owner@example.com', 'provider-old', 'refresh-old')
      ),
      providerAccountId: 'provider-old',
      workspaceLabel: null,
      workspaceAccountId: 'provider-old',
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
  ]
}

async function createService(settings: GlobalSettings) {
  const store = createStore(settings)
  const { CodexAccountService } = await import('./service')
  return {
    store,
    service: new CodexAccountService(
      store as never,
      createRateLimits() as never,
      createRuntimeHome() as never
    )
  }
}

function createSourceHome(email: string, provider: string): string {
  const sourceHome = mkdtempSync(join(tmpdir(), 'orca-codex-reauth-source-'))
  writeFileSync(
    join(sourceHome, 'auth.json'),
    createCodexAuthJson(email, provider, `refresh-${provider}`),
    'utf-8'
  )
  return sourceHome
}

describe('CodexAccountService.reauthenticateAccountFromHome', () => {
  registerCodexAccountsTestHomes()

  it('refreshes the account in place instead of adding a second row for the same email', async () => {
    vi.doMock('../codex-cli/command', () => ({ resolveCodexCommand: () => 'codex' }))
    const sourceHome = createSourceHome('owner@example.com', 'provider-new')
    try {
      const accounts = existingAccount()
      const managedHomePath = accounts[0].managedHomePath
      const { store, service } = await createService(
        createSettings({ codexManagedAccounts: accounts })
      )

      const result = await service.reauthenticateAccountFromHome('account-1', sourceHome)

      expect(result.accounts).toHaveLength(1)
      expect(result.accounts[0]).toMatchObject({
        id: 'account-1',
        email: 'owner@example.com',
        providerAccountId: 'provider-new'
      })
      expect(store.getSettings().codexManagedAccounts[0].managedHomePath).toBe(managedHomePath)
      // The vault the worktree pins point at received the new credentials.
      expect(readFileSync(join(managedHomePath, 'auth.json'), 'utf-8')).toContain(
        'refresh-provider-new'
      )
      expect(store.getSettings().codexManagedAccounts).toHaveLength(1)
    } finally {
      rmSync(sourceHome, { recursive: true, force: true })
      vi.doUnmock('../codex-cli/command')
    }
  })

  it('refuses a sign-in that returns a different identity and restores the previous credentials', async () => {
    vi.doMock('../codex-cli/command', () => ({ resolveCodexCommand: () => 'codex' }))
    const sourceHome = createSourceHome('someone-else@example.com', 'provider-other')
    try {
      const accounts = existingAccount()
      const managedHomePath = accounts[0].managedHomePath
      const { store, service } = await createService(
        createSettings({ codexManagedAccounts: accounts })
      )

      await expect(service.reauthenticateAccountFromHome('account-1', sourceHome)).rejects.toThrow(
        /someone-else@example\.com/
      )

      expect(readFileSync(join(managedHomePath, 'auth.json'), 'utf-8')).toContain('refresh-old')
      expect(store.getSettings().codexManagedAccounts[0]).toMatchObject({
        email: 'owner@example.com',
        providerAccountId: 'provider-old'
      })
    } finally {
      rmSync(sourceHome, { recursive: true, force: true })
      vi.doUnmock('../codex-cli/command')
    }
  })
})
