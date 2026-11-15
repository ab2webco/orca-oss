import { describe, expect, it, vi } from 'vitest'
import { newTabTeamSectionOf, reopenFailureOf } from './new-tab-team-section'

vi.mock('lucide-react-native', () => ({ Crown: 'Crown', Info: 'Info', RotateCcw: 'RotateCcw' }))

const LEAD = { worktreeId: 'repo-a::/w/main', terminal: 'term_lead', tabId: 'tab-lead' }

function section(team: Parameters<typeof newTabTeamSectionOf>[0]) {
  const onGoToLead = vi.fn()
  const onReopen = vi.fn()
  return {
    built: newTabTeamSectionOf(team, { hostName: 'm1', onGoToLead, onReopen }),
    onGoToLead,
    onReopen
  }
}

describe('newTabTeamSectionOf', () => {
  it('goes to the live lead, naming its desktop', () => {
    const { built, onGoToLead } = section({ kind: 'lead-live', lead: LEAD })

    expect(built?.title).toBe('Team')
    expect(built?.actions.map((a) => [a.label, a.hint])).toEqual([['Go to lead', 'Lead on m1']])
    built?.actions[0].onPress()
    expect(onGoToLead).toHaveBeenCalledWith(LEAD)
  })

  it('reopens the kept lead, naming its account and desktop', () => {
    const { built, onReopen } = section({ kind: 'lead-closed', accountEmail: 'maya@acme.dev' })

    expect(built?.actions.map((a) => [a.label, a.hint])).toEqual([
      ['Reopen team', 'maya@acme.dev on m1']
    ])
    built?.actions[0].onPress()
    expect(onReopen).toHaveBeenCalled()
  })

  it('names only the desktop for a kept lead on the default login', () => {
    const { built } = section({ kind: 'lead-closed', accountEmail: null })

    expect(built?.actions[0].hint).toBe('m1')
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

// Why: the same answers the desktop's Reopen team gives (ORCA-717).
describe('reopenFailureOf', () => {
  it('reads each answer the way the desktop does', () => {
    expect(reopenFailureOf({ kind: 'lead' })).toBeNull()
    expect(reopenFailureOf({ kind: 'failed', reason: 'no session' })).toBe(
      'Could not reopen the team: no session'
    )
    expect(reopenFailureOf({ kind: 'nothing-kept' })).toBe('No kept lead to reopen')
    expect(reopenFailureOf({ kind: 'unsupported' })).toBe('This host cannot reopen the team')
  })
})
