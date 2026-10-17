import { describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { limitTagOf } from '../hooks/member-tags'

const NOW = 1_000_000
const MINUTE = 60_000

const stateWith = (agent: Record<string, unknown>) =>
  JSON.stringify({
    agents: [
      {
        paneKey: 'tab-1:m',
        displayName: 'CIN-5',
        agentType: 'codex',
        state: 'idle',
        toolName: null,
        isLeader: false,
        isMember: true,
        ...agent
      }
    ]
  })

describe('member limit', () => {
  it("keeps a member's usage limit and drops a malformed one", () => {
    expect(parseGameState(stateWith({ limit: { resetsAt: NOW } }))?.agents[0]?.limit).toEqual({
      resetsAt: NOW
    })
    expect(parseGameState(stateWith({ limit: { resetsAt: null } }))?.agents[0]?.limit).toEqual({
      resetsAt: null
    })
    expect(parseGameState(stateWith({ limit: 'soon' }))?.agents[0]?.limit).toBeUndefined()
    expect(parseGameState(stateWith({}))?.agents[0]?.limit).toBeUndefined()
  })

  it('says a member is limited and when it is back, in the session language', () => {
    expect(limitTagOf({ resetsAt: NOW + 90 * MINUTE }, NOW)).toBe('limited · back in 1h 30m')
    expect(limitTagOf({ resetsAt: null }, NOW)).toBe('limited')
    setGameLocale('es')
    try {
      expect(limitTagOf({ resetsAt: NOW + 45 * MINUTE }, NOW)).toBe('limitado · vuelve en 45m')
      expect(limitTagOf({ resetsAt: null }, NOW)).toBe('limitado')
    } finally {
      setGameLocale('en')
    }
  })
})
