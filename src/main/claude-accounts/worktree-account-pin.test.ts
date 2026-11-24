import { describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import {
  assertClaudeAccountPinMatchesRepoRuntime,
  assertValidClaudeAccountPin,
  normalizeClaudeAccountPinForCreate
} from './worktree-account-pin'

function makeStore(accountIds: readonly string[]): Store {
  return {
    getSettings: vi.fn(() => ({
      claudeManagedAccounts: accountIds.map((id) => ({ id }))
    }))
  } as unknown as Store
}

describe('worktree Claude account pins', () => {
  it('drops a captured create pin after its account is removed', () => {
    expect(normalizeClaudeAccountPinForCreate(makeStore([]), 'removed')).toBeNull()
  })

  it('preserves current and inherit-global create choices', () => {
    const store = makeStore(['account-a'])
    expect(normalizeClaudeAccountPinForCreate(store, 'account-a')).toBe('account-a')
    expect(normalizeClaudeAccountPinForCreate(store, null)).toBeNull()
    expect(normalizeClaudeAccountPinForCreate(store, undefined)).toBeUndefined()
  })

  it('rejects renderer updates that reference a removed account', () => {
    expect(() => assertValidClaudeAccountPin(makeStore([]), 'removed')).toThrow('no longer exists')
  })
})

function makeRuntimeStore(
  accounts: readonly {
    id: string
    managedAuthRuntime?: 'host' | 'wsl'
    wslDistro?: string | null
    managedAuthPath?: string
  }[]
): Store {
  return {
    getSettings: vi.fn(() => ({
      claudeManagedAccounts: accounts.map((account) => ({
        email: `${account.id} label`,
        managedAuthPath: '/orca/claude-accounts/auth',
        ...account
      }))
    }))
  } as unknown as Store
}

const accountsOf = (store: Store) => store.getSettings().claudeManagedAccounts

const WSL_REPO = { path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\repo' }
const HOST_REPO = { path: 'C:\\code\\repo' }

describe('worktree Claude account pin runtime', () => {
  it('refuses a host account for a WSL repo, naming both runtimes and the fix', () => {
    const store = makeRuntimeStore([{ id: 'glm', managedAuthRuntime: 'host' }])
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'glm', WSL_REPO)
    ).toThrow(
      'The Claude account glm label lives on the host, so it cannot launch Claude in WSL Ubuntu-24.04. Pick an account added for WSL Ubuntu-24.04, or add one in Settings → Accounts with Account location set to WSL.'
    )
  })

  it('refuses a WSL account for a host repo and a WSL account of another distro', () => {
    const store = makeRuntimeStore([
      { id: 'debian', managedAuthRuntime: 'wsl', wslDistro: 'Debian' }
    ])
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'debian', HOST_REPO)
    ).toThrow('lives on WSL Debian, so it cannot launch Claude in the host')
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'debian', WSL_REPO)
    ).toThrow('lives on WSL Debian, so it cannot launch Claude in WSL Ubuntu-24.04')
  })

  it('accepts matching runtimes, a default-distro account, SSH repos and no pin', () => {
    const store = makeRuntimeStore([
      { id: 'host', managedAuthRuntime: 'host' },
      { id: 'ubuntu', managedAuthRuntime: 'wsl', wslDistro: 'ubuntu-24.04' },
      { id: 'default', managedAuthRuntime: 'wsl', wslDistro: null }
    ])
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'host', HOST_REPO)
    ).not.toThrow()
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'ubuntu', WSL_REPO)
    ).not.toThrow()
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'default', WSL_REPO)
    ).not.toThrow()
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'host', {
        ...WSL_REPO,
        connectionId: 'ssh-1'
      })
    ).not.toThrow()
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), null, WSL_REPO)
    ).not.toThrow()
  })

  it('reads a legacy WSL account distro from its UNC auth path', () => {
    const store = makeRuntimeStore([
      {
        id: 'legacy',
        managedAuthRuntime: 'wsl',
        wslDistro: null,
        managedAuthPath: '\\\\wsl.localhost\\Debian\\home\\dev\\.local\\share\\orca\\auth'
      }
    ])
    expect(() =>
      assertClaudeAccountPinMatchesRepoRuntime(accountsOf(store), 'legacy', WSL_REPO)
    ).toThrow('lives on WSL Debian')
  })
})
