import type * as ReactModule from 'react'
import { vi, type Mock } from 'vitest'

/** Same type `vi.fn()` infers, spelled out so declaration emit can name it. */
type HarnessMock = Mock

export const mockLaunchAgentBackgroundSession: HarnessMock = vi.fn()
export const mockLaunchWorktreeBackgroundTerminals: HarnessMock = vi.fn()
export const mockFindReusableAutomationSession: HarnessMock = vi.fn()
export const mockObserveExistingAutomationSession: HarnessMock = vi.fn()
export const mockSubmitPromptToAgentPty: HarnessMock = vi.fn()
export const mockCreateWorktree: HarnessMock = vi.fn()
export const mockMarkDispatchResult: HarnessMock = vi.fn()
export const mockOnDispatchRequested: HarnessMock = vi.fn()
export const mockRendererReady: HarnessMock = vi.fn()
export const mockFinalizeTerminalOwnership: HarnessMock = vi.fn()
export const mockReleaseTerminalOwnership: HarnessMock = vi.fn()
export const mockSshNeedsPassphrasePrompt: HarnessMock = vi.fn()
export const mockSshGetState: HarnessMock = vi.fn()
export const mockSshConnect: HarnessMock = vi.fn()
export let latestStoreSubscriber: (() => void) | null = null
export const mockStoreSubscribe = vi.fn((listener: () => void) => {
  latestStoreSubscriber = listener
  return () => {}
})

export const setupLaunch = {
  runnerScriptPath: '/tmp/setup.sh',
  envVars: { ORCA_WORKTREE_PATH: '/repo/worktree' }
}

export const createdWorktree = {
  id: 'wt-created',
  repoId: 'repo-1',
  displayName: 'Automation worktree',
  path: '/repo/worktree'
}
type TestWorktree = typeof createdWorktree
type TestRepo = {
  id: string
  connectionId: string | null
  executionHostId: string | null
  path: string
}

export const state = {
  activeView: 'terminal' as const,
  activeWorktreeId: 'wt-active',
  activeTabId: 'tab-active',
  activeTabType: 'terminal' as const,
  repos: [{ id: 'repo-1', connectionId: null, executionHostId: null, path: '/repo' }] as TestRepo[],
  folderWorkspaces: [] as {
    id: string
    projectGroupId: string
    folderPath: string
    connectionId: string | null
  }[],
  projectGroups: [] as {
    id: string
    connectionId: string | null
    executionHostId?: string | null
  }[],
  worktreesByRepo: {} as Record<string, TestWorktree[]>,
  detectedWorktreesByRepo: {},
  agentStatusByPaneKey: {},
  allWorktrees: vi.fn<() => TestWorktree[]>(() => []),
  getKnownWorktreeById: vi.fn<(worktreeId: string) => TestWorktree | undefined>(() => undefined),
  createWorktree: mockCreateWorktree,
  subscribe: vi.fn<() => () => void>(() => () => {}),
  setActiveView: vi.fn<(value: unknown) => void>(),
  setActiveWorktree: vi.fn<(value: unknown) => void>(),
  setActiveTab: vi.fn<(value: unknown) => void>(),
  setActiveTabType: vi.fn<(value: unknown) => void>()
}

export function makeAutomation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'automation-1',
    projectId: 'repo-1',
    prompt: 'run this',
    precheck: null,
    agentId: 'claude',
    workspaceMode: 'new_per_run',
    workspaceId: null,
    baseBranch: null,
    setupDecision: 'run',
    reuseSession: false,
    ...overrides
  }
}

export function makeRun() {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    title: 'Nightly setup run',
    scheduledFor: Date.parse('2026-06-24T03:00:00Z'),
    trigger: 'scheduled',
    workspaceId: null,
    workspaceDisplayName: null
  }
}

export async function registerAndDispatch(automation = makeAutomation()): Promise<void> {
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof ReactModule>('react')
    return {
      ...actual,
      useEffect: (effect: () => void | (() => void)) => {
        effect()
      }
    }
  })
  const { useAutomationDispatchEvents: registerAutomationDispatchEvents } =
    await import('./useAutomationDispatchEvents')
  registerAutomationDispatchEvents()
  const handler = mockOnDispatchRequested.mock.calls[0]?.[0]
  if (!handler) {
    throw new Error('dispatch handler was not registered')
  }
  await handler({
    automation,
    run: makeRun(),
    dispatchToken: 'dispatch-token'
  })
}

vi.mock('@/lib/launch-agent-background-session', () => ({
  launchAgentBackgroundSession: mockLaunchAgentBackgroundSession
}))

vi.mock('@/lib/launch-worktree-background-terminals', () => ({
  launchWorktreeBackgroundTerminals: mockLaunchWorktreeBackgroundTerminals
}))

vi.mock('@/lib/agent-paste-draft', () => ({
  submitPromptToAgentPty: mockSubmitPromptToAgentPty
}))

vi.mock('@/lib/automation-session-reuse', () => ({
  findReusableAutomationSession: mockFindReusableAutomationSession
}))

vi.mock('@/lib/automation-session-observer', () => ({
  observeExistingAutomationSession: mockObserveExistingAutomationSession
}))

vi.mock('@/components/automations/automation-run-output-snapshot', () => ({
  createAutomationRunOutputSnapshotBuffer: () => ({
    append: vi.fn(),
    snapshot: () => null
  }),
  selectAutomationRunOutputSnapshot: (
    assistantMessage: string | null | undefined,
    terminalSnapshot: unknown
  ) =>
    assistantMessage
      ? {
          format: 'plain_text',
          content: assistantMessage,
          capturedAt: 1,
          truncated: false
        }
      : terminalSnapshot
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => 'create-request-id'
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => state,
    subscribe: mockStoreSubscribe
  }
}))
/** Fresh module graph, cleared mocks and a stubbed `window.api` for each dispatch test. */
export function resetAutomationDispatchHarness(): void {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  state.activeView = 'terminal'
  state.activeWorktreeId = 'wt-active'
  state.activeTabId = 'tab-active'
  state.activeTabType = 'terminal'
  state.repos = [{ id: 'repo-1', connectionId: null, executionHostId: null, path: '/repo' }]
  state.folderWorkspaces = []
  state.projectGroups = []
  state.worktreesByRepo = {}
  state.agentStatusByPaneKey = {}
  latestStoreSubscriber = null
  state.allWorktrees.mockReturnValue([])
  state.getKnownWorktreeById.mockReturnValue(undefined)
  mockCreateWorktree.mockResolvedValue({ worktree: createdWorktree, setup: setupLaunch })
  mockLaunchWorktreeBackgroundTerminals.mockResolvedValue(undefined)
  mockLaunchAgentBackgroundSession.mockResolvedValue({
    tabId: 'agent-tab',
    paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
    ptyId: 'agent-pty',
    startupPlan: {},
    terminalOwnership: {
      finalize: mockFinalizeTerminalOwnership,
      release: mockReleaseTerminalOwnership
    }
  })
  mockOnDispatchRequested.mockReturnValue(() => {})
  mockSshNeedsPassphrasePrompt.mockResolvedValue(false)
  mockSshGetState.mockResolvedValue({ status: 'connected' })
  mockSshConnect.mockResolvedValue({ status: 'connected' })
  mockSubmitPromptToAgentPty.mockResolvedValue(true)
  vi.stubGlobal('window', {
    api: {
      automations: {
        onDispatchRequested: mockOnDispatchRequested,
        rendererReady: mockRendererReady,
        markDispatchResult: mockMarkDispatchResult,
        runPrecheck: vi.fn(),
        listRuns: vi.fn().mockResolvedValue([])
      },
      ssh: {
        needsPassphrasePrompt: mockSshNeedsPassphrasePrompt,
        getState: mockSshGetState,
        connect: mockSshConnect
      }
    },
    dispatchEvent: vi.fn()
  })
}
