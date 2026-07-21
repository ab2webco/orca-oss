import { describe, expect, it } from 'vitest'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import {
  createPendingClaudeLimits,
  resolveClaudeUsageAccountScope,
  type ClaudeUsageAccountScopeInput
} from './claude-usage-account-scope'

function limits(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
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

function input(
  overrides: Partial<ClaudeUsageAccountScopeInput> = {}
): ClaudeUsageAccountScopeInput {
  return {
    showWorktreeAccountUsage: true,
    focusedWorktreeClaudeAccountId: null,
    activeClaudeAccountId: 'acct-active',
    accounts: ACCOUNTS,
    activeAccountLimits: limits(),
    inactiveAccountUsage: [],
    ...overrides
  }
}

describe('resolveClaudeUsageAccountScope', () => {
  it('returns global scope when the focused worktree has no pin', () => {
    const activeLimits = limits()
    const scope = resolveClaudeUsageAccountScope(input({ activeAccountLimits: activeLimits }))
    expect(scope).toEqual({ kind: 'global', limits: activeLimits })
  })

  it('returns global scope when the setting is disabled, even with a pin', () => {
    const activeLimits = limits()
    const scope = resolveClaudeUsageAccountScope(
      input({
        showWorktreeAccountUsage: false,
        focusedWorktreeClaudeAccountId: 'acct-pinned',
        activeAccountLimits: activeLimits,
        inactiveAccountUsage: [inactiveUsage('acct-pinned')]
      })
    )
    expect(scope).toEqual({ kind: 'global', limits: activeLimits })
  })

  it('defaults to worktree scope when the setting was never persisted (undefined)', () => {
    const scope = resolveClaudeUsageAccountScope(
      input({
        showWorktreeAccountUsage: undefined,
        focusedWorktreeClaudeAccountId: 'acct-pinned',
        inactiveAccountUsage: [inactiveUsage('acct-pinned')]
      })
    )
    expect(scope.kind).toBe('worktree')
  })

  it('resolves the pinned account usage and email from the inactive-usage cache', () => {
    const pinnedLimits = limits({ updatedAt: 500 })
    const scope = resolveClaudeUsageAccountScope(
      input({
        focusedWorktreeClaudeAccountId: 'acct-pinned',
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
    const scope = resolveClaudeUsageAccountScope(
      input({
        focusedWorktreeClaudeAccountId: 'acct-active',
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
    const scope = resolveClaudeUsageAccountScope(
      input({
        focusedWorktreeClaudeAccountId: 'acct-pinned',
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
    const scope = resolveClaudeUsageAccountScope(
      input({ focusedWorktreeClaudeAccountId: 'acct-pinned' })
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
    const scope = resolveClaudeUsageAccountScope(
      input({
        focusedWorktreeClaudeAccountId: 'acct-removed',
        activeAccountLimits: activeLimits
      })
    )
    expect(scope).toEqual({ kind: 'global', limits: activeLimits })
  })
})

describe('createPendingClaudeLimits', () => {
  it('creates a fetching placeholder while the pinned usage loads', () => {
    expect(createPendingClaudeLimits(true)).toEqual({
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: 0,
      error: null,
      status: 'fetching'
    })
  })

  it('creates an idle placeholder when no fetch is running', () => {
    expect(createPendingClaudeLimits(false).status).toBe('idle')
  })
})
