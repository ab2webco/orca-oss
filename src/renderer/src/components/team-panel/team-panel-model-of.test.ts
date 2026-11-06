import { describe, expect, it, vi } from 'vitest'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamCards } from '../../../../shared/team-panel-member-cards'
import { teamPanelModelOf } from './team-panel-model-of'

const teamCardsOf = vi.fn()
vi.mock('../../../../shared/team-panel-member-cards', () => ({
  teamCardsOf: (...args: unknown[]) => teamCardsOf(...args)
}))

const CARDS = { lead: { paneKey: 'lead' }, members: [{ paneKey: 'm1' }] } as unknown as TeamCards

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

  it('is null when the state has no lead', () => {
    teamCardsOf.mockReturnValue(null)

    expect(teamPanelModelOf(args())).toBeNull()
  })

  it('counts the Inbox from the questions and the lead inboxes it was given', () => {
    teamCardsOf.mockReturnValue(CARDS)
    const questions = [
      question({ id: 'a' }),
      question({ id: 'b' }),
      question({ id: 'c', answer: { text: 'No', at: 'x' } as never })
    ]

    expect(teamPanelModelOf(args({ questions }))?.inbox).toEqual({
      kind: 'ready',
      value: { forYou: 2, waiting: 2, threads: 2, answered: 1 }
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
      metrics: { kind: 'unavailable' },
      prs: null,
      queue: null,
      machines: null
    })
  })
})
