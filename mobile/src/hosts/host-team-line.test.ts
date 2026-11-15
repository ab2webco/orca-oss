import { describe, expect, it } from 'vitest'
import {
  hostLastKnownTeamParts,
  hostLeadCallersOf,
  hostTeamLineOf,
  hostTeamLineParts
} from './host-team-line'

const lead = (agents: unknown[]) => ({ role: 'lead', lead: { handle: 'term_lead' }, agents })
const agent = (name: string, state: string, extra: Record<string, unknown> = {}) => ({
  name,
  state,
  ...extra
})

describe('hostLeadCallersOf', () => {
  it('reads each live lead that names its worktree and pane', () => {
    expect(
      hostLeadCallersOf({
        leads: [
          { project: 'web', handle: 'term_a', paneKey: 'tab:a', worktreeId: 'wt-a' },
          { project: 'api', handle: 'term_b', paneKey: 'tab:b' },
          { project: 'cli', handle: 'term_c', worktreeId: 'wt-c' }
        ]
      })
    ).toEqual([{ worktreeId: 'wt-a', terminalHandle: 'term_a', paneKey: 'tab:a' }])
  })

  it('reads no lead from an answer it does not recognise', () => {
    expect(hostLeadCallersOf(null)).toEqual([])
    expect(hostLeadCallersOf({ leads: 'none' })).toEqual([])
  })
})

describe('hostTeamLineOf', () => {
  it("adds up every lead's members, who is working and who needs you", () => {
    expect(
      hostTeamLineOf([
        lead([agent('Merlín', 'waiting'), agent('Arquera', 'working')]),
        lead([agent('Mago', 'working'), agent('Castillo', 'idle')])
      ])
    ).toEqual({ members: 4, working: 2, needsYou: 1 })
  })

  // Why: the host lists the lead's own pane among its agents, even an idle lead it never heard from.
  it("leaves the lead's own row out of the members", () => {
    expect(
      hostTeamLineOf([
        lead([agent('Lead', 'working', { isLeader: true }), agent('Arquera', 'waiting')])
      ])
    ).toEqual({ members: 1, working: 0, needsYou: 1 })
  })

  it('has no line when no state is a live lead with a team', () => {
    expect(hostTeamLineOf([])).toBeNull()
    expect(hostTeamLineOf([{ role: 'member' }])).toBeNull()
  })
})

describe('hostTeamLineParts', () => {
  it('names the members and who works as separate pieces, and leaves needs-you to its own mark', () => {
    expect(hostTeamLineParts({ members: 4, working: 2, needsYou: 1 })).toEqual([
      '4 members',
      '2 working'
    ])
    expect(hostTeamLineParts({ members: 1, working: 0, needsYou: 0 })).toEqual(['1 member'])
  })
})

describe('hostLastKnownTeamParts', () => {
  it('gives the label its own piece, so no piece is wider than a 320 card row', () => {
    expect(hostLastKnownTeamParts({ members: 6, working: 2, needsYou: 1 })).toEqual([
      'Last known:',
      '6 members',
      '2 working'
    ])
    expect(hostLastKnownTeamParts({ members: 1, working: 0, needsYou: 0 })).toEqual([
      'Last known:',
      '1 member'
    ])
  })
})
