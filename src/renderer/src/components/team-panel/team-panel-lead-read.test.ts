import { describe, expect, it, vi } from 'vitest'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  findTeamLeadCaller,
  readTeamHistory,
  readTeamLeadRoster,
  readTeamLeadState,
  readTeamXp,
  unplacedLeadCountOf
} from './team-panel-lead-read'

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

  // Why (ORCA-1130): after a restart an idle lead never reports, so its entry is missing.
  it('finds an idle lead from the pane the host lists, with no agent status for it', () => {
    const leads = [{ handle: 'term-lead', paneKey: PANE }]
    expect(findTeamLeadCaller({ ...base, leads, entries: {} })).toEqual({
      worktreeId: 'wt-main',
      terminalHandle: 'term-lead',
      paneKey: PANE
    })
  })

  // Why (ORCA-1402): game.leads listed the lead, yet the panel showed no team and no breadcrumb.
  it('finds a listed lead by the worktree it registered from when no tab here holds its pane', () => {
    const leads = [{ handle: 'term-lead', paneKey: PANE, worktreeId: 'wt-main' }]
    const noTab = { ...base, leads, entries: {}, worktreeIdOfTab: () => null }
    expect(findTeamLeadCaller(noTab)).toEqual({
      worktreeId: 'wt-main',
      terminalHandle: 'term-lead',
      paneKey: PANE
    })
    expect(findTeamLeadCaller({ ...noTab, repoWorktreeIds: new Set(['wt-member']) })).toBeNull()
    // Why: game.state finds the lead only by its pane, so a listing without one stays unplaced.
    const paneless = [{ handle: 'term-lead', worktreeId: 'wt-main' }]
    expect(findTeamLeadCaller({ ...noTab, leads: paneless })).toBeNull()
  })

  it('places a folder workspace lead by its registered workspace key', () => {
    const folder = folderWorkspaceKey('ws-1')
    const leads = [{ handle: 'term-lead', paneKey: PANE, worktreeId: folder }]
    const noTab = { ...base, leads, entries: {}, worktreeIdOfTab: () => null }
    expect(findTeamLeadCaller({ ...noTab, repoWorktreeIds: new Set([folder]) })).toMatchObject({
      worktreeId: folder
    })
  })

  it('says restoring while the host is bringing back a lead of this project', () => {
    const restoring = { leads: [], entries: {}, restoring: [PANE] }
    expect(findTeamLeadCaller({ ...base, ...restoring })).toBe('restoring')
    expect(
      findTeamLeadCaller({ ...base, ...restoring, repoWorktreeIds: new Set(['wt-member']) })
    ).toBeNull()
  })
})

describe('unplacedLeadCountOf', () => {
  it('counts listed leads with no pane, or whose pane has no tab here', () => {
    const leads = [
      { handle: 'a', paneKey: PANE },
      { handle: 'b', paneKey: 'tab-gone:1' },
      { handle: 'c' }
    ]
    expect(unplacedLeadCountOf(leads, (tabId) => (tabId === 'tab-lead' ? 'wt' : null))).toBe(2)
  })
})

describe('readTeamLeadRoster', () => {
  it('keeps the worktree each lead registered from, and drops one that is not a string', async () => {
    callRuntimeRpc.mockResolvedValueOnce({
      leads: [
        { handle: 'term-lead', paneKey: PANE, worktreeId: 'wt-main', project: 'orca' },
        { handle: 'term-old', worktreeId: 7 }
      ]
    })

    expect(await readTeamLeadRoster({ kind: 'local' })).toEqual({
      leads: [
        { handle: 'term-lead', paneKey: PANE, worktreeId: 'wt-main' },
        { handle: 'term-old' }
      ],
      restoring: []
    })
  })
})

describe('readTeamXp', () => {
  it("sums the project's characters XP as the host keeps it, skipping what it cannot read", async () => {
    callRuntimeRpc.mockResolvedValueOnce({
      characters: [
        { key: 'merlin', xp: 200 },
        { key: 'arthur', xp: 150 },
        { key: 'x', xp: 'bad' }
      ]
    })
    const caller = { worktreeId: 'wt', terminalHandle: 'term', paneKey: 'pane' }

    expect(await readTeamXp({ kind: 'local' }, caller)).toBe(350)
    expect(callRuntimeRpc).toHaveBeenLastCalledWith(
      { kind: 'local' },
      'game.characters',
      { worktreeId: 'wt', terminalHandle: 'term' },
      expect.anything()
    )
    // Why null: an older host has no list, and a level from nothing would be made up.
    callRuntimeRpc.mockResolvedValueOnce({})
    expect(await readTeamXp({ kind: 'local' }, caller)).toBeNull()
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

  it("adds Retry now's fresh flag to the same identity, and only then (ORCA-1329)", async () => {
    callRuntimeRpc.mockResolvedValue({ role: 'lead', agents: [] })
    const caller = { worktreeId: 'wt-main', terminalHandle: 'term-lead', paneKey: PANE }

    await readTeamLeadState({ kind: 'local' }, caller, { fresh: true })
    await readTeamLeadState({ kind: 'local' }, caller, { fresh: false })

    expect(callRuntimeRpc.mock.calls.slice(-2).map((call) => call[2])).toEqual([
      { ...caller, fresh: true },
      caller
    ])
  })

  it('reads no state that is not the lead role', async () => {
    callRuntimeRpc.mockResolvedValue({ role: 'member', agents: [] })

    await expect(
      readTeamLeadState({ kind: 'local' }, { worktreeId: 'w', terminalHandle: 't', paneKey: PANE })
    ).resolves.toBeNull()
  })
})

describe('readTeamHistory', () => {
  it("reads the lead's freed members, dropping records this build cannot read", async () => {
    callRuntimeRpc.mockResolvedValueOnce({
      records: [
        {
          ticket: 'ORCA-1',
          endedAt: '2026-11-15T10:00:00.000Z',
          outcome: 'merged',
          pr: '#2 merged'
        },
        { ticket: 'ORCA-3', endedAt: 'not a date', outcome: 'merged' }
      ]
    })

    const records = await readTeamHistory(
      { kind: 'local' },
      { worktreeId: 'wt', terminalHandle: 'term' }
    )

    expect(records.map((one) => one.ticket)).toEqual(['ORCA-1'])
    expect(callRuntimeRpc).toHaveBeenLastCalledWith(
      { kind: 'local' },
      'game.history',
      { worktreeId: 'wt', terminalHandle: 'term' },
      expect.anything()
    )
  })

  it('reads none from a host with no history', async () => {
    callRuntimeRpc.mockRejectedValueOnce(
      Object.assign(new Error('unknown method'), { code: 'method_not_found' })
    )

    await expect(
      readTeamHistory({ kind: 'local' }, { worktreeId: 'wt', terminalHandle: 'term' })
    ).resolves.toEqual([])
  })
})
