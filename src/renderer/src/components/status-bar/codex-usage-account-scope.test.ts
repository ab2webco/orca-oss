import { describe, expect, it } from 'vitest'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import {
  createPendingCodexLimits,
  resolveCodexUsageAccountScope,
  type CodexUsageAccountScopeInput
} from './codex-usage-account-scope'

function limits(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'codex',
    session: {
      usedPercent: 42,
      windowMinutes: 300,
      resetsAt: null,
      resetDescription: null
    },
    weekly: null,
    updatedAt: 1_000,
    error: null,
    status: 'ok',
    ...overrides
  }
}

function inactiveUsage(
  accountId: string,
  overrides: Partial<InactiveAccountUsage> = {}
): InactiveAccountUsage {
  return {
    accountId,
    rateLimits: limits({ updatedAt: 500 }),
    updatedAt: 500,
    isFetching: false,
    ...overrides
  }
}

const ACCOUNTS = [
  { id: 'acct-active', email: 'active@example.com' },
  { id: 'acct-pinned', email: 'pinned@example.com' }
]

function input(overrides: Partial<CodexUsageAccountScopeInput> = {}): CodexUsageAccountScopeInput {
  return {
    showWorktreeAccountUsage: true,
    focusedWorktreeCodexAccountId: null,
    activeCodexAccountId: 'acct-active',
    accounts: ACCOUNTS,
    activeAccountLimits: limits(),
    inactiveAccountUsage: [],
    ...overrides
  }
}

describe('resolveCodexUsageAccountScope', () => {
  it('returns global scope when the focused worktree has no pin', () => {
    const activeLimits = limits()
    const scope = resolveCodexUsageAccountScope(input({ activeAccountLimits: activeLimits }))
    expect(scope).toEqual({ kind: 'global', limits: activeLimits })
  })

  it('returns global scope when the setting is disabled, even with a pin', () => {
    const activeLimits = limits()
    const scope = resolveCodexUsageAccountScope(
      input({
        showWorktreeAccountUsage: false,
        focusedWorktreeCodexAccountId: 'acct-pinned',
        activeAccountLimits: activeLimits,
        inactiveAccountUsage: [inactiveUsage('acct-pinned')]
      })
    )
    expect(scope).toEqual({ kind: 'global', limits: activeLimits })
  })

  it('defaults to worktree scope when the setting was never persisted (undefined)', () => {
    const scope = resolveCodexUsageAccountScope(
      input({
        showWorktreeAccountUsage: undefined,
        focusedWorktreeCodexAccountId: 'acct-pinned',
        inactiveAccountUsage: [inactiveUsage('acct-pinned')]
      })
    )
    expect(scope.kind).toBe('worktree')
  })

  it('resolves the pinned account usage and email from the inactive-usage cache', () => {
    const pinnedLimits = limits({ updatedAt: 500 })
    const scope = resolveCodexUsageAccountScope(
      input({
        focusedWorktreeCodexAccountId: 'acct-pinned',
        inactiveAccountUsage: [inactiveUsage('acct-pinned', { rateLimits: pinnedLimits })]
      })
    )
    expect(scope).toEqual({
      kind: 'worktree',
      accountId: 'acct-pinned',
      email: 'pinned@example.com',
      limits: pinnedLimits,
      isFetching: false
    })
  })

  it('uses the live active-account snapshot when the pin matches the active account', () => {
    const activeLimits = limits()
    const scope = resolveCodexUsageAccountScope(
      input({
        focusedWorktreeCodexAccountId: 'acct-active',
        activeAccountLimits: activeLimits,
        // Why: a stale cache entry for the active account must not shadow the live snapshot.
        inactiveAccountUsage: [
          inactiveUsage('acct-active', { rateLimits: limits({ updatedAt: 1 }) })
        ]
      })
    )
    expect(scope).toEqual({
      kind: 'worktree',
      accountId: 'acct-active',
      email: 'active@example.com',
      limits: activeLimits,
      isFetching: false
    })
  })

  it('reports null limits with fetch state when the pinned usage is not cached yet', () => {
    const scope = resolveCodexUsageAccountScope(
      input({
        focusedWorktreeCodexAccountId: 'acct-pinned',
        inactiveAccountUsage: [inactiveUsage('acct-pinned', { rateLimits: null, isFetching: true })]
      })
    )
    expect(scope).toEqual({
      kind: 'worktree',
      accountId: 'acct-pinned',
      email: 'pinned@example.com',
      limits: null,
      isFetching: true
    })
  })

  it('reports null limits and not fetching when no cache entry exists at all', () => {
    const scope = resolveCodexUsageAccountScope(
      input({ focusedWorktreeCodexAccountId: 'acct-pinned' })
    )
    expect(scope).toEqual({
      kind: 'worktree',
      accountId: 'acct-pinned',
      email: 'pinned@example.com',
      limits: null,
      isFetching: false
    })
  })

  it('falls back to global scope for a dangling pin (removed account)', () => {
    const activeLimits = limits()
    const scope = resolveCodexUsageAccountScope(
      input({
        focusedWorktreeCodexAccountId: 'acct-removed',
        activeAccountLimits: activeLimits
      })
    )
    expect(scope).toEqual({ kind: 'global', limits: activeLimits })
  })
})

describe('createPendingCodexLimits', () => {
  it('creates a fetching placeholder while the pinned usage loads', () => {
    expect(createPendingCodexLimits(true)).toEqual({
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: 0,
      error: null,
      status: 'fetching'
    })
  })

  it('creates an idle placeholder when no fetch is running', () => {
    expect(createPendingCodexLimits(false).status).toBe('idle')
  })
})
