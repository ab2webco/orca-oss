import { describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { setGameLocale } from '../hooks/game-strings'
import { countsOf, fleetPhaseOf, needsOf, partyOf, worktreePhaseOf } from '../hooks/party'

const agent = (patch: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'a',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  ...patch
})

const state = (patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents: [],
  review: null,
  workItem: null,
  ...patch
})

const REVIEW = {
  provider: 'gitlab',
  number: 3,
  title: 't',
  url: 'https://gitlab.example/o/r/-/merge_requests/3',
  state: 'open',
  ci: 'failure'
} as const

describe('partyOf', () => {
  it('seats every teammate but the lead, dressed for its tool and doing its action', () => {
    const party = partyOf(
      state({
        agents: [
          agent({ paneKey: 'lead', displayName: 'lead', isLeader: true }),
          agent({ paneKey: 'p1', displayName: 'builder', toolName: 'Edit' }),
          agent({ paneKey: 'p2', displayName: 'reader', toolName: 'Read', state: 'idle' })
        ]
      }),
      true
    )
    expect(party.map((one) => one.name)).toEqual(['builder', 'reader'])
    expect(party[0]).toMatchObject({
      phase: 'build',
      state: 'working',
      action: 'edit',
      mood: 'none'
    })
    expect(party[0]?.says).toBe('Editing')
    expect(party[1]).toMatchObject({ phase: 'working', state: 'idle', action: undefined })
  })

  it('a red CI hurts the working party, and a finished teammate cheers when rewards are on', () => {
    const agents = [agent({ displayName: 'w' }), agent({ displayName: 'd', state: 'done' })]
    const hurt = partyOf(state({ agents, review: REVIEW }), true)
    expect(hurt.map((one) => one.mood)).toEqual(['hurt', 'cheer'])
    expect(hurt[1]).toMatchObject({ state: 'idle', phase: 'handoff', isDone: true })
    expect(partyOf(state({ agents, review: REVIEW }), false).map((one) => one.mood)).toEqual([
      'hurt',
      'none'
    ])
  })

  it('takes the worktree phase when the tool says nothing', () => {
    const agents = [agent({ toolName: 'Bash' })]
    expect(partyOf(state({ agents, review: { ...REVIEW, ci: 'success' } }), true)[0]?.phase).toBe(
      'pr'
    )
  })
})

describe('worktreePhaseOf', () => {
  it('is pr while a review is open and handoff once it merged or the work item is in review', () => {
    expect(worktreePhaseOf(state())).toBeUndefined()
    expect(worktreePhaseOf(state({ review: REVIEW }))).toBe('pr')
    expect(worktreePhaseOf(state({ review: { ...REVIEW, state: 'merged' } }))).toBe('handoff')
    const workItem = {
      provider: 'linear',
      identifier: 'ENG-1',
      title: 't',
      url: 'u',
      status: 'In Review',
      statusGroup: 'review'
    } as const
    expect(worktreePhaseOf(state({ workItem }))).toBe('handoff')
  })
})

describe('counts and needs', () => {
  it('counts teammates by state and lists who needs the person', () => {
    const agents = [
      agent({ displayName: 'lead', isLeader: true, state: 'waiting' }),
      agent({ displayName: 'x', state: 'waiting' }),
      agent({ displayName: 'y', state: 'done' }),
      agent({ displayName: 'z' })
    ]
    expect(countsOf(agents)).toEqual({ working: 1, idle: 0, waiting: 1, done: 1 })
    expect(needsOf(state({ agents, review: REVIEW }))).toEqual([
      { name: 'x', text: 'waiting on you', url: null },
      { name: '!3', text: 'CI failing', url: REVIEW.url }
    ])
  })

  // Why (ORCA-907): its hooks say idle, but only a person can log its account in again.
  it('counts a member whose account logged out as waiting on the person, and says why', () => {
    const agents = [
      agent({ displayName: 'out', state: 'idle', limit: { resetsAt: null, loggedOut: true } }),
      agent({ displayName: 'capped', state: 'idle', limit: { resetsAt: null } })
    ]
    expect(countsOf(agents)).toEqual({ working: 0, idle: 1, waiting: 1, done: 0 })
    expect(needsOf(state({ agents }))).toEqual([
      { name: 'out', text: 'logged out · /login in its pane', url: null }
    ])
  })

  it("reads a member in its own worktree by that worktree's PR and ticket, not the lead's", () => {
    const worktree = { id: 'wt-8', branch: 'feat/cin-8', displayName: 'cin-8' }
    const merged = { ...REVIEW, number: 8, state: 'merged', ci: 'success' } as const
    const red = { ...REVIEW, number: 9, url: 'https://gitlab.example/o/r/-/merge_requests/9' }
    const agents = [
      agent({
        paneKey: 'm8',
        displayName: 'CIN-8',
        isMember: true,
        worktree,
        review: merged,
        state: 'idle'
      }),
      agent({ paneKey: 'm9', displayName: 'CIN-9', isMember: true, worktree, review: red })
    ]
    const party = partyOf(state({ agents, review: null }), true)
    // Why CIN-9 first: red CI needs the person, so it takes a slot before a merged member.
    expect(party.map((member) => [member.name, member.phase, member.mood])).toEqual([
      ['CIN-9', 'pr', 'hurt'],
      ['CIN-8', 'handoff', 'cheer']
    ])
    expect(needsOf(state({ agents, review: null }))).toEqual([
      { name: 'CIN-9', text: 'CI failing', url: red.url }
    ])
  })

  it('says what is needed, and what a teammate does, in the launch language', () => {
    setGameLocale('es')
    try {
      const agents = [agent({ displayName: 'x', state: 'waiting' }), agent({ state: 'idle' })]
      expect(needsOf(state({ agents, review: REVIEW })).map((need) => need.text)).toEqual([
        'te espera',
        'CI fallando'
      ])
      expect(partyOf(state({ agents }), true).map((member) => member.says)).toEqual([
        'esperando',
        'inactivo'
      ])
    } finally {
      setGameLocale('en')
    }
  })
})

describe('fleetPhaseOf', () => {
  it('is the common phase, handoff once all are done, nothing with no party', () => {
    expect(fleetPhaseOf([])).toBeUndefined()
    expect(
      fleetPhaseOf([
        { phase: 'build', isDone: false },
        { phase: 'build', isDone: false },
        { phase: 'pr', isDone: false }
      ])
    ).toBe('build')
    expect(
      fleetPhaseOf([
        { phase: 'build', isDone: false },
        { phase: 'pr', isDone: false }
      ])
    ).toBe('pr')
    expect(
      fleetPhaseOf([
        { phase: 'pr', isDone: true },
        { phase: 'verify', isDone: true }
      ])
    ).toBe('handoff')
    expect(fleetPhaseOf([{ phase: 'working', isDone: false }])).toBeUndefined()
  })
})
