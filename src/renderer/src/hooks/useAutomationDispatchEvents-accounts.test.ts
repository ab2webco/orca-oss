import { beforeEach, describe, expect, it } from 'vitest'
import {
  makeAutomation,
  mockCreateWorktree,
  mockLaunchAgentBackgroundSession,
  mockMarkDispatchResult,
  mockSubmitPromptToAgentPty,
  mockFindReusableAutomationSession,
  mockObserveExistingAutomationSession,
  registerAndDispatch,
  resetAutomationDispatchHarness,
  state
} from './useAutomationDispatchEvents-test-harness'

const CREATE_OPTIONS_ARG = 25
const pins = { claudeAccountId: 'claude-acc', codexAccountId: 'codex-acc' }

describe('useAutomationDispatchEvents account pins', () => {
  beforeEach(resetAutomationDispatchHarness)

  it('pins the Claude account on the worktree a new_per_run Claude run creates', async () => {
    await registerAndDispatch(makeAutomation(pins))

    const options = mockCreateWorktree.mock.calls[0][CREATE_OPTIONS_ARG]
    expect(options).toMatchObject({ claudeAccountId: 'claude-acc' })
    expect(options).not.toHaveProperty('codexAccountId')
  })

  it('pins the Codex account on the worktree a new_per_run Codex run creates', async () => {
    await registerAndDispatch(makeAutomation({ ...pins, agentId: 'codex' }))

    const options = mockCreateWorktree.mock.calls[0][CREATE_OPTIONS_ARG]
    expect(options).toMatchObject({ codexAccountId: 'codex-acc' })
    expect(options).not.toHaveProperty('claudeAccountId')
  })

  it('passes a launch-scoped account to a fresh launch in an existing workspace', async () => {
    const existing = { id: 'wt-existing', repoId: 'repo-1', displayName: 'Mine', path: '/repo/x' }
    state.allWorktrees.mockReturnValue([existing])

    await registerAndDispatch(
      makeAutomation({ ...pins, workspaceMode: 'existing', workspaceId: 'wt-existing' })
    )

    expect(mockCreateWorktree).not.toHaveBeenCalled()
    const launchArgs = mockLaunchAgentBackgroundSession.mock.calls[0][0]
    expect(launchArgs).toMatchObject({ worktreeId: 'wt-existing' })
    expect(launchArgs.launchAccounts).toEqual({ claudeAccountId: 'claude-acc' })
  })

  it('also launches a new_per_run run with its account, not only via the worktree pin', async () => {
    await registerAndDispatch(makeAutomation({ ...pins, agentId: 'codex' }))

    expect(mockLaunchAgentBackgroundSession.mock.calls[0][0]).toMatchObject({
      worktreeId: 'wt-created',
      launchAccounts: { codexAccountId: 'codex-acc' }
    })
  })

  it('submits a reuse-session run to the live PTY without any account', async () => {
    mockFindReusableAutomationSession.mockReturnValue({
      tabId: 'tab-live',
      ptyId: 'pty-live',
      paneKey: 'tab-live:leaf'
    })
    mockObserveExistingAutomationSession.mockResolvedValue(() => {})

    await registerAndDispatch(makeAutomation({ ...pins, reuseSession: true }))

    expect(mockSubmitPromptToAgentPty).toHaveBeenCalledWith({
      tabId: 'tab-live',
      ptyId: 'pty-live',
      content: 'run this'
    })
    expect(mockLaunchAgentBackgroundSession).not.toHaveBeenCalled()
  })

  it('records a run whose pinned account was removed as a visible dispatch failure', async () => {
    mockCreateWorktree.mockRejectedValue(new Error('That Claude account no longer exists.'))

    await registerAndDispatch(makeAutomation(pins))

    expect(mockLaunchAgentBackgroundSession).not.toHaveBeenCalled()
    expect(mockMarkDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dispatch_failed',
        error: 'That Claude account no longer exists.'
      })
    )
  })
})
