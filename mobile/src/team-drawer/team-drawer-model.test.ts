import { describe, expect, it } from 'vitest'
import {
  formatLeadTime,
  leadOwnerQuestionsOf,
  teamAgeText,
  teamLeadViewOf,
  teamPeekOf,
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
  live: null,
  since: null,
  account: null,
  limit: null,
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
        pr: {
          number: 850,
          url: 'https://pr',
          state: 'open',
          ci: 'pending',
          ciHistory: [],
          comments: null
        },
        ticketStatus: 'In Progress',
        live: null,
        since: null,
        account: null,
        limit: null
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

describe('live card facts', () => {
  const one = (over: Record<string, unknown>, state: Record<string, unknown> = {}) =>
    teamLeadViewOf(leadState({ agents: [member(over)], ...state }))?.members[0]

  it('names the running tool with its input, and a running MCP link by its id', () => {
    expect(one({ toolName: 'Bash', toolInput: 'gh pr checks 924' })?.live).toBe(
      'Bash · gh pr checks 924'
    )
    expect(one({ toolName: 'mcp__plugin_engram_engram__mem_save' })?.live).toBe('engram: mem save')
    const activity = { name: 'Plane', id: 'ORCA-1', url: 'u', at: 1, running: true }
    expect(one({ toolName: 'Bash', activity })?.live).toBe('Plane · ORCA-1')
  })

  // Why: a worker's Bash line carries its dispatch capability, a bearer secret.
  it('redacts a dispatch capability from the tool input', () => {
    expect(one({ toolName: 'Bash', toolInput: 'orca send --cap dcap_Ab-9_x ok' })?.live).toBe(
      'Bash · orca send --cap [redacted] ok'
    )
  })

  it('shows no tool once the member stopped, or for the question tool', () => {
    expect(one({ state: 'idle', toolName: 'Bash' })?.live).toBeNull()
    expect(one({ state: 'waiting', toolName: 'AskUserQuestion' })?.live).toBeNull()
  })

  it("keeps when the state began, the account's quota and a limit or logout", () => {
    const row = one(
      {
        stateSince: 1_000,
        account: { provider: 'claude', id: 'a1', email: 'dev@example.com' },
        limit: { resetsAt: 9_000 }
      },
      { metrics: { claudeAccounts: [{ email: 'dev@example.com', sessionPercent: 37 }] } }
    )
    expect(row).toMatchObject({
      since: 1_000,
      account: { email: 'dev@example.com', usedPercent: 37 },
      limit: { resetsAt: 9_000, loggedOut: false }
    })
    expect(one({ limit: { resetsAt: null, loggedOut: true } })?.limit).toEqual({
      resetsAt: null,
      loggedOut: true
    })
    expect(one({ account: { email: 'x@y.z' } })?.account).toEqual({
      email: 'x@y.z',
      usedPercent: null
    })
  })

  it("reads the PR's CI per head and its comment threads", () => {
    const review = {
      number: 9,
      url: 'https://pr',
      state: 'open',
      ci: 'success',
      ciHistory: [{ headSha: 'a', ci: 'failure' }, { headSha: 'b', ci: 'success' }, { bad: true }],
      commentCount: 3
    }
    expect(one({ review })?.pr).toMatchObject({ ciHistory: ['failure', 'success'], comments: 3 })
  })
})

describe('teamPeekOf', () => {
  it('counts who needs you first, then who works', () => {
    const view = (members: TeamMemberRow[]) => ({ members, metrics: null })
    expect(teamPeekOf(view([row({ state: 'waiting', needsYou: true })]), 0)).toEqual({
      tone: 'question',
      text: '1 needs you'
    })
    // Why: a waiting member on a ticket with an open question is one ask, not two.
    expect(
      teamPeekOf(view([row({ state: 'waiting', needsYou: true, ticket: 'ORCA-7' })]), 1, ['ORCA-7'])
    ).toEqual({ tone: 'question', text: '1 needs you' })
    expect(teamPeekOf(view([row({ state: 'waiting', needsYou: true })]), 2).text).toBe('3 need you')
    expect(teamPeekOf(view([row(), row(), row({ state: 'idle' })]), 0)).toEqual({
      tone: 'working',
      text: '2 working · 3 members'
    })
    expect(teamPeekOf(view([]), 0)).toEqual({ tone: 'idle', text: 'No members running' })
  })
})

describe('teamAgeText', () => {
  it('reads now, minutes, hours or days since a state began', () => {
    expect(teamAgeText(0, 30_000)).toBe('now')
    expect(teamAgeText(0, 10 * 60_000)).toBe('10 min')
    expect(teamAgeText(0, 13 * 3_600_000)).toBe('13 h')
    expect(teamAgeText(0, 75 * 3_600_000)).toBe('3 d')
  })
})

describe('formatLeadTime', () => {
  it('reads in minutes, hours or days', () => {
    expect(formatLeadTime(5 * 60_000)).toBe('5 min')
    expect(formatLeadTime(3.25 * 3_600_000)).toBe('3.3 h')
    expect(formatLeadTime(72 * 3_600_000)).toBe('3.0 d')
  })
})
