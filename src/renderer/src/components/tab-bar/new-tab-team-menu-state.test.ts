import { describe, expect, it } from 'vitest'
import { newTabTeamMenuStateOf } from './new-tab-team-menu-state'

describe('newTabTeamMenuStateOf (ORCA-717)', () => {
  it('offers to start a team when the project has no lead, live or stored', () => {
    expect(newTabTeamMenuStateOf({ liveLead: null, storedLead: null })).toEqual({ kind: 'no-team' })
  })

  it('offers to go to the live lead instead of starting another team', () => {
    expect(
      newTabTeamMenuStateOf({
        liveLead: { name: 'Alfred', paneKey: 'tab-1:pane-1' },
        storedLead: { accountLabel: 'Claude 1' }
      })
    ).toEqual({ kind: 'lead-live', leadName: 'Alfred', leadPaneKey: 'tab-1:pane-1' })
  })

  it('offers to reopen the team when only a stored lead conversation is left', () => {
    expect(
      newTabTeamMenuStateOf({ liveLead: null, storedLead: { accountLabel: 'Claude GLM' } })
    ).toEqual({ kind: 'lead-closed', leadAccountLabel: 'Claude GLM' })
  })

  it('never offers Reopen when the host cannot say whether a lead is stored', () => {
    expect(newTabTeamMenuStateOf({ liveLead: null, storedLead: 'unknown' })).toEqual({
      kind: 'no-team'
    })
  })

  it('offers neither Reopen nor Start fresh while the lead is restoring', () => {
    expect(
      newTabTeamMenuStateOf({ liveLead: 'restoring', storedLead: { accountLabel: 'Claude 1' } })
    ).toEqual({ kind: 'no-team' })
  })
})
