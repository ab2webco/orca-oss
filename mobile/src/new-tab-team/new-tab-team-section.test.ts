import { describe, expect, it, vi } from 'vitest'
import { newTabTeamSectionOf, reopenFailureOf } from './new-tab-team-section'

vi.mock('lucide-react-native', () => ({
  Crown: 'Crown',
  Info: 'Info',
  RotateCcw: 'RotateCcw',
  UserPlus: 'UserPlus'
}))

const LEAD = { worktreeId: 'repo-a::/w/main', terminal: 'term_lead', tabId: 'tab-lead' }
const TICKET = { identifier: 'ORCA-2', title: 'T', prompt: 'P' }
const roster = (todo: (typeof TICKET)[]) => ({
  todo,
  hosts: [{ on: null, running: 0, cap: 4 }],
  provider: 'claude' as const
})

function section(team: Parameters<typeof newTabTeamSectionOf>[0]) {
  const onGoToLead = vi.fn()
  const onReopen = vi.fn()
  const onAddMember = vi.fn()
  return {
    built: newTabTeamSectionOf(team, { hostName: 'm1', onGoToLead, onReopen, onAddMember }),
    onGoToLead,
    onReopen,
    onAddMember
  }
}

describe('newTabTeamSectionOf', () => {
  it('goes to the live lead, naming its desktop', () => {
    const { built, onGoToLead } = section({ kind: 'lead-live', lead: LEAD, roster: null })

    expect(built?.title).toBe('Team')
    expect(built?.actions[0]).toMatchObject({ label: 'Go to lead', hint: 'Lead on m1' })
    built?.actions[0].onPress()
    expect(onGoToLead).toHaveBeenCalledWith(LEAD)
  })

  it("adds a member from the lead's To Do, counting its tickets", () => {
    const team = { kind: 'lead-live' as const, lead: LEAD, roster: roster([TICKET, TICKET]) }
    const { built, onAddMember } = section(team)

    expect(built?.actions[1]).toMatchObject({ label: 'Add member…', hint: '2 in To Do' })
    built?.actions[1].onPress()
    expect(onAddMember).toHaveBeenCalledWith(team.roster)
  })

  it('holds Add member with an empty To Do, or one the phone could not read', () => {
    const empty = section({ kind: 'lead-live', lead: LEAD, roster: roster([]) }).built
    const unread = section({ kind: 'lead-live', lead: LEAD, roster: null }).built

    expect(empty?.actions[1]).toMatchObject({ hint: 'To Do is empty', disabled: true })
    expect(unread?.actions[1]).toMatchObject({ hint: 'Could not read To Do', disabled: true })
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
