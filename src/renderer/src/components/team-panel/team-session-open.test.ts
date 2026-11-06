import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSessionRef } from '../../../../shared/team-panel-model-types'

const calls = vi.hoisted(() => ({
  reveal: vi.fn(),
  focusPane: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn()
}))
let tabsByWorktree: Record<string, { id: string }[]> = {}
let hostId: string | null = null

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ tabsByWorktree, activeWorkspaceExecutionHostId: hostId })
  }
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: calls.reveal }))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: calls.focusPane }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: calls.rpc }))
vi.mock('sonner', () => ({ toast: { error: calls.toastError } }))

const { openTeamSession } = await import('./team-session-open')

const LEAF = '7f3c1e2a-4b5d-4c6e-8f90-a1b2c3d4e5f6'

const local = (over: Partial<TeamSessionRef> = {}): TeamSessionRef => ({
  paneKey: `tab-7:${LEAF}`,
  terminalHandle: 'term-7',
  worktreeId: 'wt-7',
  host: { kind: 'local' },
  ...over
})

describe('openTeamSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tabsByWorktree = { 'wt-7': [{ id: 'tab-7' }] }
    hostId = null
  })

  it("opens a local member's own tab and pane the way its sidebar row does", async () => {
    await openTeamSession(local(), 'ORCA-12')

    expect(calls.reveal).toHaveBeenCalledWith('wt-7')
    expect(calls.focusPane).toHaveBeenCalledWith('tab-7', LEAF, {
      ackPaneKeyOnSuccess: `tab-7:${LEAF}`,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
    expect(calls.rpc).not.toHaveBeenCalled()
  })

  it('asks the host to focus the terminal when this window has not loaded its tab', async () => {
    tabsByWorktree = {}
    hostId = 'runtime:env-9'
    calls.rpc.mockResolvedValue({ focus: {} })

    await openTeamSession(local(), 'ORCA-12')

    expect(calls.rpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-9' },
      'terminal.focus',
      { terminal: 'term-7' },
      expect.anything()
    )
    expect(calls.toastError).not.toHaveBeenCalled()
  })

  it("reveals a paired host's member through this window's runtime", async () => {
    calls.rpc.mockResolvedValue({ focus: {} })

    await openTeamSession(
      local({ host: { kind: 'remote', name: 'mini', environmentId: 'env-1', reachable: true } }),
      'ORCA-12'
    )

    expect(calls.rpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'terminal.revealPaired',
      { terminal: 'term-7', on: 'env-1' },
      expect.anything()
    )
    expect(calls.reveal).not.toHaveBeenCalled()
  })

  it('says it could not open the member when the host refuses', async () => {
    tabsByWorktree = {}
    calls.rpc.mockRejectedValue(new Error('terminal_handle_stale'))

    await openTeamSession(local(), 'ORCA-12')

    expect(calls.toastError).toHaveBeenCalledWith('Could not open ORCA-12')
  })

  it('says so without a call when a remote member has no paired host to open it through', async () => {
    await openTeamSession(
      local({ host: { kind: 'remote', name: 'mini', environmentId: null, reachable: false } }),
      'ORCA-12'
    )

    expect(calls.rpc).not.toHaveBeenCalled()
    expect(calls.toastError).toHaveBeenCalledWith('Could not open ORCA-12')
  })
})
