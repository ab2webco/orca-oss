import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(),
  activateTabAndFocusPane: vi.fn(),
  tabsByWorktree: {} as Record<string, { id: string }[]>
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ tabsByWorktree: mocks.tabsByWorktree }) }
}))

const { openTeamSession } = await import('./team-panel-open-session')

const LEAF = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mocks.activateAndRevealWorktree.mockReset()
  mocks.activateTabAndFocusPane.mockReset()
  mocks.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
})

describe('openTeamSession', () => {
  it('reveals the workspace and focuses the session pane, as a sidebar agent row does', () => {
    const opened = openTeamSession({
      paneKey: `tab-1:${LEAF}`,
      terminalHandle: null,
      worktreeId: 'wt-1',
      host: { kind: 'local' }
    })
    expect(opened).toBe(true)
    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1')
    expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith('tab-1', LEAF, {
      ackPaneKeyOnSuccess: `tab-1:${LEAF}`,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  })

  it('routes to the paired host a remote session runs on', () => {
    openTeamSession({
      paneKey: `tab-1:${LEAF}`,
      terminalHandle: null,
      worktreeId: 'wt-1',
      host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true }
    })
    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1', {
      executionHostId: 'runtime:env-1'
    })
  })

  it('never focuses a guessed pane for a malformed key or a tab the workspace lacks', () => {
    expect(
      openTeamSession({
        paneKey: 'tab-1:not-a-leaf',
        terminalHandle: null,
        worktreeId: 'wt-1',
        host: { kind: 'local' }
      })
    ).toBe(false)
    expect(
      openTeamSession({
        paneKey: `tab-9:${LEAF}`,
        terminalHandle: null,
        worktreeId: 'wt-1',
        host: { kind: 'local' }
      })
    ).toBe(false)
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalled()
  })
})
