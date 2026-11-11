import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../../shared/agent-status-types'
import { teamHelpersOf } from './team-member-helpers'

const helper = (over: Partial<AgentSubagentSnapshot>): AgentSubagentSnapshot => ({
  id: 'a1',
  state: 'working',
  startedAt: 1,
  ...over
})

describe('teamHelpersOf', () => {
  it('counts the helpers still running and lists each with its description', () => {
    const result = teamHelpersOf([
      helper({ id: 'a1', description: 'Map sidebar rows', agentType: 'Explore' }),
      helper({ id: 'a2', description: 'Inventory sidebar', state: 'blocked' }),
      helper({ id: 'a3', agentType: 'Explore', state: 'idle' })
    ])

    expect(result.running).toBe(2)
    expect(result.helpers).toEqual([
      { id: 'a1', label: 'Map sidebar rows', state: 'working' },
      { id: 'a2', label: 'Inventory sidebar', state: 'working' },
      { id: 'a3', label: 'Explore', state: 'done' }
    ])
  })

  it('has nothing to show when the member runs no helpers', () => {
    expect(teamHelpersOf(undefined)).toEqual({ running: 0, helpers: [] })
    expect(teamHelpersOf([])).toEqual({ running: 0, helpers: [] })
  })
})
