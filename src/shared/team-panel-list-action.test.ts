import { describe, expect, it } from 'vitest'
import type { GameAction } from './orchestrator-game-actions'
import { teamListActionOf } from './team-panel-list-action'

const PROMPT_ACTION: GameAction = { id: 'action-0', label: 'Review', prompt: 'Review my PRs' }
const MCP_ACTION: GameAction = {
  id: 'action-1',
  label: 'Page',
  mcp: { server: 'pager', tool: 'page' }
}

describe('teamListActionOf', () => {
  it('runs the action the list names', () => {
    expect(teamListActionOf({ actionId: 'action-0' }, [PROMPT_ACTION])?.id).toBe('action-0')
  })

  it('falls back to the list link for an MCP action or one the state lost', () => {
    expect(teamListActionOf({ actionId: 'action-1' }, [MCP_ACTION])).toBeNull()
    expect(teamListActionOf({ actionId: 'gone' }, [PROMPT_ACTION])).toBeNull()
  })

  it('has nothing to run on a list that names no action', () => {
    expect(teamListActionOf({}, [PROMPT_ACTION])).toBeNull()
  })
})
