import { describe, expect, it } from 'vitest'
import { teamLeadTurnOf } from './team-lead-turn'

describe('teamLeadTurnOf', () => {
  it('reads the reply of the turn that just ended, not the one before it', () => {
    // As the e2e lead pane reported it: the completed field still held the previous turn.
    expect(
      teamLeadTurnOf({
        state: 'done',
        stateStartedAt: 20,
        lastAssistantMessage: 'Two PRs left.',
        lastCompletedAssistantMessage: 'Ready'
      })
    ).toEqual({ state: 'done', stateStartedAt: 20, reply: 'Two PRs left.' })
  })

  it('falls back to the completed reply once a batched update cleared the live one', () => {
    expect(
      teamLeadTurnOf({ state: 'done', stateStartedAt: 5, lastCompletedAssistantMessage: 'Done.' })
        ?.reply
    ).toBe('Done.')
    expect(teamLeadTurnOf(undefined)).toBeNull()
  })
})
