import { describe, expect, it } from 'vitest'
import type { CodexManagedAccount } from '../../shared/types'
import {
  assertValidCodexAccountPin,
  isManagedCodexAccountId,
  resolveWorktreeCodexAccountPin,
  WORKTREE_CODEX_ACCOUNT_UNAVAILABLE_MESSAGE
} from './worktree-account-pin'

function makeAccount(overrides: Partial<CodexManagedAccount> = {}): CodexManagedAccount {
  return {
    id: 'account-a',
    email: 'a@example.com',
    managedHomePath: '/Users/test/Library/Application Support/orca/codex-accounts/account-a/home',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function makeWslAccount(overrides: Partial<CodexManagedAccount> = {}): CodexManagedAccount {
  return makeAccount({
    id: 'account-wsl',
    email: 'wsl@example.com',
    managedHomePath:
      '\\\\wsl$\\Ubuntu\\home\\test\\.local\\share\\orca\\codex-accounts\\account-wsl\\home',
    managedHomeRuntime: 'wsl',
    wslDistro: 'Ubuntu',
    wslLinuxHomePath: '/home/test/.local/share/orca/codex-accounts/account-wsl/home',
    ...overrides
  })
}

describe('resolveWorktreeCodexAccountPin', () => {
  it('returns unpinned when the worktree has no pin', () => {
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: undefined,
        accounts: [makeAccount()],
        target: { runtime: 'host' }
      })
    ).toEqual({ status: 'unpinned' })
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: null,
        accounts: [makeAccount()],
        target: { runtime: 'host' }
      })
    ).toEqual({ status: 'unpinned' })
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: '',
        accounts: [makeAccount()],
        target: { runtime: 'host' }
      })
    ).toEqual({ status: 'unpinned' })
  })

  it('resolves a host pin for a host launch to the managed home path', () => {
    const account = makeAccount()
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [makeWslAccount(), account],
        target: { runtime: 'host' }
      })
    ).toEqual({ status: 'pinned', account, codexHomePath: account.managedHomePath })
  })

  it('treats an undefined target runtime as host', () => {
    const account = makeAccount()
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [account],
        target: undefined
      })
    ).toEqual({ status: 'pinned', account, codexHomePath: account.managedHomePath })
  })

  it('resolves a WSL pin for a matching-distro WSL launch', () => {
    const account = makeWslAccount()
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [makeAccount(), account],
        target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      })
    ).toEqual({ status: 'pinned', account, codexHomePath: account.managedHomePath })
  })

  it('fails closed on a dangling pin', () => {
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: 'removed-account',
        accounts: [makeAccount()],
        target: { runtime: 'host' }
      })
    ).toEqual({ status: 'unavailable' })
  })

  it('fails closed when a host launch is pinned to a WSL account', () => {
    const account = makeWslAccount()
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [account],
        target: { runtime: 'host' }
      })
    ).toEqual({ status: 'unavailable' })
  })

  it('fails closed when a WSL launch is pinned to a host account', () => {
    const account = makeAccount()
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [account],
        target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      })
    ).toEqual({ status: 'unavailable' })
  })

  it('fails closed when the pinned WSL account belongs to another distro', () => {
    const account = makeWslAccount({ wslDistro: 'Debian' })
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [account],
        target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      })
    ).toEqual({ status: 'unavailable' })
  })

  it('fails closed when a distro-less WSL launch cannot be resolved to the account distro', () => {
    // Why: callers resolve the concrete default distro before pin resolution;
    // when that fails, an unresolved default must not match a concrete pin.
    const account = makeWslAccount()
    expect(
      resolveWorktreeCodexAccountPin({
        pinnedAccountId: account.id,
        accounts: [account],
        target: { runtime: 'wsl', wslDistro: null }
      })
    ).toEqual({ status: 'unavailable' })
  })

  it('exposes the fail-closed launch message', () => {
    expect(WORKTREE_CODEX_ACCOUNT_UNAVAILABLE_MESSAGE).toBe(
      'The Codex account assigned to this worktree is unavailable for this runtime. Reassign the account before launching Codex.'
    )
  })
})

describe('assertValidCodexAccountPin', () => {
  const store = {
    getSettings: () => ({ codexManagedAccounts: [makeAccount()] })
  }

  it('accepts null, undefined, and managed account ids', () => {
    expect(() => assertValidCodexAccountPin(store, undefined)).not.toThrow()
    expect(() => assertValidCodexAccountPin(store, null)).not.toThrow()
    expect(() => assertValidCodexAccountPin(store, 'account-a')).not.toThrow()
  })

  it('rejects ids that are not managed accounts', () => {
    expect(() => assertValidCodexAccountPin(store, 'ghost')).toThrow(
      'That Codex account no longer exists.'
    )
  })

  it('reports managed account membership', () => {
    expect(isManagedCodexAccountId(store, 'account-a')).toBe(true)
    expect(isManagedCodexAccountId(store, 'ghost')).toBe(false)
  })
})
