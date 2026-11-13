import { describe, expect, it } from 'vitest'
import { hostLeadCallersOf, hostTeamLineOf, hostTeamLineText } from './host-team-line'

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

  it('has no line when no state is a live lead with a team', () => {
    expect(hostTeamLineOf([])).toBeNull()
    expect(hostTeamLineOf([{ role: 'member' }])).toBeNull()
  })
})

describe('hostTeamLineText', () => {
  it('names the members and who works, and leaves needs-you to its own mark', () => {
    expect(hostTeamLineText({ members: 4, working: 2, needsYou: 1 })).toBe('4 members · 2 working')
    expect(hostTeamLineText({ members: 1, working: 0, needsYou: 0 })).toBe('1 member')
  })
})
