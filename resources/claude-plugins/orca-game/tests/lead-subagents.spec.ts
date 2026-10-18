import { describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { countsOf, partyOf } from '../hooks/party'
import {
  STALE_MS,
  leadSubagentsOf,
  noteSubagentCall,
  noteSubagentDone,
  withLeadSubagents
} from '../hooks/lead-subagents'

const NOW = 1_000_000

const STATE: GameState = {
  config: {},
  warnings: [],
  worktree: null,
  agents: [],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead'
}

const leadOnly = (): GameAgent[] => [
  {
    paneKey: 'lead-pane',
    displayName: 'lead',
    agentType: 'claude',
    state: 'working',
    toolName: 'Bash',
    isLeader: true
  }
]

describe('withLeadSubagents', () => {
  it('counts a running lead subagent as working, so the band is not empty', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)

    const state = withLeadSubagents({ ...STATE, agents: leadOnly() }, running, NOW, true)

    expect(countsOf(state.agents).working).toBe(1)
    expect(partyOf(state, false)).toHaveLength(1)
  })

  it('drops a subagent once its turn completes', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)
    noteSubagentDone(running, 'sub-1')

    const state = withLeadSubagents({ ...STATE, agents: leadOnly() }, running, NOW, true)

    expect(countsOf(state.agents).working).toBe(0)
  })

  it('drops a subagent with no call for STALE_MS, so a lost completion cannot stick', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)

    const state = withLeadSubagents(
      { ...STATE, agents: leadOnly() },
      running,
      NOW + STALE_MS,
      true
    )

    expect(countsOf(state.agents).working).toBe(0)
  })

  it('leaves a plain Agent Teams lead untouched, since its subagents are not refused there', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)
    const plain: GameState = { ...STATE, agents: leadOnly() }

    expect(withLeadSubagents(plain, running, NOW, false)).toBe(plain)
  })

  it('leaves a member session untouched, since members run their own subagents', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)
    const member: GameState = { ...STATE, role: 'member', agents: leadOnly() }

    expect(withLeadSubagents(member, running, NOW, true)).toBe(member)
  })

  it('leaves a session untouched when the role is unknown', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)
    const plain: GameState = { ...STATE, role: undefined, agents: leadOnly() }

    expect(withLeadSubagents(plain, running, NOW, true)).toBe(plain)
  })

  it('never lists a subagent as the lead or as a member with a terminal', () => {
    const running = leadSubagentsOf()
    noteSubagentCall(running, 'sub-1', 'Read', NOW)

    const row = withLeadSubagents({ ...STATE, agents: leadOnly() }, running, NOW, true).agents.find(
      (agent) => !agent.isLeader
    )

    expect(row?.isLeader).toBe(false)
    expect(row?.isMember).not.toBe(true)
    expect(row?.terminalHandle).toBeUndefined()
  })
})
