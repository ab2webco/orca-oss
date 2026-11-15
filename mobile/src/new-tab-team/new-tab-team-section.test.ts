import { describe, expect, it, vi } from 'vitest'
import { newTabTeamSectionOf } from './new-tab-team-section'

vi.mock('lucide-react-native', () => ({ Crown: 'Crown', Info: 'Info' }))

const LEAD = { worktreeId: 'repo-a::/w/main', terminal: 'term_lead', tabId: 'tab-lead' }

function section(team: Parameters<typeof newTabTeamSectionOf>[0]) {
  const onGoToLead = vi.fn()
  return { built: newTabTeamSectionOf(team, { hostName: 'm1', onGoToLead }), onGoToLead }
}

describe('newTabTeamSectionOf', () => {
  it('goes to the live lead, naming its desktop', () => {
    const { built, onGoToLead } = section({ kind: 'lead-live', lead: LEAD })

    expect(built?.title).toBe('Team')
    expect(built?.actions.map((a) => [a.label, a.hint])).toEqual([['Go to lead', 'Lead on m1']])
    built?.actions[0].onPress()
    expect(onGoToLead).toHaveBeenCalledWith(LEAD)
  })

  it('holds the row while the reads land', () => {
    const { built } = section({ kind: 'pending' })

    expect(built?.actions).toEqual([
      expect.objectContaining({ label: 'Go to lead', disabled: true, loading: true })
    ])
  })

  it('tells an older desktop to update instead of hiding the team', () => {
    const { built } = section({ kind: 'unsupported' })

    expect(built?.actions).toEqual([
      expect.objectContaining({ label: 'Update Orca on m1 to use this', disabled: true })
    ])
  })

  it("keeps today's sheet when the project has no team", () => {
    expect(section({ kind: 'none' }).built).toBeNull()
  })
})
