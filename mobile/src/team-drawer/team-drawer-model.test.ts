import { describe, expect, it } from 'vitest'
import {
  leadOwnerQuestionsOf,
  teamBadgeOf,
  teamLeadViewOf,
  type TeamMemberRow
} from './team-drawer-model'

const member = (over: Record<string, unknown> = {}) => ({
  paneKey: 'tab-2:leaf',
  displayName: 'Cipher Wren',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

const leadState = (over: Record<string, unknown> = {}) => ({
  role: 'lead',
  lead: { autostart: false, cap: 4, agent: 'claude' },
  agents: [member()],
  ...over
})

const row = (over: Partial<TeamMemberRow> = {}): TeamMemberRow => ({
  key: 'k',
  name: 'n',
  ticket: null,
  title: null,
  state: 'working',
  needsYou: false,
  host: null,
  agent: null,
  model: null,
  pr: null,
  ticketStatus: null,
  ...over
})

describe('teamLeadViewOf', () => {
  it('is null unless the pane is the live lead of a project with a lead', () => {
    expect(teamLeadViewOf(null)).toBeNull()
    expect(teamLeadViewOf(leadState({ role: 'member' }))).toBeNull()
    expect(teamLeadViewOf(leadState({ role: undefined }))).toBeNull()
    expect(teamLeadViewOf(leadState({ lead: undefined }))).toBeNull()
    expect(teamLeadViewOf(leadState({ leadElsewhere: { handle: 'term_other' } }))).toBeNull()
    expect(teamLeadViewOf(leadState())).not.toBeNull()
  })

  it('lists only members, with ticket, PR, host and model', () => {
    const view = teamLeadViewOf(
      leadState({
        agents: [
          member({ paneKey: 'lead', isLeader: true, isMember: undefined }),
          member({
            workItem: {
              provider: 'plane',
              identifier: 'orca-952',
              title: 'Team drawer',
              url: 'u',
              status: 'In Progress',
              statusGroup: 'started'
            },
            review: {
              provider: 'github',
              number: 850,
              title: 't',
              url: 'https://pr',
              state: 'open',
              ci: 'pending'
            },
            remote: { host: 'iMac', stateKnown: true },
            launch: { model: 'opus', effort: null }
          })
        ]
      })
    )
    expect(view?.members).toEqual([
      {
        key: 'tab-2:leaf',
        name: 'Cipher Wren',
        ticket: 'ORCA-952',
        title: 'Team drawer',
        state: 'working',
        needsYou: false,
        host: 'iMac',
        agent: 'claude',
        model: 'opus',
        pr: { number: 850, url: 'https://pr', state: 'open', ci: 'pending' },
        ticketStatus: 'In Progress'
      }
    ])
  })

  it('drops malformed agents and missing optional fields instead of failing', () => {
    const view = teamLeadViewOf(
      leadState({ agents: [42, { paneKey: 7 }, member({ review: 'bad', workItem: {} })] })
    )
    expect(view?.members).toHaveLength(1)
    expect(view?.members[0]).toMatchObject({ pr: null, ticket: null, ticketStatus: null })
  })

  it('takes the ticket from the member name before one is linked', () => {
    const view = teamLeadViewOf(leadState({ agents: [member({ displayName: 'ORCA-12 worker' })] }))
    expect(view?.members[0].ticket).toBe('ORCA-12')
  })

  it('sorts needs-you first: a ticket with an open question, then waiting, then working, idle, done', () => {
    const agents = [
      member({ paneKey: 'done', state: 'done' }),
      member({ paneKey: 'idle', state: 'idle' }),
      member({ paneKey: 'working', state: 'working' }),
      member({ paneKey: 'waiting', state: 'waiting' }),
      member({ paneKey: 'asked', state: 'working', displayName: 'ORCA-7' })
    ]
    const view = teamLeadViewOf(leadState({ agents }), new Set(['ORCA-7']))
    expect(view?.members.map((one) => [one.key, one.needsYou])).toEqual([
      ['asked', true],
      ['waiting', true],
      ['working', false],
      ['idle', false],
      ['done', false]
    ])
  })

  it('summarises metrics when the host sends them, and omits them otherwise', () => {
    expect(teamLeadViewOf(leadState())?.metrics).toBeNull()
    const view = teamLeadViewOf(
      leadState({
        metrics: {
          computedAt: 'x',
          timezone: 'UTC',
          mergedPerDay: [
            { day: '2026-11-01', merged: 3 },
            { day: '2026-11-02', merged: 2 }
          ],
          leadTime: { medianMs: 3_600_000, measured: 5 }
        }
      })
    )
    expect(view?.metrics).toEqual({
      latestDay: { day: '2026-11-02', merged: 2 },
      mergedInWindow: 5,
      windowDays: 2,
      leadTimeMedianMs: 3_600_000
    })
  })
})

describe('teamBadgeOf', () => {
  it('shows open questions first, else working members, else nothing', () => {
    const working = [row(), row({ state: 'idle' }), row()]
    expect(teamBadgeOf(2, working)).toEqual({ tone: 'question', count: 2 })
    expect(teamBadgeOf(0, working)).toEqual({ tone: 'working', count: 2 })
    expect(teamBadgeOf(0, [row({ state: 'done' })])).toBeNull()
  })
})

describe('leadOwnerQuestionsOf', () => {
  const question = {
    id: 'q1',
    ticket: null,
    question: 'Ship?',
    options: [],
    context: null,
    askedAt: '2026-11-02T10:00:00.000Z',
    answer: null
  }

  it("returns the lead's own repo's questions and the worktree that answers them", () => {
    const projects = [
      { repoId: 'other', repoName: 'o', worktreeId: 'other::/a', questions: [question] },
      { repoId: 'repo1', repoName: 'r', worktreeId: 'repo1::/main', questions: [question] }
    ]
    expect(leadOwnerQuestionsOf(projects, 'repo1::/lead')).toEqual({
      worktreeId: 'repo1::/main',
      questions: [question]
    })
    expect(leadOwnerQuestionsOf(projects, 'none::/x')).toEqual({ worktreeId: null, questions: [] })
  })
})
