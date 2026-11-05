// Runs under `claude plugin test`: a member whose lead is on another host draws only itself (ORCA-1044).
import { describe, expect } from 'claude-code/testing'
import { test } from './test-budget'

import type { GameAgent, GameState } from '../types'
import { syncHdTeam } from '../hooks/hd-team'
import { setLaunchRole } from '../hooks/member-pane'
import { resetQuest } from '../hooks/quest-runtime'
import { quest } from '../hooks/quest-state'

const agent = (patch: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'a',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  ...patch
})

// What an older host answers a remote member: role lead, and every session it found on that host.
const olderHostState: GameState = {
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents: [
    agent({ paneKey: 'self', displayName: 'Daisy', isLeader: true }),
    agent({ paneKey: 'f1', displayName: 'Rex', found: true }),
    agent({ paneKey: 'f2', displayName: 'Ivy', found: true })
  ],
  review: null,
  workItem: null,
  role: 'lead'
}

describe('a member whose lead is on another host', () => {
  test('draws no crown and none of the sessions its host found', () => {
    resetQuest()
    setLaunchRole('member')
    try {
      syncHdTeam(olderHostState, true)
      expect(quest.lead).toBe(undefined)
      expect(quest.hdParty.map((one) => one.key)).toEqual([])
    } finally {
      setLaunchRole(null)
    }
  })

  test('control: a lead keeps its crown and the sessions it found', () => {
    resetQuest()
    syncHdTeam(olderHostState, true)
    expect(quest.lead === undefined).toBe(false)
    expect(quest.hdParty.map((one) => one.key)).toEqual(['f1', 'f2'])
  })
})
