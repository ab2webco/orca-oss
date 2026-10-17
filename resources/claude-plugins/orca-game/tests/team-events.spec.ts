import { describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { setGameLocale } from '../hooks/game-strings'
import { teamEventsOf } from '../hooks/team-events'

const agent = (displayName: string, state: GameAgent['state'], isLeader = false): GameAgent => ({
  paneKey: `p:${displayName}`,
  displayName,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader
})

const RED = {
  provider: 'github',
  number: 7,
  title: 't',
  url: 'https://github.com/o/r/pull/7',
  state: 'open',
  ci: 'failure'
} as const

const state = (patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents: [agent('lead', 'working', true)],
  review: null,
  workItem: null,
  ...patch
})

describe('team events from two refreshes', () => {
  it('plays nothing on the first refresh, whatever is already red or waiting', () => {
    setGameLocale('en')
    const now = state({
      agents: [agent('lead', 'working', true), agent('ana', 'waiting')],
      review: RED
    })
    expect(teamEventsOf(null, now)).toEqual([])
  })

  it('plays CI turning red and a teammate starting to wait, once each', () => {
    setGameLocale('en')
    const before = state({ agents: [agent('lead', 'working', true), agent('ana', 'working')] })
    const now = state({
      agents: [agent('lead', 'working', true), agent('ana', 'waiting')],
      review: RED
    })
    expect(teamEventsOf(before, now)).toEqual([
      { kind: 'fail', text: 'CI is red' },
      { kind: 'needs', text: 'ana needs you!' }
    ])
    expect(teamEventsOf(now, now)).toEqual([])
  })
})
