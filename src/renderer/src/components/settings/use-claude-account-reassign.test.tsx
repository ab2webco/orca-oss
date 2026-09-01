// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/types'
import type {
  ClaudeAccountWorktreeUsageReport,
  ClaudeWorktreeAccountReassignment
} from '../../../../shared/claude-account-worktree-usage'
import type { ClaudeReauthReopenOutcome } from '@/lib/claude-reauth-terminal-reopen'

const LIVE_WORKTREE = 'repo::live'
const PINNED_WORKTREE = 'repo::pinned'

const usageReport: ClaudeAccountWorktreeUsageReport = {
  accountId: 'account-a',
  worktrees: [
    { worktreeId: LIVE_WORKTREE, displayName: 'live', hasLiveTerminal: true },
    {
      worktreeId: PINNED_WORKTREE,
      displayName: 'pinned',
      hasLiveTerminal: false
    }
  ],
  liveTerminalCount: 1,
  pendingLaunchCount: 0,
  pendingGlobalLaunchCount: 0,
  blockedByOtherAccounts: [],
  supported: true
}

const events: string[] = []
const reassignRequests: ClaudeWorktreeAccountReassignment[] = []
const reopenCalls: readonly string[][] = []

const reassignClaudeWorktreeAccounts = vi.fn(
  async (_settings: unknown, request: ClaudeWorktreeAccountReassignment) => {
    events.push('reassign')
    reassignRequests.push(request)
    return {} as ClaudeRateLimitAccountsState
  }
)
const removeClaudeProviderAccount = vi.fn(async () => ({}) as ClaudeRateLimitAccountsState)
const toastWarning = vi.fn()
const reopenClaudeTerminalsAfterReauth = vi.fn(
  (worktreeIds: readonly string[]): ClaudeReauthReopenOutcome => {
    events.push('reopen')
    ;(reopenCalls as string[][]).push([...worktreeIds])
    return { reopenedWorktreeIds: [...worktreeIds], failedWorktreeIds: [] }
  }
)

vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  getClaudeAccountWorktreeUsage: async () => usageReport,
  reassignClaudeWorktreeAccounts: (settings: unknown, request: ClaudeWorktreeAccountReassignment) =>
    reassignClaudeWorktreeAccounts(settings, request),
  removeClaudeProviderAccount: () => removeClaudeProviderAccount()
}))
vi.mock('sonner', () => ({ toast: { warning: (message: string) => toastWarning(message) } }))
vi.mock('@/lib/claude-reauth-terminal-reopen', () => ({
  reopenClaudeTerminalsAfterReauth: (worktreeIds: readonly string[]) =>
    reopenClaudeTerminalsAfterReauth(worktreeIds)
}))

const { useClaudeAccountReassign } = await import('./use-claude-account-reassign')

function mountController(): {
  result: { current: ReturnType<typeof useClaudeAccountReassign> }
  settled: Promise<void>[]
} {
  const settled: Promise<void>[] = []
  const { result } = renderHook(() =>
    useClaudeAccountReassign({
      settings: { activeRuntimeEnvironmentId: null },
      runAction: (_action, operation) => {
        const run = operation().then(
          () => {},
          () => {
            events.push('action-failed')
          }
        )
        settled.push(run)
        return run
      }
    })
  )
  return { result, settled }
}

async function openAndAwaitReport(
  result: { current: ReturnType<typeof useClaudeAccountReassign> },
  target: Parameters<ReturnType<typeof useClaudeAccountReassign>['open']>[0]
): Promise<void> {
  act(() => result.current.open(target))
  await waitFor(() => expect(result.current.report).not.toBeNull())
}

describe('useClaudeAccountReassign', () => {
  beforeEach(() => {
    events.length = 0
    reassignRequests.length = 0
    ;(reopenCalls as string[][]).length = 0
    vi.clearAllMocks()
  })

  it('re-auths without moving a pin and reopens only the closed worktrees', async () => {
    const { result, settled } = mountController()
    const retry = vi.fn(async () => {
      events.push('retry')
      return {} as ClaudeRateLimitAccountsState
    })
    await openAndAwaitReport(result, {
      accountId: 'account-a',
      mode: 'reauth',
      runtime: {} as never,
      retry
    })

    act(() =>
      result.current.confirm({
        intent: 'keep-pins',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: []
      })
    )
    await Promise.all(settled)

    expect(reassignRequests).toEqual([
      {
        fromAccountId: 'account-a',
        intent: 'keep-pins',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: []
      }
    ])
    // Why the order matters: a terminal spawned before the re-auth resolves
    // takes a launch reservation and the close gate refuses the whole change.
    expect(events).toEqual(['reassign', 'retry', 'reopen'])
    expect(reopenCalls).toEqual([[LIVE_WORKTREE]])
  })

  it('reopens nothing when the re-authentication itself fails', async () => {
    const { result, settled } = mountController()
    await openAndAwaitReport(result, {
      accountId: 'account-a',
      mode: 'reauth',
      runtime: {} as never,
      retry: async () => {
        throw new Error('login cancelled')
      }
    })

    act(() =>
      result.current.confirm({
        intent: 'keep-pins',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: []
      })
    )
    await Promise.all(settled)

    expect(reopenClaudeTerminalsAfterReauth).not.toHaveBeenCalled()
    expect(events).toEqual(['reassign', 'action-failed'])
  })

  it('says which worktree stayed closed instead of failing the sign-in', async () => {
    reopenClaudeTerminalsAfterReauth.mockImplementationOnce(() => ({
      reopenedWorktreeIds: [],
      failedWorktreeIds: [LIVE_WORKTREE]
    }))
    const { result, settled } = mountController()
    await openAndAwaitReport(result, {
      accountId: 'account-a',
      mode: 'reauth',
      runtime: {} as never,
      retry: async () => ({}) as ClaudeRateLimitAccountsState
    })

    act(() =>
      result.current.confirm({
        intent: 'keep-pins',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: []
      })
    )
    await Promise.all(settled)

    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect(toastWarning.mock.calls[0]?.[0]).toContain(LIVE_WORKTREE)
    expect(events).not.toContain('action-failed')
  })

  it('still reassigns and reopens nothing for a non-reauth block', async () => {
    const { result, settled } = mountController()
    await openAndAwaitReport(result, {
      accountId: 'account-a',
      mode: 'unblock',
      runtime: {} as never,
      retry: async () => ({}) as ClaudeRateLimitAccountsState
    })

    act(() =>
      result.current.confirm({
        intent: 'reassign',
        toAccountId: 'account-b',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: []
      })
    )
    await Promise.all(settled)

    expect(reassignRequests).toEqual([
      {
        fromAccountId: 'account-a',
        intent: 'reassign',
        toAccountId: 'account-b',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: []
      }
    ])
    expect(reopenClaudeTerminalsAfterReauth).not.toHaveBeenCalled()
  })
})
