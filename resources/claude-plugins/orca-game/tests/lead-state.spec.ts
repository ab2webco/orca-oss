import { beforeEach, describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { gameStrings, setGameLocale } from '../hooks/game-strings'
import { memberDoingOf } from '../hooks/fleet-member-card'
import { cardStateOf, leadStateOf } from '../hooks/lead-state'
import { memberOf } from '../hooks/party'
import { sceneOf } from '../hooks/scenes/index'
import { moodMarkOf } from '../hooks/party-sprites'

const agent = (patch: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'a',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  ...patch
})

const MERGED = {
  provider: 'github',
  number: 7,
  title: 't',
  url: 'https://github.com/o/r/pull/7',
  state: 'merged',
  ci: 'success'
} as const

const state = (agents: GameAgent[], patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents,
  review: MERGED,
  workItem: null,
  role: 'lead',
  ...patch
})

const LEAD_DONE = agent({ paneKey: 'lead', displayName: 'Alfred', state: 'done', isLeader: true })
const LEAD_WORKING = agent({ paneKey: 'lead', displayName: 'Alfred', isLeader: true })
const BUILDER = agent({ paneKey: 'm1', displayName: 'builder', toolName: 'Edit' })
const DONE_MEMBER = agent({ paneKey: 'm2', displayName: 'scribe', state: 'done' })

beforeEach(() => {
  setGameLocale('en')
})

describe('the lead card while its members work', () => {
  it('a lead whose turn ended is orchestrating, not done or asleep, while a member works', () => {
    const fleet = state([LEAD_DONE, BUILDER])
    const lead = memberOf(LEAD_DONE, fleet, true)
    expect(lead).toMatchObject({ state: 'working', isDone: false, mood: 'none' })
    expect(lead.phase).not.toBe('handoff')
    expect(moodMarkOf(lead.state, lead.mood, 0)).toBeUndefined()
  })

  it('a member waiting on the person keeps the lead awake too', () => {
    const fleet = state([LEAD_DONE, agent({ paneKey: 'm1', state: 'waiting' })])
    expect(memberOf(LEAD_DONE, fleet, true)).toMatchObject({ isDone: false, mood: 'none' })
  })

  it('a working lead never snores, even once its own review merged', () => {
    const lead = memberOf(LEAD_WORKING, state([LEAD_WORKING]), true)
    expect(lead.state).toBe('working')
    expect(moodMarkOf(lead.state, lead.mood, 0)).toBeUndefined()
  })

  it('a red CI still hurts the orchestrating lead', () => {
    const fleet = state([LEAD_DONE, BUILDER], {
      review: { ...MERGED, state: 'open', ci: 'failure' }
    })
    expect(memberOf(LEAD_DONE, fleet, true).mood).toBe('hurt')
  })

  it('names the orchestrating state on the card', () => {
    expect(gameStrings().text.agentStates.orchestrating).toBe('orchestrating')
    setGameLocale('es')
    expect(gameStrings().text.agentStates.orchestrating).toBe('orquestando')
  })

  it('control: a done lead with no member at work still sleeps as finished', () => {
    const lead = memberOf(LEAD_DONE, state([LEAD_DONE, DONE_MEMBER]), true)
    expect(lead).toMatchObject({ state: 'idle', isDone: true, phase: 'handoff', mood: 'cheer' })
  })

  it('control: a done member keeps its own finished look while others work', () => {
    const member = memberOf(DONE_MEMBER, state([LEAD_DONE, BUILDER, DONE_MEMBER]), true)
    expect(member).toMatchObject({ state: 'idle', isDone: true, phase: 'handoff', mood: 'cheer' })
  })
})

describe('a lead idle at its prompt with only a Monitor armed (ORCA-719)', () => {
  it('reads asleep, not working, and drops the Monitor activity', () => {
    setGameLocale('es')
    const lead = agent({ ...LEAD_DONE, toolName: 'Monitor' })
    const fleet = state([lead])
    const card = cardStateOf(lead, fleet)

    expect(leadStateOf(fleet)).toBe('sleeping')
    expect(gameStrings().text.agentStates[card]).not.toBe('trabajando')
    expect(memberDoingOf(lead, memberOf(lead, fleet, true), sceneOf(undefined))).not.toMatch(
      /Usando/
    )
  })

  it('control: the same lead mid-turn reads working with the Monitor as its activity', () => {
    setGameLocale('es')
    const lead = agent({ ...LEAD_WORKING, toolName: 'Monitor' })
    const fleet = state([lead])

    expect(gameStrings().text.agentStates[cardStateOf(lead, fleet)]).toBe('trabajando')
    expect(memberDoingOf(lead, memberOf(lead, fleet, true), sceneOf(undefined))).toMatch(
      /Usando Monitor/
    )
  })
})
