import { describe, expect, it } from 'vitest'
import type { GameAgent, GameReview, OrchestratorGameState } from './orchestrator-game-state'
import { teamCardsOf } from './team-panel-member-cards'
import { teamIdleCiOf } from './team-member-shown-state'
import { teamSceneInputOf } from './team-scene/team-scene-input'

const agent = (over: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: 'tab:leaf',
  displayName: 'Rosalina ORCA-1198',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

const review = (over: Partial<GameReview> = {}): GameReview => ({
  provider: 'github',
  number: 1205,
  title: 'Team sheet colours',
  url: 'https://github.com/o/r/pull/1205',
  state: 'open',
  ci: 'pending',
  ...over
})

const lead = (over: Partial<GameAgent> = {}) =>
  agent({ paneKey: 'lead:leaf', displayName: 'Alfred', isLeader: true, isMember: false, ...over })

const cardsOf = (agents: GameAgent[], leader = lead()) =>
  teamCardsOf({ agents: [leader, ...agents] } as unknown as OrchestratorGameState, new Set())

const memberOf = (one: GameAgent) => cardsOf([one])?.members[0]

// Why (ORCA-1205): the card read "Terminado" for a member whose PR CI was red, beside the scene's red virus.
describe('what a finished turn says about the work', () => {
  it('says CI is red, in the red tone, for a member whose turn ended on a red PR', () => {
    const card = memberOf(agent({ review: review({ ci: 'failure' }) }))
    expect(card).toMatchObject({ condition: 'idle', status: 'failed' })
    expect(card && teamIdleCiOf(card)).toBe('failure')
  })

  it('says CI is running for a member whose turn ended on a pending PR', () => {
    const card = memberOf(agent({ review: review({ ci: 'pending' }) }))
    expect(card).toMatchObject({ condition: 'idle', status: 'idle' })
    expect(card && teamIdleCiOf(card)).toBe('pending')
  })

  it('reads done for a finished turn on green CI, still not green before the merge', () => {
    const card = memberOf(agent({ review: review({ ci: 'success' }) }))
    expect(card).toMatchObject({ condition: 'done', status: 'idle' })
    expect(card && teamIdleCiOf(card)).toBeNull()
  })

  it('reads done and green once merged', () => {
    expect(memberOf(agent({ review: review({ state: 'merged', ci: 'success' }) }))).toMatchObject({
      condition: 'done',
      status: 'done'
    })
  })

  it('reads idle, not done, for a finished turn with no PR', () => {
    expect(memberOf(agent())).toMatchObject({ condition: 'idle', status: 'idle' })
  })

  it('keeps a member fixing its red CI working, its CI on the chip', () => {
    const card = memberOf(agent({ state: 'working', review: review({ ci: 'failure' }) }))
    expect(card).toMatchObject({ condition: 'working', status: 'working' })
    expect(card && teamIdleCiOf(card)).toBeNull()
  })

  it('draws the red CI member resting at its desk, never with the done check', () => {
    const cards = cardsOf([agent({ review: review({ ci: 'failure' }) })])!
    const scene = teamSceneInputOf({ lead: cards.lead, advisor: null, members: cards.members })
    expect(scene.members[0]).toMatchObject({ activity: 'resting', ci: 'failure' })
  })
})

// Why (ORCA-1205): the lead read "Terminado · Coordina 3 agentes" while it waited on working members.
describe('a lead whose turn ended while members work', () => {
  it('waits on the members not finished yet, instead of reading done', () => {
    const cards = cardsOf([
      agent({ paneKey: 'a', state: 'working' }),
      agent({ paneKey: 'b', state: 'waiting', toolName: 'Bash' }),
      agent({ paneKey: 'c', review: review({ ci: 'failure' }) }),
      agent({ paneKey: 'd', review: review({ state: 'merged', ci: 'success' }) })
    ])
    expect(cards?.lead).toMatchObject({ condition: 'idle', waitingOn: 3 })
    const scene = teamSceneInputOf({ lead: cards!.lead, advisor: null, members: cards!.members })
    expect(scene.lead.activity).toBe('resting')
  })

  it('reads done once no member is left to wait on', () => {
    const cards = cardsOf([agent({ review: review({ state: 'merged', ci: 'success' }) })])
    expect(cards?.lead).toMatchObject({ condition: 'done', waitingOn: 0 })
  })

  it('keeps a working lead working', () => {
    const cards = cardsOf([agent({ state: 'working' })], lead({ state: 'working' }))
    expect(cards?.lead).toMatchObject({ condition: 'working', waitingOn: 1 })
  })
})
