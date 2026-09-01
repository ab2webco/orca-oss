import { beforeEach, describe, expect, it, vi } from 'vitest'

const launchAgentInNewTab = vi.fn()

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (args: unknown) => launchAgentInNewTab(args)
}))

const { reopenClaudeTerminalsAfterReauth } = await import('./claude-reauth-terminal-reopen')

describe('reopenClaudeTerminalsAfterReauth', () => {
  beforeEach(() => {
    launchAgentInNewTab.mockReset()
  })

  it('relaunches Claude once per worktree that lost its terminal', () => {
    launchAgentInNewTab.mockImplementation(() => ({ tabId: 'tab-1' }))

    const outcome = reopenClaudeTerminalsAfterReauth(['repo::a', 'repo::b', 'repo::a'])

    expect(launchAgentInNewTab.mock.calls.map(([args]) => args)).toEqual([
      { agent: 'claude', worktreeId: 'repo::a', launchSource: 'unknown' },
      { agent: 'claude', worktreeId: 'repo::b', launchSource: 'unknown' }
    ])
    expect(outcome).toEqual({
      reopenedWorktreeIds: ['repo::a', 'repo::b'],
      failedWorktreeIds: []
    })
  })

  it('reports a worktree it could not reopen instead of failing the re-auth', () => {
    launchAgentInNewTab.mockImplementationOnce(() => {
      throw new Error('no startup plan')
    })
    launchAgentInNewTab.mockImplementationOnce(() => null)

    const outcome = reopenClaudeTerminalsAfterReauth(['repo::a', 'repo::b'])

    expect(outcome).toEqual({
      reopenedWorktreeIds: [],
      failedWorktreeIds: ['repo::a', 'repo::b']
    })
  })
})
