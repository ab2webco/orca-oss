import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createdWorktree,
  latestStoreSubscriber,
  makeAutomation,
  mockCreateWorktree,
  mockFindReusableAutomationSession,
  mockFinalizeTerminalOwnership,
  mockLaunchAgentBackgroundSession,
  mockLaunchWorktreeBackgroundTerminals,
  mockMarkDispatchResult,
  mockObserveExistingAutomationSession,
  mockReleaseTerminalOwnership,
  mockSshConnect,
  mockSshGetState,
  mockSshNeedsPassphrasePrompt,
  registerAndDispatch,
  resetAutomationDispatchHarness,
  setupLaunch,
  state
} from './useAutomationDispatchEvents-test-harness'

describe('useAutomationDispatchEvents setup launch', () => {
  beforeEach(resetAutomationDispatchHarness)

  it('starts setup terminal launch without waiting before launching the automation agent', async () => {
    const order: string[] = []
    let finishSetupLaunch: (() => void) | null = null
    mockLaunchWorktreeBackgroundTerminals.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSetupLaunch = () => {
            order.push('setup')
            resolve()
          }
        })
    )
    mockLaunchAgentBackgroundSession.mockImplementation(async () => {
      order.push('agent')
      return { tabId: 'agent-tab', ptyId: 'agent-pty', startupPlan: {} }
    })

    await registerAndDispatch()

    expect(mockCreateWorktree).toHaveBeenCalled()
    expect(mockCreateWorktree.mock.calls[0][3]).toBe('run')
    expect(mockLaunchWorktreeBackgroundTerminals).toHaveBeenCalledWith({
      worktreeId: 'wt-created',
      setup: setupLaunch,
      defaultTabs: undefined
    })
    expect(state.setActiveView).not.toHaveBeenCalled()
    expect(state.setActiveWorktree).not.toHaveBeenCalled()
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-created',
        prompt: 'run this'
      })
    )
    expect(order).toEqual(['agent'])
    expect(finishSetupLaunch).not.toBeNull()
    const completeSetupLaunch = finishSetupLaunch as unknown as () => void
    completeSetupLaunch()
    await Promise.resolve()
    expect(order).toEqual(['agent', 'setup'])
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'dispatched',
        workspaceId: 'wt-created',
        terminalSessionId: 'agent-tab'
      })
    )
  })

  it('launches setup and default tabs without activating the created worktree', async () => {
    const defaultTabs = {
      tabs: [{ title: 'Dev', command: 'pnpm dev' }],
      runCommands: true
    }
    mockCreateWorktree.mockResolvedValue({
      worktree: createdWorktree,
      setup: setupLaunch,
      defaultTabs
    })

    await registerAndDispatch()

    expect(mockLaunchWorktreeBackgroundTerminals).toHaveBeenCalledWith({
      worktreeId: 'wt-created',
      setup: setupLaunch,
      defaultTabs
    })
    expect(state.setActiveView).not.toHaveBeenCalled()
    expect(state.setActiveWorktree).not.toHaveBeenCalled()
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-created',
        prompt: 'run this'
      })
    )
  })

  it('defaults legacy automations without a setup choice to skipping setup', async () => {
    await registerAndDispatch(makeAutomation({ setupDecision: undefined }))

    expect(mockCreateWorktree.mock.calls[0][3]).toBe('skip')
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalled()
  })

  it('does not stamp the created workspace with an empty agent-launch fallback', async () => {
    await registerAndDispatch()

    expect(mockCreateWorktree.mock.calls[0][10]).toBeUndefined()
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'claude',
        prompt: 'run this',
        worktreeId: 'wt-created'
      })
    )
  })

  it('keeps launching the agent when background setup terminal launch fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockLaunchWorktreeBackgroundTerminals.mockRejectedValue(new Error('tab launch failed'))

    try {
      await registerAndDispatch()
    } finally {
      warnSpy.mockRestore()
    }

    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-created',
        prompt: 'run this'
      })
    )
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'dispatched',
        workspaceId: 'wt-created',
        terminalSessionId: 'agent-tab'
      })
    )
  })

  it('does not rerun setup for existing-worktree automations', async () => {
    const existingWorktree = {
      id: 'wt-existing',
      repoId: 'repo-1',
      displayName: 'Existing workspace',
      path: '/repo/existing'
    }
    state.allWorktrees.mockReturnValue([existingWorktree])

    await registerAndDispatch(
      makeAutomation({
        workspaceMode: 'existing',
        workspaceId: 'wt-existing',
        setupDecision: 'run'
      })
    )

    expect(mockCreateWorktree).not.toHaveBeenCalled()
    expect(mockLaunchWorktreeBackgroundTerminals).not.toHaveBeenCalled()
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-existing',
        prompt: 'run this'
      })
    )
  })

  it('dispatches an existing SSH folder workspace on its resolved host', async () => {
    const folderWorkspace = {
      id: 'folder:fw-1',
      repoId: 'folder-workspace:group-1',
      displayName: 'SSH folder',
      path: '/srv/project'
    }
    state.repos = [
      {
        id: 'repo-1',
        connectionId: 'ssh-folder',
        executionHostId: null,
        path: '/srv/project/repo'
      }
    ]
    state.folderWorkspaces = [
      {
        id: 'fw-1',
        projectGroupId: 'group-1',
        folderPath: '/srv/project',
        connectionId: 'ssh-folder'
      }
    ]
    state.projectGroups = [{ id: 'group-1', connectionId: 'ssh-folder' }]
    state.getKnownWorktreeById.mockReturnValue(folderWorkspace)
    mockSshGetState.mockResolvedValue({ status: 'disconnected' })

    await registerAndDispatch(
      makeAutomation({
        workspaceMode: 'existing',
        workspaceId: folderWorkspace.id,
        setupDecision: 'skip',
        runContext: { repoId: 'repo-1', hostId: 'ssh:ssh-folder' }
      })
    )

    expect(state.allWorktrees).not.toHaveBeenCalled()
    expect(mockSshConnect).toHaveBeenCalledWith({ targetId: 'ssh-folder' })
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: folderWorkspace.id,
        prompt: 'run this'
      })
    )
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dispatched',
        workspaceId: folderWorkspace.id,
        workspaceDisplayName: folderWorkspace.displayName
      })
    )
  })

  it('dispatches a local folder workspace without SSH', async () => {
    const folderWorkspace = {
      id: 'folder:fw-local',
      repoId: 'folder-workspace:group-local',
      displayName: 'Local folder',
      path: '/project'
    }
    state.folderWorkspaces = [
      {
        id: 'fw-local',
        projectGroupId: 'group-local',
        folderPath: '/project',
        connectionId: null
      }
    ]
    state.projectGroups = [{ id: 'group-local', connectionId: null }]
    state.getKnownWorktreeById.mockReturnValue(folderWorkspace)

    await registerAndDispatch(
      makeAutomation({
        workspaceMode: 'existing',
        workspaceId: folderWorkspace.id,
        runContext: { repoId: 'repo-1', hostId: 'local' }
      })
    )

    expect(mockSshNeedsPassphrasePrompt).not.toHaveBeenCalled()
    expect(mockLaunchAgentBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: folderWorkspace.id })
    )
  })

  it('skips a folder workspace owned by a different host', async () => {
    const folderWorkspace = {
      id: 'folder:fw-other',
      repoId: 'folder-workspace:group-other',
      displayName: 'Other host',
      path: '/srv/other'
    }
    state.folderWorkspaces = [
      {
        id: 'fw-other',
        projectGroupId: 'group-other',
        folderPath: '/srv/other',
        connectionId: 'ssh-other'
      }
    ]
    state.projectGroups = [{ id: 'group-other', connectionId: 'ssh-other' }]
    state.getKnownWorktreeById.mockReturnValue(folderWorkspace)

    await registerAndDispatch(
      makeAutomation({
        workspaceMode: 'existing',
        workspaceId: folderWorkspace.id,
        runContext: { repoId: 'repo-1', hostId: 'local' }
      })
    )

    expect(mockLaunchAgentBackgroundSession).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_unavailable' })
    )
  })

  it('keeps detected-only non-folder workspaces unavailable', async () => {
    state.getKnownWorktreeById.mockReturnValue({
      id: 'wt-detected',
      repoId: 'repo-1',
      displayName: 'Detected',
      path: '/repo/detected'
    })

    await registerAndDispatch(
      makeAutomation({
        workspaceMode: 'existing',
        workspaceId: 'wt-detected'
      })
    )

    expect(state.getKnownWorktreeById).not.toHaveBeenCalled()
    expect(mockLaunchAgentBackgroundSession).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_unavailable' })
    )
  })

  it('finalizes a fresh non-reuse terminal only after completed result persistence', async () => {
    const order: string[] = []
    let launchArgs: { onAgentStatus?: (payload: { state: string }) => void } = {}
    mockMarkDispatchResult.mockImplementation(
      async (result: { status: string; terminalPaneKey?: string | null }) => {
        // The retirement clear reuses status 'completed' but nulls the terminal
        // identity; label it distinctly so ordering stays legible.
        order.push(
          result.status === 'completed' && result.terminalPaneKey === null
            ? 'clear-terminal-identity'
            : `persist:${result.status}`
        )
      }
    )
    mockFinalizeTerminalOwnership.mockImplementation(() => {
      order.push('finalize')
      return true
    })
    mockLaunchAgentBackgroundSession.mockImplementation(async (args) => {
      launchArgs = args
      return {
        tabId: 'agent-tab',
        paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
        ptyId: 'agent-pty',
        startupPlan: {},
        terminalOwnership: {
          finalize: mockFinalizeTerminalOwnership,
          release: mockReleaseTerminalOwnership
        }
      }
    })

    await registerAndDispatch()
    launchArgs.onAgentStatus?.({ state: 'done' })
    await vi.waitFor(() => expect(mockFinalizeTerminalOwnership).toHaveBeenCalledOnce())

    expect(order).toEqual([
      'persist:dispatched',
      'persist:completed',
      'finalize',
      'clear-terminal-identity'
    ])
    expect(mockReleaseTerminalOwnership).not.toHaveBeenCalled()
    // Why: the retired terminal is gone; the run must drop its pane/pty pointers
    // so "View run" resolves to the workspace/snapshot, not an unavailable terminal.
    expect(mockMarkDispatchResult).toHaveBeenLastCalledWith({
      runId: expect.any(String),
      status: 'completed',
      terminalSessionId: null,
      terminalPaneKey: null,
      terminalPtyId: null
    })
  })

  it('ignores a session-boundary done so a connecting agent cannot complete the run (STA-3386)', async () => {
    let launchArgs: {
      onAgentStatus?: (payload: { state: string; sessionBoundary?: boolean }) => void
    } = {}
    mockLaunchAgentBackgroundSession.mockImplementation(async (args) => {
      launchArgs = args
      return {
        tabId: 'agent-tab',
        paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
        ptyId: 'agent-pty',
        startupPlan: {},
        terminalOwnership: {
          finalize: mockFinalizeTerminalOwnership,
          release: mockReleaseTerminalOwnership
        }
      }
    })

    await registerAndDispatch()
    // Why: Claude fires SessionStart (a sessionBoundary done) at launch, before the argv
    // prompt submits — treating it as run completion would close the tab on an empty run.
    launchArgs.onAgentStatus?.({ state: 'done', sessionBoundary: true })
    await Promise.resolve()
    expect(mockFinalizeTerminalOwnership).not.toHaveBeenCalled()

    launchArgs.onAgentStatus?.({ state: 'done' })
    await vi.waitFor(() => expect(mockFinalizeTerminalOwnership).toHaveBeenCalledOnce())
  })

  it('persists assistant output from a batched working→done→working transition', async () => {
    const paneKey = 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d'

    await registerAndDispatch()
    const transitionStartedAt = Date.now() + 1
    state.agentStatusByPaneKey = {
      [paneKey]: {
        paneKey,
        state: 'working',
        prompt: 'second turn',
        agentType: 'claude',
        updatedAt: transitionStartedAt + 2,
        stateStartedAt: transitionStartedAt + 2,
        lastCompletedAssistantMessage: 'Summary.\n\nDetails.',
        stateHistory: [
          { state: 'working', prompt: 'first turn', startedAt: transitionStartedAt },
          { state: 'done', prompt: 'first turn', startedAt: transitionStartedAt + 1 }
        ]
      }
    }
    if (!latestStoreSubscriber) {
      throw new Error('agent status observer was not registered')
    }
    latestStoreSubscriber()

    await vi.waitFor(() => expect(mockFinalizeTerminalOwnership).toHaveBeenCalledOnce())
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'completed',
        outputSnapshot: {
          format: 'plain_text',
          content: 'Summary.\n\nDetails.',
          capturedAt: 1,
          truncated: false
        }
      })
    )
  })

  it('does not let later working authorize an earlier historical done on rescan', async () => {
    const paneKey = 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d'
    mockFindReusableAutomationSession.mockReturnValue({
      tabId: 'agent-tab',
      paneKey,
      ptyId: 'agent-pty'
    })
    mockObserveExistingAutomationSession.mockResolvedValue(() => {})

    await registerAndDispatch(makeAutomation({ reuseSession: true }))
    const transitionStartedAt = Date.now() + 1
    state.agentStatusByPaneKey = {
      [paneKey]: {
        paneKey,
        state: 'working',
        prompt: 'new turn',
        agentType: 'claude',
        updatedAt: transitionStartedAt + 1,
        stateStartedAt: transitionStartedAt + 1,
        stateHistory: [{ state: 'done', prompt: 'old turn', startedAt: transitionStartedAt }]
      }
    }
    if (!latestStoreSubscriber) {
      throw new Error('agent status observer was not registered')
    }

    latestStoreSubscriber()
    latestStoreSubscriber()
    await Promise.resolve()

    expect(mockMarkDispatchResult).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    )
  })

  // Why: transport loss, PTY exit and cap eviction all drop and recreate the live
  // entry with an empty stateHistory. The working edge is only in the observer's
  // own bookkeeping by then, so it must survive a zero-overlap rescan.
  it('completes a reuse-session run when the entry is recreated with no history', async () => {
    const paneKey = 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d'
    mockFindReusableAutomationSession.mockReturnValue({
      tabId: 'agent-tab',
      paneKey,
      ptyId: 'agent-pty'
    })
    mockObserveExistingAutomationSession.mockResolvedValue(() => {})

    await registerAndDispatch(makeAutomation({ reuseSession: true }))
    const workingStartedAt = Date.now() + 1
    state.agentStatusByPaneKey = {
      [paneKey]: {
        paneKey,
        state: 'working',
        prompt: 'turn',
        agentType: 'claude',
        updatedAt: workingStartedAt,
        stateStartedAt: workingStartedAt,
        stateHistory: [{ state: 'working', prompt: 'turn', startedAt: workingStartedAt }]
      }
    }
    if (!latestStoreSubscriber) {
      throw new Error('agent status observer was not registered')
    }
    latestStoreSubscriber()
    await Promise.resolve()

    // The entry is dropped and recreated: same pane, now done, history gone.
    state.agentStatusByPaneKey = {
      [paneKey]: {
        paneKey,
        state: 'done',
        prompt: 'turn',
        agentType: 'claude',
        updatedAt: workingStartedAt + 2,
        stateStartedAt: workingStartedAt + 2,
        stateHistory: []
      }
    }
    latestStoreSubscriber()
    await Promise.resolve()

    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    )
  })

  it('consumes duplicate done and zero-exit completion through one finalizer', async () => {
    let launchArgs: {
      onAgentStatus?: (payload: { state: string }) => void
      onExit?: (ptyId: string, code: number) => void
    } = {}
    mockLaunchAgentBackgroundSession.mockImplementation(async (args) => {
      launchArgs = args
      return {
        tabId: 'agent-tab',
        paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
        ptyId: 'agent-pty',
        startupPlan: {},
        terminalOwnership: {
          finalize: mockFinalizeTerminalOwnership,
          release: mockReleaseTerminalOwnership
        }
      }
    })

    await registerAndDispatch()
    launchArgs.onAgentStatus?.({ state: 'done' })
    launchArgs.onExit?.('agent-pty', 0)
    launchArgs.onAgentStatus?.({ state: 'done' })
    await vi.waitFor(() => expect(mockFinalizeTerminalOwnership).toHaveBeenCalledOnce())

    expect(
      mockMarkDispatchResult.mock.calls.filter(
        ([result]) => result.status === 'completed' && result.terminalPaneKey !== null
      )
    ).toHaveLength(1)
    expect(mockReleaseTerminalOwnership).not.toHaveBeenCalled()
  })

  it('releases ownership on nonzero exit without finalizing the tab', async () => {
    let onExit: ((ptyId: string, code: number) => void) | undefined
    mockLaunchAgentBackgroundSession.mockImplementation(async (args) => {
      onExit = args.onExit
      return {
        tabId: 'agent-tab',
        paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
        ptyId: 'agent-pty',
        startupPlan: {},
        terminalOwnership: {
          finalize: mockFinalizeTerminalOwnership,
          release: mockReleaseTerminalOwnership
        }
      }
    })

    await registerAndDispatch()
    onExit?.('agent-pty', 9)
    await vi.waitFor(() => expect(mockReleaseTerminalOwnership).toHaveBeenCalledOnce())

    expect(mockFinalizeTerminalOwnership).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dispatch_failed' })
    )
  })

  it('releases ownership when dispatched result persistence rejects', async () => {
    mockMarkDispatchResult.mockRejectedValueOnce(new Error('persistence unavailable'))

    await registerAndDispatch()

    expect(mockReleaseTerminalOwnership).toHaveBeenCalledOnce()
    expect(mockFinalizeTerminalOwnership).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'dispatch_failed' })
    )
  })

  it('releases ownership when completed result persistence rejects', async () => {
    mockMarkDispatchResult
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('completion persistence unavailable'))
      .mockResolvedValueOnce(undefined)
    mockLaunchAgentBackgroundSession.mockImplementation(async (args) => {
      args.onAgentStatus?.({ state: 'done' })
      return {
        tabId: 'agent-tab',
        paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
        ptyId: 'agent-pty',
        startupPlan: {},
        terminalOwnership: {
          finalize: mockFinalizeTerminalOwnership,
          release: mockReleaseTerminalOwnership
        }
      }
    })

    await registerAndDispatch()

    expect(mockReleaseTerminalOwnership).toHaveBeenCalledOnce()
    expect(mockFinalizeTerminalOwnership).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'dispatch_failed' })
    )
  })

  it('diagnoses a late completed-persistence rejection once without terminal cleanup', async () => {
    let onAgentStatus: ((payload: { state: string }) => void) | undefined
    const persistenceError = new Error('late completion persistence unavailable')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockMarkDispatchResult.mockResolvedValueOnce(undefined).mockRejectedValueOnce(persistenceError)
    mockLaunchAgentBackgroundSession.mockImplementation(async (args) => {
      onAgentStatus = args.onAgentStatus
      return {
        tabId: 'agent-tab',
        paneKey: 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d',
        ptyId: 'agent-pty',
        startupPlan: {},
        terminalOwnership: {
          finalize: mockFinalizeTerminalOwnership,
          release: mockReleaseTerminalOwnership
        }
      }
    })

    await registerAndDispatch()
    onAgentStatus?.({ state: 'done' })
    onAgentStatus?.({ state: 'done' })
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce())

    expect(errorSpy).toHaveBeenCalledWith(
      '[automations] Failed to persist late automation result:',
      persistenceError
    )
    expect(mockReleaseTerminalOwnership).toHaveBeenCalledOnce()
    expect(mockFinalizeTerminalOwnership).not.toHaveBeenCalled()
    expect(
      mockMarkDispatchResult.mock.calls.filter(
        ([result]) => result.status === 'completed' && result.terminalPaneKey !== null
      )
    ).toHaveLength(1)
    errorSpy.mockRestore()
  })

  it('preserves a fresh reuse-enabled session as the future reuse seed', async () => {
    mockFindReusableAutomationSession.mockReturnValue(null)

    await registerAndDispatch(makeAutomation({ reuseSession: true }))

    expect(mockReleaseTerminalOwnership).toHaveBeenCalledOnce()
    expect(mockFinalizeTerminalOwnership).not.toHaveBeenCalled()
  })

  it('passes the configured target pane to the reuse search', async () => {
    mockFindReusableAutomationSession.mockReturnValue(null)

    await registerAndDispatch(makeAutomation({ reuseSession: true, targetPaneKey: 'tab-1:leaf-1' }))

    expect(mockFindReusableAutomationSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetPaneKey: 'tab-1:leaf-1' })
    )
  })
})
