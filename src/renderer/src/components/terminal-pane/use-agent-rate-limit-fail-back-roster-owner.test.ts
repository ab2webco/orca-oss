// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const { fetchProviderAccountsSnapshotMock, evaluateFailBackReadinessMock, getStateMock } =
  vi.hoisted(() => ({
    fetchProviderAccountsSnapshotMock: vi.fn(),
    evaluateFailBackReadinessMock: vi.fn(),
    getStateMock: vi.fn()
  }))

vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  fetchProviderAccountsSnapshot: fetchProviderAccountsSnapshotMock
}))
vi.mock('@/lib/agent-rate-limit-fail-back', () => ({
  evaluateFailBackReadiness: evaluateFailBackReadinessMock,
  restoreFailoverOriginPin: vi.fn(),
  runRateLimitFailBack: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: getStateMock } }))

import { useAgentRateLimitFailBack } from './use-agent-rate-limit-fail-back'

const listLocal = vi.fn()

function stateWithWorktree(worktree: Record<string, unknown>): Record<string, unknown> {
  return {
    settings: { rateLimitFailBackMode: 'auto', activeRuntimeEnvironmentId: 'env-in-view' },
    rateLimits: null,
    getKnownWorktreeById: () => worktree,
    updateWorktreeMeta: vi.fn()
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  fetchProviderAccountsSnapshotMock.mockReset()
  evaluateFailBackReadinessMock.mockReset()
  getStateMock.mockReset()
  listLocal.mockReset()
  fetchProviderAccountsSnapshotMock.mockResolvedValue({ claude: { accounts: [] } })
  // Why not-ready: the roster read is the whole assertion, and stopping here
  // keeps the switch machinery out of a test about where candidates come from.
  evaluateFailBackReadinessMock.mockReturnValue({ ready: false, reason: 'origin-limited' })
  ;(window as unknown as { api: unknown }).api = { claudeAccounts: { list: listLocal } }
})

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('fail-back roster owner', () => {
  it('reads the candidates from the host that runs the worktree, not the scope in view', async () => {
    getStateMock.mockImplementation(() =>
      stateWithWorktree({
        claudeAccountId: 'acct-current',
        claudeFailoverOriginAccountId: 'acct-origin',
        claudeFailoverResetsAt: null,
        runtimeOwnerEnvironmentId: 'env-owner'
      })
    )

    renderHook(() =>
      useAgentRateLimitFailBack({ worktreeId: 'wt-owner-field', getLiveClaudePaneContext: () => null })
    )
    await flush()

    expect(fetchProviderAccountsSnapshotMock).toHaveBeenCalledWith({
      activeRuntimeEnvironmentId: 'env-owner'
    })
    expect(listLocal).not.toHaveBeenCalled()
  })

  it('falls back to the worktree execution host when the runtime projection is missing', async () => {
    getStateMock.mockImplementation(() =>
      stateWithWorktree({
        claudeAccountId: 'acct-current',
        claudeFailoverOriginAccountId: 'acct-origin',
        claudeFailoverResetsAt: null,
        hostId: 'runtime:env-from-host'
      })
    )

    renderHook(() =>
      useAgentRateLimitFailBack({ worktreeId: 'wt-host-id', getLiveClaudePaneContext: () => null })
    )
    await flush()

    expect(fetchProviderAccountsSnapshotMock).toHaveBeenCalledWith({
      activeRuntimeEnvironmentId: 'env-from-host'
    })
    expect(listLocal).not.toHaveBeenCalled()
  })

  it('keeps a local worktree on the local roster even while a remote server is in view', async () => {
    getStateMock.mockImplementation(() =>
      stateWithWorktree({
        claudeAccountId: 'acct-current',
        claudeFailoverOriginAccountId: 'acct-origin',
        claudeFailoverResetsAt: null,
        hostId: 'local'
      })
    )

    renderHook(() =>
      useAgentRateLimitFailBack({ worktreeId: 'wt-local', getLiveClaudePaneContext: () => null })
    )
    await flush()

    expect(fetchProviderAccountsSnapshotMock).toHaveBeenCalledWith({
      activeRuntimeEnvironmentId: null
    })
  })
})
