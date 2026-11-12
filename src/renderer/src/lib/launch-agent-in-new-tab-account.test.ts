import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueueTabInitialCwd = vi.fn()
const mockQueueTabStartupCommand = vi.fn()
const mockLaunchAgentInWebHostTab = vi.fn()
const mockIsWebRuntimeSessionActive = vi.fn()

const store = {
  settings: {
    agentCmdOverrides: {},
    agentDefaultArgs: {},
    agentDefaultEnv: {},
    activeRuntimeEnvironmentId: null as string | null
  },
  repos: [],
  allWorktrees: vi.fn(() => []),
  tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
  openFiles: [] as { id: string; worktreeId: string }[],
  browserTabsByWorktree: {} as Record<string, { id: string }[]>,
  tabBarOrderByWorktree: {} as Record<string, string[]>,
  createTab: vi.fn(() => ({ id: 'tab-1' })),
  queueTabInitialCwd: mockQueueTabInitialCwd,
  queueTabStartupCommand: mockQueueTabStartupCommand,
  setActiveTabType: vi.fn(),
  setActiveTabTypeForWorktree: vi.fn(),
  setTabBarOrder: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => store }
}))

vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdFromState: () => null
}))

vi.mock('@/lib/native-chat-transcript-readability', () => ({
  isNativeChatTranscriptLocalReadable: () => true
}))

vi.mock('@/runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: mockIsWebRuntimeSessionActive
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => 'web-runtime'
}))

vi.mock('@/lib/launch-agent-web-host-tab', () => ({
  launchAgentInWebHostTab: mockLaunchAgentInWebHostTab
}))

vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: (_stored: unknown, terminalIds: string[]) => terminalIds
}))

vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
  tuiAgentToAgentKind: (agent: string) => agent
}))

vi.mock('@/components/native-chat/native-chat-session-option-cache', () => ({
  seedNativeChatAppliedSessionOptions: vi.fn()
}))

// Why (ORCA-717): the + menu passes an account only when the person picked one by hand.
describe('launchAgentInNewTab account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsWebRuntimeSessionActive.mockReturnValue(false)
  })

  it.each([
    ['claude', { claudeAccountId: 'acct-claude' }],
    ['codex', { codexAccountId: 'acct-codex' }]
  ] as const)('queues a hand-picked %s account on the startup', async (agent, account) => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent, worktreeId: 'wt-1', ...account })

    expect(mockQueueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining(account)
    )
  })

  it('queues no account key when none was picked, so the launch resolves as before', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1' })

    const startup = mockQueueTabStartupCommand.mock.calls.at(-1)?.[1]
    expect(startup).toBeDefined()
    expect(startup).not.toHaveProperty('claudeAccountId')
    expect(startup).not.toHaveProperty('codexAccountId')
  })
})
