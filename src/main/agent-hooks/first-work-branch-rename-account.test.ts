import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  gitExecFileAsyncMock,
  resolveLocalGitUsernameMock,
  getSshGitUsernameMock,
  getSshGitProviderMock,
  generateBranchNameMock,
  resolveTextGenerationParamsMock,
  prepareLocalEnvMock,
  computeBranchNameMock,
  getConfiguredBranchPrefixMock
} = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn(),
  resolveLocalGitUsernameMock: vi.fn(async () => 'you'),
  getSshGitUsernameMock: vi.fn(async () => 'you'),
  getSshGitProviderMock: vi.fn(() => undefined),
  generateBranchNameMock: vi.fn(),
  resolveTextGenerationParamsMock: vi.fn(),
  prepareLocalEnvMock: vi.fn(async () => ({ ok: true as const })),
  computeBranchNameMock: vi.fn((leaf: string) => `you/${leaf}`),
  // Mirror computeBranchNameMock's `you/` strategy so prefix stripping is realistic.
  getConfiguredBranchPrefixMock: vi.fn((_settings: unknown, username: string | null) => username)
}))

vi.mock('../git/runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))
vi.mock('../git/git-username', () => ({
  getSshGitUsername: getSshGitUsernameMock,
  resolveLocalGitUsername: resolveLocalGitUsernameMock
}))
vi.mock('../providers/ssh-git-dispatch', () => ({ getSshGitProvider: getSshGitProviderMock }))
vi.mock('../text-generation/commit-message-text-generation', () => ({
  generateBranchNameFromContext: generateBranchNameMock,
  resolveTextGenerationParams: resolveTextGenerationParamsMock
}))
vi.mock('../text-generation/commit-message-agent-environment', () => ({
  prepareLocalCommitMessageAgentEnv: prepareLocalEnvMock
}))
vi.mock('../ipc/worktree-logic', () => ({
  computeBranchName: computeBranchNameMock,
  getConfiguredBranchPrefix: getConfiguredBranchPrefixMock
}))

import {
  maybeAutoRenameBranchOnFirstWork,
  resetFirstWorkBranchRenameState,
  type FirstWorkBranchRenameDeps
} from './first-work-branch-rename'
import {
  WORKTREE_ID,
  gitResponder,
  makeBranchRenameDeps,
  workingEvent
} from './first-work-branch-rename-test-harness'

function makeDeps(overrides: Partial<FirstWorkBranchRenameDeps> = {}) {
  return makeBranchRenameDeps(vi.fn, overrides)
}

const LIMIT_FAILURE = {
  success: false as const,
  error: "You've hit your limit · resets 3pm",
  canceled: false
}

describe('first-work branch rename account selection', () => {
  beforeEach(() => {
    resetFirstWorkBranchRenameState()
    vi.clearAllMocks()
    resolveLocalGitUsernameMock.mockResolvedValue('you')
    computeBranchNameMock.mockImplementation((leaf: string) => `you/${leaf}`)
    prepareLocalEnvMock.mockResolvedValue({ ok: true })
    resolveTextGenerationParamsMock.mockReturnValue({
      ok: true,
      params: { agentId: 'claude', model: 'm' }
    })
    generateBranchNameMock.mockResolvedValue({ success: true, slug: 'fix-auth' })
    gitExecFileAsyncMock.mockImplementation(
      gitResponder({ currentBranch: 'you/Nautilus', hasUpstream: false })
    )
  })

  it('runs as the account pinned to the terminal that triggered the rename', async () => {
    const { deps } = makeDeps({ getPinnedClaudeAccountId: () => 'acct-pinned' })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(prepareLocalEnvMock).toHaveBeenCalledWith('claude', undefined, {
      claudeAccountId: 'acct-pinned'
    })
  })

  it('keeps the global selection when the terminal has no pin', async () => {
    const { deps } = makeDeps({ getPinnedClaudeAccountId: () => null })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(prepareLocalEnvMock).toHaveBeenCalledWith('claude', undefined, undefined)
  })

  it('runs as the account the triggering pane runs on, ahead of the worktree pin', async () => {
    const { deps } = makeDeps({
      getPaneClaudeAccountId: () => 'acct-member',
      getPinnedClaudeAccountId: () => 'acct-worktree'
    })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(prepareLocalEnvMock).toHaveBeenCalledWith('claude', undefined, {
      claudeAccountId: 'acct-member'
    })
  })

  it('uses the pane account when the worktree has no pin', async () => {
    const { deps } = makeDeps({
      getPaneClaudeAccountId: () => 'acct-member',
      getPinnedClaudeAccountId: () => null
    })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(prepareLocalEnvMock).toHaveBeenCalledWith('claude', undefined, {
      claudeAccountId: 'acct-member'
    })
  })

  it('falls back to the worktree pin when the pane account is unknown', async () => {
    const { deps } = makeDeps({
      getPaneClaudeAccountId: () => null,
      getPinnedClaudeAccountId: () => 'acct-worktree'
    })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(prepareLocalEnvMock).toHaveBeenCalledWith('claude', undefined, {
      claudeAccountId: 'acct-worktree'
    })
  })

  it('falls back to another account with quota when the pinned one is limited', async () => {
    generateBranchNameMock
      .mockResolvedValueOnce(LIMIT_FAILURE)
      .mockResolvedValueOnce({ success: true, slug: 'fix-auth' })
    const pick = vi.fn(() => 'acct-spare')
    const { deps, setRenameError, onRenamed } = makeDeps({
      getPinnedClaudeAccountId: () => 'acct-pinned',
      pickClaudeFallbackAccountId: pick
    })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(pick).toHaveBeenCalledWith({ excludedAccountIds: ['acct-pinned'], triedGlobal: false })
    expect(prepareLocalEnvMock).toHaveBeenLastCalledWith('claude', undefined, {
      claudeAccountId: 'acct-spare'
    })
    expect(onRenamed).toHaveBeenCalled()
    expect(setRenameError).not.toHaveBeenCalledWith(
      WORKTREE_ID,
      expect.stringContaining('limit'),
      expect.anything()
    )
  })

  it('reports a failure only after every account with quota is spent', async () => {
    generateBranchNameMock.mockResolvedValue(LIMIT_FAILURE)
    const pick = vi.fn().mockReturnValueOnce('acct-spare').mockReturnValue(null)
    const { deps, setRenameError, onRenamed } = makeDeps({
      getPinnedClaudeAccountId: () => null,
      pickClaudeFallbackAccountId: pick
    })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(generateBranchNameMock).toHaveBeenCalledTimes(2)
    expect(pick).toHaveBeenLastCalledWith({ excludedAccountIds: ['acct-spare'], triedGlobal: true })
    expect(onRenamed).not.toHaveBeenCalled()
    expect(setRenameError).toHaveBeenCalledWith(WORKTREE_ID, LIMIT_FAILURE.error, null)
  })

  it('does not switch accounts for a failure that is not a usage limit', async () => {
    generateBranchNameMock.mockResolvedValue({ success: false, error: 'binary missing' })
    const pick = vi.fn(() => 'acct-spare')
    const { deps } = makeDeps({ pickClaudeFallbackAccountId: pick })
    await maybeAutoRenameBranchOnFirstWork(workingEvent(), deps)
    expect(pick).not.toHaveBeenCalled()
    expect(generateBranchNameMock).toHaveBeenCalledTimes(1)
  })
})
