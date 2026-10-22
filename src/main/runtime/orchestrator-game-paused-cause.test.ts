import { describe, expect, it } from 'vitest'
import { gamePausedCauseOf } from './orchestrator-game-paused-cause'

type DispatchFacts = NonNullable<Parameters<typeof gamePausedCauseOf>[0]>

const dispatch = (extra: Partial<DispatchFacts> = {}): DispatchFacts => ({
  status: 'dispatched',
  assignee_handle: 'term_member',
  first_lifecycle_signal_at: null,
  turn_accepted_at: null,
  ...extra
})
const open = (handle: string): boolean => handle === 'term_member'

describe('gamePausedCauseOf (ORCA-754)', () => {
  it('names a brief that was written but never started a turn', () => {
    expect(gamePausedCauseOf(dispatch(), open)).toEqual({
      cause: 'unsubmitted',
      terminal: 'term_member'
    })
  })

  it('names an open terminal whose dispatch is past its first turn', () => {
    expect(gamePausedCauseOf(dispatch({ turn_accepted_at: '2026-10-22T16:31:11Z' }), open)).toEqual(
      { cause: 'terminal-open', terminal: 'term_member' }
    )
    expect(gamePausedCauseOf(dispatch({ status: 'failed' }), open)).toEqual({
      cause: 'terminal-open',
      terminal: 'term_member'
    })
  })

  it('leaves the restart wording to a member whose terminal is gone', () => {
    expect(gamePausedCauseOf(dispatch({ assignee_handle: 'term_gone' }), open)).toBeNull()
    expect(gamePausedCauseOf(undefined, open)).toBeNull()
  })
})
