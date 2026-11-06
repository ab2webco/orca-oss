import { describe, expect, it, vi } from 'vitest'
import { findTeamLeadCaller, readTeamLeadState } from './team-panel-lead-read'

const callRuntimeRpc = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))

const PANE = 'tab-lead:1b4e28ba-2fa1-41d2-883f-0016d3cca427'

describe('findTeamLeadCaller', () => {
  const base = {
    leads: [{ handle: 'term-lead' }, { handle: 'term-other' }],
    entries: {
      [PANE]: { paneKey: PANE, terminalHandle: 'term-lead' },
      'tab-x:6fa459ea-ee8a-4ca4-894e-db77e160355e': {
        paneKey: 'tab-x:6fa459ea-ee8a-4ca4-894e-db77e160355e',
        terminalHandle: 'term-other'
      }
    },
    worktreeIdOfTab: (tabId: string) => (tabId === 'tab-lead' ? 'wt-main' : 'wt-elsewhere'),
    repoWorktreeIds: new Set(['wt-main', 'wt-member'])
  }

  it("finds the live lead whose pane is in the active project's worktrees", () => {
    expect(findTeamLeadCaller(base)).toEqual({
      worktreeId: 'wt-main',
      terminalHandle: 'term-lead',
      paneKey: PANE
    })
  })

  it('finds no lead when none of the live leads runs in this project', () => {
    expect(findTeamLeadCaller({ ...base, repoWorktreeIds: new Set(['wt-member']) })).toBeNull()
    expect(findTeamLeadCaller({ ...base, leads: [] })).toBeNull()
  })
})

describe('readTeamLeadState', () => {
  // Why pinned: recordGameMerges skips a merge it saw only for the same worktreeId and
  // terminalHandle, so the panel must poll as the lead's mod does or merges count twice.
  it("calls game.state with exactly the lead mod's caller identity", async () => {
    callRuntimeRpc.mockResolvedValue({ role: 'lead', agents: [] })
    const caller = { worktreeId: 'wt-main', terminalHandle: 'term-lead', paneKey: PANE }

    await readTeamLeadState({ kind: 'local' }, caller)

    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'game.state',
      { worktreeId: 'wt-main', terminalHandle: 'term-lead', paneKey: PANE },
      expect.any(Object)
    )
  })

  it('reads no state that is not the lead role', async () => {
    callRuntimeRpc.mockResolvedValue({ role: 'member', agents: [] })

    await expect(
      readTeamLeadState({ kind: 'local' }, { worktreeId: 'w', terminalHandle: 't', paneKey: PANE })
    ).resolves.toBeNull()
  })
})
