import { describe, expect, it } from 'vitest'
import type { GameActivity } from '../../shared/orchestrator-game-state'
import { GameActivityMemory } from './orchestrator-game-activity-memory'

const activity = (id: string, at: number, running = false): GameActivity => ({
  name: 'Tambora',
  id,
  url: `https://tambora.example/testruns/${id}`,
  at,
  running
})

describe('GameActivityMemory', () => {
  it('answers the newest match and keeps it once the call leaves the recent calls', () => {
    const memory = new GameActivityMemory()
    expect(memory.recall('tab:qa', activity('TR-1', 5, true))).toEqual(activity('TR-1', 5, true))
    // Why: a call that left the log already ended, so it is never shown as running.
    expect(memory.recall('tab:qa', null)).toEqual(activity('TR-1', 5, false))
  })

  it('replaces the remembered activity with a newer match, not an older one', () => {
    const memory = new GameActivityMemory()
    memory.recall('tab:qa', activity('TR-2', 9))
    expect(memory.recall('tab:qa', activity('TR-1', 3))).toEqual(activity('TR-2', 9))
    expect(memory.recall('tab:qa', activity('TR-3', 12, true))).toEqual(activity('TR-3', 12, true))
  })

  it('answers null for a pane nothing ever matched', () => {
    expect(new GameActivityMemory().recall('tab:qa', null)).toBeNull()
  })

  it('keeps a bounded number of panes, forgetting the least recently matched first', () => {
    const memory = new GameActivityMemory(2)
    memory.recall('a', activity('TR-A', 1))
    memory.recall('b', activity('TR-B', 2))
    memory.recall('a', activity('TR-A2', 3))
    memory.recall('c', activity('TR-C', 4))
    expect(memory.recall('b', null)).toBeNull()
    expect(memory.recall('a', null)?.id).toBe('TR-A2')
    expect(memory.recall('c', null)?.id).toBe('TR-C')
  })

  it('forgets a pane on request', () => {
    const memory = new GameActivityMemory()
    memory.recall('tab:qa', activity('TR-1', 5))
    memory.forget('tab:qa')
    expect(memory.recall('tab:qa', null)).toBeNull()
  })
})
