import { describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { hudGridOf, hudLineOf } from '../hooks/fleet-hud'
import { gameStateOf } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { ghostCountOf, partyOf, teamOrderOf } from '../hooks/party'
import { sceneOf } from '../hooks/scenes/index'
import { glyphs } from './grid-digest'

const agent = (patch: Partial<GameAgent>): GameAgent => ({
  paneKey: patch.displayName ?? 'p',
  displayName: 'a',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...patch
})

const state = (agents: GameAgent[]): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents,
  review: null,
  workItem: null
})

const silent = (host: string) => ({ host, stateKnown: false })
const live = (host: string) => ({ host, stateKnown: true })

// The lead's game on 2026-10-30 (ORCA-886): the host lists the gone members first.
const LIVE_GAME = state([
  agent({ displayName: 'lead', isLeader: true, isMember: false }),
  agent({ displayName: 'ORCA-854', state: 'idle', remote: silent('imac') }),
  agent({ displayName: 'ORCA-855', state: 'idle', remote: silent('imac') }),
  agent({ displayName: 'ORCA-857', state: 'idle', remote: silent('imac') }),
  agent({ displayName: 'ORCA-861a', state: 'done', remote: silent('m1') }),
  agent({ displayName: 'ORCA-861b', state: 'done', remote: silent('m1') }),
  agent({ displayName: 'Notch', state: 'done' }),
  agent({ displayName: 'Agnes', activeAt: 1_000 }),
  agent({ displayName: 'Zuri', remote: live('imac'), activeAt: 4_000 }),
  agent({ displayName: 'Steve', remote: live('imac'), activeAt: 3_000 }),
  agent({ displayName: 'Alex', remote: live('imac'), activeAt: 2_000 })
])

const namesOf = (members: readonly { name: string }[]) => members.map((one) => one.name)

describe('the band fills its slots by priority (ORCA-886)', () => {
  it('draws the working members first, most recent first, and never a ghost', () => {
    expect(namesOf(partyOf(LIVE_GAME, true))).toEqual(['Zuri', 'Steve', 'Alex', 'Agnes', 'Notch'])
    expect(ghostCountOf(LIVE_GAME)).toBe(5)
  })

  it('needs-you, then working, then idle, then done', () => {
    const team = state([
      agent({ displayName: 'done', state: 'done', activeAt: 9_000 }),
      agent({ displayName: 'idle', state: 'idle', activeAt: 8_000 }),
      agent({ displayName: 'working', activeAt: 7_000 }),
      agent({ displayName: 'waiting', state: 'waiting', activeAt: 1_000 }),
      agent({
        displayName: 'red-ci',
        worktree: { id: 'w', branch: 'b', displayName: 'b' },
        review: {
          provider: 'github',
          number: 1,
          title: 't',
          url: 'https://github.example/o/r/pull/1',
          state: 'open',
          ci: 'failure'
        }
      })
    ])
    expect(namesOf(partyOf(team, true))).toEqual(['waiting', 'red-ci', 'working', 'idle', 'done'])
  })

  it('keeps the host order among members with no activity time', () => {
    const team = state([agent({ displayName: 'a' }), agent({ displayName: 'b', activeAt: 5 })])
    expect(namesOf(partyOf(team, true))).toEqual(['b', 'a'])
    expect(
      namesOf(partyOf(state([agent({ displayName: 'a' }), agent({ displayName: 'b' })]), true))
    ).toEqual(['a', 'b'])
  })

  it('a remote member gone before it finished is a ghost; one that finished is drawn as done', () => {
    const team = state([
      agent({ displayName: 'gone', remote: { host: 'imac', stateKnown: true, gone: true } }),
      agent({
        displayName: 'finished',
        state: 'done',
        remote: { host: 'imac', stateKnown: true, gone: true }
      })
    ])
    expect(namesOf(partyOf(team, true))).toEqual(['finished'])
    expect(ghostCountOf(team)).toBe(1)
  })

  it('the Panel lists the same order, the lead first and the ghosts last', () => {
    expect(teamOrderOf(LIVE_GAME).map((one) => one.displayName)).toEqual([
      'lead',
      'Zuri',
      'Steve',
      'Alex',
      'Agnes',
      'Notch',
      'ORCA-854',
      'ORCA-855',
      'ORCA-857',
      'ORCA-861a',
      'ORCA-861b'
    ])
  })
})

describe('the +N counts every member the band could not draw', () => {
  const party = partyOf(LIVE_GAME, true)

  it('in the framed band: two slots drawn, three more and five ghosts hidden', () => {
    setGameLocale('en')
    const drawn = glyphs(hudGridOf(sceneOf('quest'), party, 60, 0, { unseen: 5 }))
    expect(drawn).toContain('Zuri')
    expect(drawn).toContain('Steve')
    expect(drawn).not.toContain('ORCA-854')
    expect(drawn).toContain('+8')
  })

  it('in a narrow frame the +N keeps its place and the XP text gives way', () => {
    setGameLocale('en')
    const level = { level: 1, into: 0, need: 100 }
    const top = glyphs(hudGridOf(sceneOf('quest'), party, 40, 0, { unseen: 5, level })).slice(0, 40)
    expect(top).toContain('+9')
    expect(top).toContain('Lv 1')
  })

  it('in the one-line band', () => {
    setGameLocale('en')
    const line = hudLineOf(party, 200, { unseen: 5 })
    expect(line.indexOf('Zuri')).toBeLessThan(line.indexOf('Agnes'))
    expect(line).not.toContain('ORCA-854')
    expect(line).toMatch(/\+5$/)
    const narrow = hudLineOf(party, 24, { unseen: 5 })
    expect(narrow).toContain('Zuri')
    expect(narrow).toMatch(/\+\d+$/)
  })
})

describe('the host activity time', () => {
  it('is the later of the last work seen and the state start', () => {
    const parsed = gameStateOf({
      ...state([]),
      agents: [
        {
          paneKey: 'a',
          displayName: 'a',
          agentType: 'claude',
          state: 'working',
          toolName: null,
          isLeader: false,
          lastActivityAt: '2026-10-30T10:00:00.000Z',
          stateSince: Date.parse('2026-10-30T09:00:00.000Z')
        },
        {
          paneKey: 'b',
          displayName: 'b',
          agentType: 'claude',
          state: 'working',
          toolName: null,
          isLeader: false,
          lastActivityAt: 'not a date',
          stateSince: Date.parse('2026-10-30T11:00:00.000Z')
        },
        { paneKey: 'c', displayName: 'c', agentType: 'claude', state: 'idle', isLeader: false }
      ]
    })
    expect(parsed?.agents.map((one) => one.activeAt)).toEqual([
      Date.parse('2026-10-30T10:00:00.000Z'),
      Date.parse('2026-10-30T11:00:00.000Z'),
      undefined
    ])
    // Why: the band re-reads the state it stored, which carries the parsed time, not the host's.
    expect(gameStateOf(parsed)?.agents.map((one) => one.activeAt)).toEqual(
      parsed?.agents.map((one) => one.activeAt)
    )
  })
})
