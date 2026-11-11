// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNewTabTeamMenu } from './use-new-tab-team-menu'

const readTeamLeadRoster = vi.fn()
const teamLeadCallerOf = vi.fn()
const readStoredTeamLead = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({
      activeWorkspaceExecutionHostId: null,
      getKnownWorktreeById: () => ({ repoId: 'repo-1' })
    })
}))
vi.mock('@/components/team-panel/team-panel-project', () => ({
  teamPanelProjectOf: () => ({
    name: 'orca-oss',
    worktreeIds: ['wt-1', 'wt-lead'],
    isFolder: false
  })
}))
vi.mock('@/components/team-panel/team-panel-lead-read', () => ({
  readTeamLeadRoster: (...args: unknown[]) => readTeamLeadRoster(...args)
}))
vi.mock('@/components/team-panel/use-team-panel-model', () => ({
  useTeamPanelGame: () => null,
  teamLeadCallerOf: (...args: unknown[]) => teamLeadCallerOf(...args)
}))
vi.mock('@/components/game-inbox/game-owner-questions-client', () => ({
  gameInboxTargetOf: () => ({ kind: 'local' })
}))
vi.mock('./new-tab-stored-lead-read', () => ({
  readStoredTeamLead: (...args: unknown[]) => readStoredTeamLead(...args)
}))

const CALLER = { worktreeId: 'wt-lead', terminalHandle: 'term_lead', paneKey: 'tab-1:pane-1' }

beforeEach(() => {
  readTeamLeadRoster.mockReset().mockResolvedValue({ leads: [], restoring: [] })
  teamLeadCallerOf.mockReset().mockReturnValue(null)
  readStoredTeamLead.mockReset().mockResolvedValue(null)
})

// Why (ORCA-717): the + menu reads the host's leads itself; the panel's poll may be 20 s old.
describe('useNewTabTeamMenu', () => {
  it("offers nothing about a team until the host's leads answer", () => {
    readTeamLeadRoster.mockReturnValue(new Promise(() => undefined))

    const { result } = renderHook(() => useNewTabTeamMenu('wt-1'))

    expect(result.current.state).toEqual({ kind: 'pending' })
    expect(result.current.projectName).toBe('orca-oss')
  })

  it("reads the project's leads once against this project's workspaces", async () => {
    const { result } = renderHook(() => useNewTabTeamMenu('wt-1'))

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'no-team' }))
    expect(readTeamLeadRoster).toHaveBeenCalledTimes(1)
    expect(teamLeadCallerOf).toHaveBeenCalledWith(
      { leads: [], restoring: [] },
      new Set(['wt-1', 'wt-lead'])
    )
  })

  it('offers Reopen with the account the kept lead reopens on when no lead is live', async () => {
    readStoredTeamLead.mockResolvedValue({ accountId: 'acct-glm' })

    const { result } = renderHook(() => useNewTabTeamMenu('wt-1'))

    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: 'lead-closed', accountId: 'acct-glm' })
    )
    expect(readStoredTeamLead).toHaveBeenCalledWith({ kind: 'local' }, 'wt-1')
  })

  it('goes to the live lead and never asks for the kept one', async () => {
    teamLeadCallerOf.mockReturnValue(CALLER)

    const { result } = renderHook(() => useNewTabTeamMenu('wt-1'))

    await waitFor(() => expect(result.current.state.kind).toBe('lead-live'))
    expect(readStoredTeamLead).not.toHaveBeenCalled()
  })

  it("starts a team as today when the host's leads cannot be read", async () => {
    readTeamLeadRoster.mockRejectedValue(new Error('offline'))
    readStoredTeamLead.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useNewTabTeamMenu('wt-1'))

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'no-team' }))
  })
})
