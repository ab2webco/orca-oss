// Both functions here used to short-circuit for a remote host: an empty usage
// report and a thrown "only available on the local runtime". A server-hosted
// worktree can carry an account pin now, so both had to follow the active
// runtime — without changing what the desktop does, which is what these
// local-fallback cases pin down.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import {
  emptyClaudeAccountWorktreeUsageReport,
  type ClaudeAccountWorktreeUsageReport,
  type ClaudeWorktreeAccountReassignment
} from '../../../shared/claude-account-worktree-usage'
import {
  getClaudeAccountWorktreeUsage,
  reassignClaudeWorktreeAccounts
} from './runtime-claude-account-usage-client'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const LOCAL = { activeRuntimeEnvironmentId: null }
const REMOTE = { activeRuntimeEnvironmentId: 'env-1' }

function usageFixture(marker: string): ClaudeAccountWorktreeUsageReport {
  return {
    ...emptyClaudeAccountWorktreeUsageReport('acc-1', true),
    worktrees: [{ worktreeId: marker, displayName: marker, hasLiveTerminal: true }],
    liveTerminalCount: 2
  }
}

function accountsState(): ClaudeRateLimitAccountsState {
  return { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } }
}

const REASSIGN: ClaudeWorktreeAccountReassignment = {
  intent: 'reassign',
  fromAccountId: 'acc-1',
  toAccountId: 'acc-2',
  closeLiveTerminals: true
}

const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const worktreeUsageReportLocal = vi.fn()
const reassignWorktreesLocal = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  for (const mock of [
    runtimeEnvironmentCall,
    runtimeEnvironmentTransportCall,
    worktreeUsageReportLocal,
    reassignWorktreesLocal
  ]) {
    mock.mockReset()
  }
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    api: {
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall },
      claudeAccounts: {
        worktreeUsageReport: worktreeUsageReportLocal,
        reassignWorktrees: reassignWorktreesLocal
      }
    }
  })
})

describe('claude account worktree usage client', () => {
  it('reads the desktop services when no runtime environment is active', async () => {
    worktreeUsageReportLocal.mockResolvedValue(usageFixture('local'))
    reassignWorktreesLocal.mockResolvedValue(accountsState())

    const report = await getClaudeAccountWorktreeUsage(LOCAL, 'acc-1')
    await reassignClaudeWorktreeAccounts(LOCAL, REASSIGN)

    expect(report.worktrees[0]?.worktreeId).toBe('local')
    expect(worktreeUsageReportLocal).toHaveBeenCalledWith({ accountId: 'acc-1' })
    expect(reassignWorktreesLocal).toHaveBeenCalledWith(REASSIGN)
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('routes both calls through the active runtime accounts RPC when remote', async () => {
    runtimeEnvironmentCall.mockImplementation((args: { method: string }) => ({
      id: 'call',
      ok: true,
      result:
        args.method === 'accounts.claudeWorktreeUsage' ? usageFixture('server') : accountsState()
    }))

    const report = await getClaudeAccountWorktreeUsage(REMOTE, 'acc-1')
    await reassignClaudeWorktreeAccounts(REMOTE, REASSIGN)

    expect(report.worktrees[0]?.worktreeId).toBe('server')
    const calls = runtimeEnvironmentCall.mock.calls.map(
      (call) => call[0] as { method: string; selector: string; params: unknown }
    )
    expect(calls.map((call) => call.method)).toEqual([
      'accounts.claudeWorktreeUsage',
      'accounts.reassignClaudeWorktrees'
    ])
    expect(calls[0]).toMatchObject({ selector: 'env-1', params: { accountId: 'acc-1' } })
    // The whole reassignment travels intact: a dropped `intent` or `toAccountId`
    // would read as "reassign to the system default" and unpin every worktree.
    expect(calls[1]?.params).toEqual(REASSIGN)
    expect(worktreeUsageReportLocal).not.toHaveBeenCalled()
    expect(reassignWorktreesLocal).not.toHaveBeenCalled()
  })
})
