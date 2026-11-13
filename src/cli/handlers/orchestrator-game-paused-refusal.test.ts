import { describe, expect, it } from 'vitest'
import { gamePausedRefusalOf } from './orchestrator-game-paused-refusal'

const FREE =
  '`orca game resume-members CIN-12` resumes it, `orca game resume-members CIN-12 --discard` frees it.'

describe('gamePausedRefusalOf', () => {
  // Why: it said 'since Orca restarted' for a member whose terminal had simply ended.
  it('names why the ticket is paused instead of always blaming a restart', () => {
    expect(gamePausedRefusalOf({ ticket: 'CIN-12' })).toBe(
      `CIN-12 is paused, its terminal is gone (it ended or Orca restarted): ${FREE}`
    )
    expect(
      gamePausedRefusalOf({ ticket: 'CIN-12', cause: 'terminal-open', terminal: 'term_9' })
    ).toBe(`CIN-12 is paused, its terminal term_9 is open but not reporting: ${FREE}`)
    expect(
      gamePausedRefusalOf({ ticket: 'CIN-12', cause: 'unsubmitted', terminal: 'term_9' })
    ).toBe(`CIN-12 is paused, its brief was never submitted in term_9: ${FREE}`)
  })
})
