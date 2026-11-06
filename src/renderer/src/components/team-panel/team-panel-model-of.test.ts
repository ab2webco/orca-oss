import { describe, expect, it, vi } from 'vitest'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamCards } from '../../../../shared/team-panel-member-cards'
import { teamPanelModelOf } from './team-panel-model-of'

const teamCardsOf = vi.fn()
vi.mock('../../../../shared/team-panel-member-cards', () => ({
  teamCardsOf: (...args: unknown[]) => teamCardsOf(...args)
}))

const CARDS = {
  lead: { paneKey: 'lead' },
  members: [{ paneKey: 'm1', host: { kind: 'local' } }]
} as unknown as TeamCards

function question(overrides: Partial<GameOwnerQuestion>): GameOwnerQuestion {
  return {
    id: 'q',
    ticket: null,
    question: 'Merge now?',
    options: [],
    context: null,
    askedAt: '2026-11-06T00:00:00.000Z',
    answer: null,
    ...overrides
  }
}

const state = (overrides: Partial<OrchestratorGameState> = {}): OrchestratorGameState =>
  ({
    role: 'lead',
    agents: [],
    stopped: null,
    inboxes: [
      { key: 'lead', unread: 0, last: null, waiting: [{}, {}] },
      { key: 'ORCA-1', unread: 1, last: null, waiting: [] }
    ],
    ...overrides
  }) as unknown as OrchestratorGameState

const args = (overrides: Partial<Parameters<typeof teamPanelModelOf>[0]> = {}) => ({
  repoId: 'repo-1',
  projectName: 'orca-oss',
  state: state(),
  questions: [] as GameOwnerQuestion[] | null,
  ...overrides
})

describe('teamPanelModelOf', () => {
  it('builds the cards with the tickets that have an open question for the user', () => {
    teamCardsOf.mockReturnValue(CARDS)
    const questions = [
      question({ id: 'a', ticket: 'orca-7' }),
      question({ id: 'b', ticket: 'ORCA-8', answer: { text: 'Yes', at: 'x' } as never })
    ]

    const model = teamPanelModelOf(args({ questions }))

    expect(teamCardsOf.mock.calls.at(-1)?.[1]).toEqual(new Set(['ORCA-7']))
    expect(model).toMatchObject({
      kind: 'team',
      repoId: 'repo-1',
      projectName: 'orca-oss',
      lead: CARDS.lead,
      members: CARDS.members
    })
  })

  it("carries the lead's actions for the dock, empty from a host that sends none", () => {
    teamCardsOf.mockReturnValue(CARDS)
    const actions = [{ id: 'lead:status', label: 'Status', command: 'status', prompt: 'How?' }]

    expect(teamPanelModelOf(args({ state: state({ actions }) }))?.actions).toMatchObject([
      { id: 'lead:status', orca: 'status', icon: 'pulse', send: 'How?' }
    ])
    expect(teamPanelModelOf(args())?.actions).toEqual([])
  })

  it('is null when the state has no lead', () => {
    teamCardsOf.mockReturnValue(null)

    expect(teamPanelModelOf(args())).toBeNull()
  })

  // Why one thread: the lead's own inbox holds what waits on it, not a ticket's thread.
  it('counts the Inbox from the questions and the lead inboxes it was given', () => {
    teamCardsOf.mockReturnValue(CARDS)
    const questions = [
      question({ id: 'a' }),
      question({ id: 'b' }),
      question({ id: 'c', answer: { text: 'No', at: 'x' } as never })
    ]

    expect(teamPanelModelOf(args({ questions }))?.inbox).toEqual({
      kind: 'ready',
      value: { forYou: 2, waiting: 2, threads: 1, answered: 1 }
    })
  })

  it('says the Inbox is unavailable when the host could not list the questions', () => {
    teamCardsOf.mockReturnValue(CARDS)

    expect(teamPanelModelOf(args({ questions: null }))?.inbox).toEqual({ kind: 'unavailable' })
  })

  it('carries the project STOP and leaves out what game.state does not publish', () => {
    teamCardsOf.mockReturnValue(CARDS)

    const model = teamPanelModelOf(
      args({ state: state({ stopped: { since: '2026-11-06', by: 'lead' } }) })
    )

    expect(model).toMatchObject({
      stopped: { since: '2026-11-06', by: 'lead' },
      advisor: null,
      xp: null,
      arcade: null,
      metrics: { kind: 'unavailable' }
    })
  })

  it("fills Display's metrics from the host's published metrics", () => {
    teamCardsOf.mockReturnValue(CARDS)
    const metrics = {
      computedAt: 'x',
      timezone: 'UTC',
      mergedPerDay: [{ day: '2026-11-06', merged: 4 }],
      leadTime: { medianMs: 60_000, measured: 1 }
    }

    expect(teamPanelModelOf(args({ state: state({ metrics }) }))?.metrics).toMatchObject({
      kind: 'ready',
      value: { mergedPerDay: [{ day: '2026-11-06', merged: 4 }], leadTimeMedianMs: 60_000 }
    })
  })
  it("fills the Advisor from the lead's own Jev report, words as written", () => {
    teamCardsOf.mockReturnValue(CARDS)
    const model = teamPanelModelOf(
      args({
        state: state({
          agents: [
            { isLeader: false, advisor: { model: 'Haiku 5.5', effort: null, pinned: {} } },
            {
              isLeader: true,
              advisor: {
                model: 'Opus 5.5',
                effort: 'high',
                line: 'Reviewing the plan',
                pinned: { model: true, effort: false },
                previous: { model: 'Sonnet 5.5', effort: 'high' }
              }
            }
          ]
        } as unknown as Partial<OrchestratorGameState>)
      })
    )

    expect(model?.advisor).toEqual({
      model: 'Opus 5.5',
      effort: 'high',
      line: 'Reviewing the plan',
      pinned: { model: true, effort: false },
      previous: { model: 'Sonnet 5.5', effort: 'high' },
      calls: []
    })
  })

  it("leaves the Advisor empty when only a member's Jev reported, and on an older report", () => {
    teamCardsOf.mockReturnValue(CARDS)
    const only = (leadAdvisor: unknown): Parameters<typeof teamPanelModelOf>[0] =>
      args({
        state: state({
          agents: [
            { isLeader: false, advisor: { model: 'Haiku 5.5', effort: null, pinned: {} } },
            { isLeader: true, ...(leadAdvisor ? { advisor: leadAdvisor } : {}) }
          ]
        } as unknown as Partial<OrchestratorGameState>)
      })

    expect(teamPanelModelOf(only(null))?.advisor).toBeNull()
    expect(
      teamPanelModelOf(
        only({ model: 'Opus 5.5', effort: null, pinned: { model: false, effort: false } })
      )?.advisor
    ).toEqual({
      model: 'Opus 5.5',
      effort: null,
      line: null,
      pinned: { model: false, effort: false },
      previous: null,
      calls: []
    })
  })

  it('reads an older host with no project work or hosts as unavailable tabs', () => {
    teamCardsOf.mockReturnValue(CARDS)

    expect(teamPanelModelOf(args())).toMatchObject({
      prs: { kind: 'unavailable' },
      queue: { kind: 'unavailable' },
      machines: { kind: 'unavailable' }
    })
  })

  it('fills PRs and Machines from the same state', () => {
    teamCardsOf.mockReturnValue(CARDS)
    const reviews = {
      provider: 'github',
      total: 1,
      url: null,
      items: [{ id: '#7', title: 'Fix', url: 'https://example.test/7', status: 'success' }]
    }
    const model = teamPanelModelOf(
      args({
        state: state({
          project: { reviews, todo: null },
          hostCapacity: [{ host: 'm1', running: 1, status: 'unreachable' }]
        })
      })
    )

    expect(model?.prs).toMatchObject({ kind: 'ready', value: { rows: [{ label: '#7' }] } })
    expect(model?.machines).toMatchObject({
      kind: 'ready',
      value: [{ status: 'attention', running: 1 }]
    })
  })

  // Why: the host's copy lags a toggle by a poll and, on a paired host, is that host's settings.
  it("keeps the tabs the host's own panel settings hid; this window's settings decide", () => {
    teamCardsOf.mockReturnValue(CARDS)
    const panel = { tabs: { prs: false, queue: false, machines: false } }
    const model = teamPanelModelOf(
      args({ state: state({ panel } as unknown as Partial<OrchestratorGameState>) })
    )

    expect(model).toMatchObject({
      prs: { kind: 'unavailable' },
      queue: { kind: 'unavailable' },
      machines: { kind: 'unavailable' }
    })
  })

  it('hides PRs in a folder workspace', () => {
    teamCardsOf.mockReturnValue(CARDS)

    expect(teamPanelModelOf(args({ isFolder: true }))?.prs).toBeNull()
  })

  // Why both: Pixel draws a built-in scene by id, else the plugin or file scene the host carried.
  it('carries the scene id and the scene definitions the host sends, for the live scene', () => {
    teamCardsOf.mockReturnValue(CARDS)
    const carried = { id: 'acme.space/orbit', pluginId: 'acme.space', definition: {} }
    const model = teamPanelModelOf(
      args({
        state: state({
          config: { scene: 'acme.space/orbit' },
          extensions: { scenes: [carried] }
        } as unknown as Partial<OrchestratorGameState>)
      })
    )

    expect(model?.scene).toEqual({ id: 'acme.space/orbit', extensions: [carried] })
  })

  it('reads an older host that sends no scene extensions as none, and no scene id as unknown', () => {
    teamCardsOf.mockReturnValue(CARDS)

    expect(teamPanelModelOf(args())?.scene).toEqual({ id: null, extensions: [] })
  })

  it("carries the host's saved plays and the perfect merge that offers one", () => {
    teamCardsOf.mockReturnValue(CARDS)
    const withOffer = state({
      arcade: { credits: 2, offer: { provider: 'github', number: 923 } }
    })
    const kept = state({ arcade: { credits: 3, offer: null } })

    expect(teamPanelModelOf(args({ state: withOffer }))?.arcade).toEqual({
      credits: 2,
      offerPr: 923
    })
    expect(teamPanelModelOf(args({ state: kept }))?.arcade).toEqual({ credits: 3, offerPr: null })
  })

  it('reads a host older than the saved plays as no arcade', () => {
    teamCardsOf.mockReturnValue(CARDS)

    expect(teamPanelModelOf(args())?.arcade).toBeNull()
  })
})
