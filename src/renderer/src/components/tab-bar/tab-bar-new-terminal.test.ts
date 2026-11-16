// ORCA-1192: each branch of the tab bar's + terminal reveals its owner row.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebRuntimeTerminalCreateOutcome } from '@/runtime/web-runtime-session'

const mocks = vi.hoisted(() => ({
  state: {
    activeGroupIdByWorktree: {} as Record<string, string>,
    groupsByWorktree: {} as Record<string, { id: string }[]>,
    tabsByWorktree: {} as Record<string, { id: string }[]>,
    openFiles: [] as { id: string; worktreeId: string }[],
    browserTabsByWorktree: {} as Record<string, { id: string }[]>,
    tabBarOrderByWorktree: {} as Record<string, string[]>,
    createTab: vi.fn(() => ({ id: 'tab-new' })),
    setActiveTabType: vi.fn(),
    setActiveTab: vi.fn(),
    setTabBarOrder: vi.fn(),
    openNewTerminalTabInActiveWorkspace: vi.fn(async () => {}),
    revealWorktreeInSidebar: vi.fn()
  },
  runtimeActive: false,
  createWebRuntimeSessionTerminal: vi.fn(
    async (): Promise<WebRuntimeTerminalCreateOutcome> => ({ status: 'created' })
  ),
  reveal: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeSessionTerminal: mocks.createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive: () => mocks.runtimeActive
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => (mocks.runtimeActive ? 'runtime-1' : null)
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({ focusTerminalTabSurface: vi.fn() }))
vi.mock('@/lib/new-terminal-owner-reveal', () => ({ revealNewTerminalOwnerRow: mocks.reveal }))

import { openNewTerminalFromTabBar, openShellTerminalInGroup } from './tab-bar-new-terminal'

beforeEach(() => {
  mocks.runtimeActive = false
  mocks.reveal.mockClear()
  mocks.state.createTab.mockClear()
  mocks.state.setActiveTab.mockClear()
  mocks.state.openNewTerminalTabInActiveWorkspace.mockClear()
  mocks.createWebRuntimeSessionTerminal.mockClear()
  mocks.state.activeGroupIdByWorktree = { 'wt-1': 'group-1' }
})

describe('openNewTerminalFromTabBar', () => {
  it('reveals the owner when a paired runtime creates the terminal', async () => {
    mocks.runtimeActive = true

    await openNewTerminalFromTabBar('wt-1')

    expect(mocks.createWebRuntimeSessionTerminal).toHaveBeenCalled()
    expect(mocks.reveal).toHaveBeenCalledWith(mocks.state, 'wt-1')
  })

  it('leaves the default terminal to the lifted action, which reveals on its own', async () => {
    await openNewTerminalFromTabBar('wt-1')

    expect(mocks.state.openNewTerminalTabInActiveWorkspace).toHaveBeenCalledWith('group-1')
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('reveals the owner for a shell-specific terminal', async () => {
    await openNewTerminalFromTabBar('wt-1', 'pwsh')

    expect(mocks.state.createTab).toHaveBeenCalledWith('wt-1', undefined, 'pwsh')
    expect(mocks.reveal).toHaveBeenCalledWith(mocks.state, 'wt-1')
  })

  it('reveals the owner when the workspace has no tab group yet', async () => {
    mocks.state.activeGroupIdByWorktree = {}

    await openNewTerminalFromTabBar('wt-1')

    expect(mocks.state.createTab).toHaveBeenCalledWith('wt-1', undefined, undefined)
    expect(mocks.reveal).toHaveBeenCalledWith(mocks.state, 'wt-1')
  })
})

describe('openShellTerminalInGroup', () => {
  it('reveals the owner when a paired runtime creates the shell', async () => {
    mocks.runtimeActive = true

    await openShellTerminalInGroup('wt-1', 'group-2', 'pwsh')

    expect(mocks.createWebRuntimeSessionTerminal).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      environmentId: 'runtime-1',
      targetGroupId: 'group-2',
      command: 'pwsh',
      activate: true
    })
    expect(mocks.state.createTab).not.toHaveBeenCalled()
    expect(mocks.reveal).toHaveBeenCalledWith(mocks.state, 'wt-1')
  })

  it('reveals the owner of a local shell opened in that group', async () => {
    mocks.createWebRuntimeSessionTerminal.mockResolvedValueOnce({
      status: 'failed',
      message: 'no paired session'
    })

    await openShellTerminalInGroup('wt-1', 'group-2', 'pwsh')

    expect(mocks.state.createTab).toHaveBeenCalledWith('wt-1', 'group-2', 'pwsh')
    expect(mocks.state.setActiveTab).toHaveBeenCalledWith('tab-new')
    expect(mocks.reveal).toHaveBeenCalledWith(mocks.state, 'wt-1')
  })
})
