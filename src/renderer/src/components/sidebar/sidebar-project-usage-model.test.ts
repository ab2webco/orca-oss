import { describe, expect, it } from 'vitest'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import {
  buildSidebarProjectUsage,
  resolveProjectPinnedAccountId,
  type SidebarProjectUsageInput
} from './sidebar-project-usage-model'

function limits(provider: 'claude' | 'codex', usedPercent = 42): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1_000,
    error: null,
    status: 'ok'
  }
}

function inactive(
  accountId: string,
  over: Partial<InactiveAccountUsage> = {}
): InactiveAccountUsage {
  return {
    accountId,
    rateLimits: limits('claude', 77),
    updatedAt: 500,
    isFetching: false,
    ...over
  }
}

function input(over: Partial<SidebarProjectUsageInput> = {}): SidebarProjectUsageInput {
  return {
    claudePinnedAccountIds: [],
    codexPinnedAccountIds: [],
    showWorktreeAccountUsage: true,
    claudeAccounts: [
      { id: 'c-active', email: 'active@example.com' },
      { id: 'c-pinned', email: 'pinned@example.com' }
    ],
    codexAccounts: [
      { id: 'x-active', email: 'codex-active@example.com' },
      { id: 'x-pinned', email: 'codex-pinned@example.com' }
    ],
    activeClaudeAccountId: 'c-active',
    activeCodexAccountId: 'x-active',
    claudeLimits: limits('claude', 10),
    codexLimits: limits('codex', 6),
    inactiveClaudeUsage: [],
    inactiveCodexUsage: [],
    ...over
  }
}

describe('resolveProjectPinnedAccountId', () => {
  it('returns the shared pin when every worktree that pins one agrees', () => {
    expect(resolveProjectPinnedAccountId(['a', 'a', null, undefined])).toBe('a')
  })

  it('returns null for mixed pins — one number cannot represent two accounts', () => {
    expect(resolveProjectPinnedAccountId(['a', 'b'])).toBeNull()
  })

  it('returns null when nothing is pinned', () => {
    expect(resolveProjectPinnedAccountId([null, undefined, ''])).toBeNull()
  })
})

describe('buildSidebarProjectUsage', () => {
  it('shows the global account usage for both providers when nothing is pinned', () => {
    const entries = buildSidebarProjectUsage(input())
    expect(entries).toEqual([
      { provider: 'claude', accountLabel: null, limits: limits('claude', 10), isFetching: false },
      { provider: 'codex', accountLabel: null, limits: limits('codex', 6), isFetching: false }
    ])
  })

  it('shows the pinned account usage and label when the project pins one', () => {
    const pinnedUsage = limits('claude', 77)
    const entries = buildSidebarProjectUsage(
      input({
        claudePinnedAccountIds: ['c-pinned', 'c-pinned'],
        inactiveClaudeUsage: [inactive('c-pinned', { rateLimits: pinnedUsage })]
      })
    )
    expect(entries[0]).toEqual({
      provider: 'claude',
      accountLabel: 'pinned@example.com',
      limits: pinnedUsage,
      isFetching: false
    })
  })

  it('reports the pinned account as pending when its usage is not cached yet', () => {
    const entries = buildSidebarProjectUsage(
      input({
        claudePinnedAccountIds: ['c-pinned'],
        inactiveClaudeUsage: [inactive('c-pinned', { rateLimits: null, isFetching: true })]
      })
    )
    expect(entries[0]).toMatchObject({
      provider: 'claude',
      accountLabel: 'pinned@example.com',
      limits: null,
      isFetching: true
    })
  })

  it('falls back to the global account when worktrees pin different accounts', () => {
    const entries = buildSidebarProjectUsage(
      input({ claudePinnedAccountIds: ['c-pinned', 'c-active'] })
    )
    expect(entries[0]).toMatchObject({ accountLabel: null, limits: limits('claude', 10) })
  })

  it('omits a provider that has no usage data at all', () => {
    const entries = buildSidebarProjectUsage(input({ claudeLimits: null, codexLimits: null }))
    expect(entries).toEqual([])
  })

  it('scopes Codex independently of Claude', () => {
    const codexPinned = limits('codex', 55)
    const entries = buildSidebarProjectUsage(
      input({
        codexPinnedAccountIds: ['x-pinned'],
        inactiveCodexUsage: [inactive('x-pinned', { rateLimits: codexPinned })]
      })
    )
    expect(entries.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
      accountLabel: 'codex-pinned@example.com',
      limits: codexPinned,
      isFetching: false
    })
  })
})
