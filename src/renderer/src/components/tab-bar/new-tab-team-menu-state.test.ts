import { describe, expect, it } from 'vitest'
import type { TeamLeadCard } from '../../../../shared/team-panel-model-types'
import { newTabTeamMenuStateOf, type NewTabTeamMenuInput } from './new-tab-team-menu-state'

const CALLER = { worktreeId: 'wt-lead', terminalHandle: 'term_lead', paneKey: 'tab-1:pane-1' }
const LEAD_CARD = {
  name: 'Alfred',
  paneKey: 'tab-1:pane-1',
  terminalHandle: 'term_lead',
  worktreeId: 'wt-lead',
  host: { kind: 'remote', name: 'mini', environmentId: 'env-1', reachable: true }
} as TeamLeadCard
const TODO = [{ identifier: 'ORCA-9', title: 'Fix it', prompt: 'Work on ORCA-9' }]

const input = (over: Partial<NewTabTeamMenuInput>): NewTabTeamMenuInput => ({
  liveLead: null,
  team: null,
  storedLead: null,
  ...over
})

describe('newTabTeamMenuStateOf (ORCA-717)', () => {
  it('offers to start a team when the project has no lead, live or stored', () => {
    expect(newTabTeamMenuStateOf(input({}))).toEqual({ kind: 'no-team' })
  })

  it("goes to the live lead with the panel's name, ref, To Do and member agent", () => {
    expect(
      newTabTeamMenuStateOf(
        input({
          liveLead: CALLER,
          team: { lead: LEAD_CARD, todo: TODO, memberAgent: 'codex' },
          storedLead: { accountId: 'acct-1' }
        })
      )
    ).toEqual({
      kind: 'lead-live',
      leadName: 'Alfred',
      lead: {
        paneKey: 'tab-1:pane-1',
        terminalHandle: 'term_lead',
        worktreeId: 'wt-lead',
        host: LEAD_CARD.host
      },
      todo: TODO,
      memberAgent: 'codex'
    })
  })

  it("goes to the live lead without the panel's facts when the panel last read another lead", () => {
    expect(
      newTabTeamMenuStateOf(
        input({
          liveLead: CALLER,
          team: {
            lead: { ...LEAD_CARD, paneKey: 'tab-9:pane-9' },
            todo: TODO,
            memberAgent: 'claude'
          }
        })
      )
    ).toEqual({
      kind: 'lead-live',
      leadName: null,
      lead: { ...CALLER, host: { kind: 'local' } },
      todo: [],
      memberAgent: null
    })
  })

  it('offers to reopen the team on the account the kept lead reopens on', () => {
    expect(newTabTeamMenuStateOf(input({ storedLead: { accountId: 'acct-glm' } }))).toEqual({
      kind: 'lead-closed',
      accountId: 'acct-glm'
    })
  })

  it('never offers Reopen when the host cannot say whether a lead is kept', () => {
    expect(newTabTeamMenuStateOf(input({ storedLead: 'unknown' }))).toEqual({ kind: 'no-team' })
  })

  it('offers nothing about a team while the lead restores or the reads have not answered', () => {
    for (const over of [
      { liveLead: 'restoring', storedLead: { accountId: 'acct-1' } },
      { liveLead: 'unread' },
      { storedLead: 'unread' }
    ] as const) {
      expect(newTabTeamMenuStateOf(input(over))).toEqual({ kind: 'pending' })
    }
  })
})
