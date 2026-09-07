import { describe, expect, it } from 'vitest'
import { formatTerminalAgentSessionState } from './terminal-format'
import type { RuntimeTerminalAgentSessionState } from '../shared/runtime-types'

/**
 * The printed half of ORCA-457's control: a pane holding input the agent never
 * took must not print the same thing as a pane whose agent is working. Both used
 * to read `awaiting-input` and nothing else, which is why seven stuck workers
 * took a day to see.
 *
 * The state half lives in
 * src/main/runtime/terminal-unsubmitted-input-tracker.test.ts. It cannot live
 * here: `src/cli` and `src/main/runtime` are separate TypeScript projects, and
 * that boundary is deliberate — a test is not a reason to widen it.
 */
function sessionState(
  handle: string,
  unsubmittedInput: RuntimeTerminalAgentSessionState['unsubmittedInput']
): { agentSession: RuntimeTerminalAgentSessionState } {
  return {
    agentSession: {
      handle,
      agent: 'claude',
      sessionId: 'session-1',
      // Both panes report exactly this, and always did. It is the line below it
      // that has to differ.
      session: {
        read: true,
        state: 'awaiting-input',
        lastTurnAtMs: 1_000,
        queuedInput: { supported: true, pending: 0 },
        unparsedRecords: 0
      },
      ...(unsubmittedInput ? { unsubmittedInput } : {})
    }
  }
}

describe('what `terminal state` prints for a stuck pane and a working one', () => {
  it('separates them, where both said awaiting-input', () => {
    const stuck = formatTerminalAgentSessionState(
      sessionState('term-stuck', {
        observed: true,
        pending: { evidence: 'submit-without-turn', sinceMs: 1_000 }
      })
    )
    const working = formatTerminalAgentSessionState(
      sessionState('term-working', { observed: true, pending: null })
    )

    expect(stuck).toContain('state: awaiting-input')
    expect(working).toContain('state: awaiting-input')
    expect(stuck).toContain('unsubmitted input: submitted, but the agent never started a turn')
    expect(working).toContain('unsubmitted input: none')
    expect(stuck).not.toEqual(working)
  })

  it('names the composer case in its own words', () => {
    const printed = formatTerminalAgentSessionState(
      sessionState('term-1', {
        observed: true,
        pending: { evidence: 'text-without-submit', sinceMs: 1_000 }
      })
    )

    expect(printed).toContain('unsubmitted input: text was written and never submitted')
  })

  it('reads an unwatched terminal as unobservable, not as nothing pending', () => {
    const printed = formatTerminalAgentSessionState(
      sessionState('term-1', { observed: false, reason: 'pty-not-watched' })
    )

    expect(printed).toContain(
      'unsubmitted input: unobservable — this runtime never watched this terminal from spawn'
    )
    expect(printed).not.toContain('unsubmitted input: none')
  })

  it('says so when the host predates the field, rather than implying health', () => {
    // An older host omits the optional field. Absence must not read as "none":
    // that is the same wrong answer the bug gave for a year.
    const printed = formatTerminalAgentSessionState(sessionState('term-1', undefined))

    expect(printed).toContain('unsubmitted input: unobservable — this host does not report it')
    expect(printed).not.toContain('unsubmitted input: none')
  })

  it('keeps the line when the session log itself is unreadable', () => {
    // An unreadable log is exactly when a stuck composer is hardest to see, so
    // this is the branch the line must not drop out of.
    const printed = formatTerminalAgentSessionState({
      agentSession: {
        handle: 'term-1',
        agent: 'claude',
        sessionId: null,
        session: { read: false, reason: 'session-log-missing' },
        unsubmittedInput: {
          observed: true,
          pending: { evidence: 'submit-without-turn', sinceMs: 1_000 }
        }
      }
    })

    expect(printed).toContain('state: unknown')
    expect(printed).toContain('unsubmitted input: submitted, but the agent never started a turn')
  })
})
