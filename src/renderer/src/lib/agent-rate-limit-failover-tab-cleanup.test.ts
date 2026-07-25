import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'

const { storeState } = vi.hoisted(() => ({
  storeState: {
    createTab: vi.fn(() => ({ id: 'tab-new' })),
    queueTabStartupCommand: vi.fn(),
    claimAutomaticAgentResume: vi.fn(),
    setActiveTabType: vi.fn(),
    closeTab: vi.fn(),
    updateWorktreeMeta: vi.fn(async () => undefined),
    getKnownWorktreeById: vi.fn(() => ({ path: '/repo' })),
    ptyIdsByTabId: {} as Record<string, string[]>,
    // resolveFailoverOriginResetsAt reads this to stamp the return-trip marker.
    rateLimits: { claude: null, inactiveClaudeAccounts: [] },
    settings: null
  }
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => storeState } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))
vi.mock('@/lib/tui-agent-startup', () => ({
  buildAgentResumeStartupPlan: () => ({
    launchCommand: 'claude --resume',
    expectedProcess: 'claude'
  }),
  buildAgentStartupPlan: () => ({ launchCommand: 'claude' })
}))
vi.mock('@/lib/agent-rate-limit-terminal-control', () => ({
  stopForegroundAgent: vi.fn(async () => true)
}))
vi.mock('@/lib/agent-launch-prompt-delivery', () => ({
  deliverLaunchPromptToAgentTab: vi.fn(async () => true)
}))
vi.mock('@/lib/sleeping-agent-session-launch', () => ({ appendTabToWorktreeOrder: vi.fn() }))

// The failover copies the transcript into the endpoint universe through the bridge.
vi.stubGlobal('window', {
  api: {
    claudeAccounts: {
      copySessionForFailover: vi.fn(async () => ({ ok: true }))
    }
  }
})

const PROVIDER_SESSION = {
  id: 'session-1',
  key: 'claude'
} as unknown as AgentProviderSessionMetadata

const FAILOVER_ACCOUNT = {
  id: 'endpoint-1',
  email: 'z.ai',
  authMethod: 'custom-endpoint'
} as unknown as ClaudeManagedAccountSummary

beforeEach(() => {
  vi.clearAllMocks()
  storeState.createTab.mockReturnValue({ id: 'tab-new' })
  storeState.getKnownWorktreeById.mockReturnValue({ path: '/repo' })
  // The limited agent's PTY lives in the tab that must be cleaned up.
  storeState.ptyIdsByTabId = { 'tab-limited': ['pty-limited'], 'tab-other': ['pty-other'] }
})

describe('failover tab cleanup', () => {
  it('closes the limited agent tab once its replacement exists', async () => {
    const { runRateLimitFailoverRelaunch } = await import('./agent-rate-limit-failover')

    await runRateLimitFailoverRelaunch({
      worktreeId: 'wt-1',
      ptyId: 'pty-limited',
      providerSession: PROVIDER_SESSION,
      failoverAccount: FAILOVER_ACCOUNT,
      sourceAccountId: 'account-a',
      settings: null
    })

    // Why: repeated switches otherwise stack up dead tabs, and closing them by
    // hand is what killed the fail-back watcher's live context.
    expect(storeState.closeTab).toHaveBeenCalledWith('tab-limited', { reason: 'cleanup' })
  })

  it('never closes the replacement tab', async () => {
    // A relaunch that reused the same pty id must not close what it just opened.
    storeState.ptyIdsByTabId = { 'tab-new': ['pty-limited'] }
    const { runRateLimitFailoverRelaunch } = await import('./agent-rate-limit-failover')

    await runRateLimitFailoverRelaunch({
      worktreeId: 'wt-1',
      ptyId: 'pty-limited',
      providerSession: PROVIDER_SESSION,
      failoverAccount: FAILOVER_ACCOUNT,
      sourceAccountId: 'account-a',
      settings: null
    })

    expect(storeState.closeTab).not.toHaveBeenCalled()
  })

  it('leaves other tabs alone', async () => {
    const { runRateLimitFailoverRelaunch } = await import('./agent-rate-limit-failover')

    await runRateLimitFailoverRelaunch({
      worktreeId: 'wt-1',
      ptyId: 'pty-limited',
      providerSession: PROVIDER_SESSION,
      failoverAccount: FAILOVER_ACCOUNT,
      sourceAccountId: 'account-a',
      settings: null
    })

    expect(storeState.closeTab).toHaveBeenCalledTimes(1)
    expect(storeState.closeTab).not.toHaveBeenCalledWith('tab-other', expect.anything())
  })

  it('still completes the failover when closing the old tab throws', async () => {
    storeState.closeTab.mockImplementation(() => {
      throw new Error('tab already gone')
    })
    const { runRateLimitFailoverRelaunch } = await import('./agent-rate-limit-failover')

    const result = await runRateLimitFailoverRelaunch({
      worktreeId: 'wt-1',
      ptyId: 'pty-limited',
      providerSession: PROVIDER_SESSION,
      failoverAccount: FAILOVER_ACCOUNT,
      sourceAccountId: 'account-a',
      settings: null
    })

    // Why: a stale tab is cosmetic; the switch itself must not fail over cleanup.
    expect(result.ok).toBe(true)
  })
})
