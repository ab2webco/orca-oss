import { describe, expect, it } from 'vitest'
import { TerminalUnsubmittedInputTracker } from './terminal-unsubmitted-input-tracker'
import { formatTerminalAgentSessionState } from '../../cli/terminal-format'
import type { RuntimeTerminalAgentSessionState } from '../../shared/runtime-types'

/**
 * The control ORCA-457 states outright: a pane holding input the agent never
 * took must report something DIFFERENT from a pane whose agent is working. Both
 * used to read `awaiting-input`, which is why seven stuck workers took a day to
 * see. If the two collapse back to one value, nothing was fixed.
 */
const STUCK = 'pty-stuck'
const WORKING = 'pty-working'

// The agent's own reaction to a new turn; see agent-turn-acceptance-scanner.
const INTERRUPT_AFFORDANCE = 'esc to interrupt'

function trackerWithBothPanes(): TerminalUnsubmittedInputTracker {
  const tracker = new TerminalUnsubmittedInputTracker()
  tracker.beginObserving(STUCK)
  tracker.beginObserving(WORKING)
  // The incident shape: text AND a submit were written, so nothing about the
  // write itself looks wrong — only the missing turn does.
  tracker.recordWrite(STUCK, { hasText: true, submitted: true, atMs: 1_000 })
  tracker.recordWrite(WORKING, { hasText: true, submitted: true, atMs: 1_000 })
  tracker.observe(WORKING, `\r\n${INTERRUPT_AFFORDANCE}\r\n`)
  return tracker
}

function sessionState(
  handle: string,
  unsubmittedInput: RuntimeTerminalAgentSessionState['unsubmittedInput']
): { agentSession: RuntimeTerminalAgentSessionState } {
  return {
    agentSession: {
      handle,
      agent: 'claude',
      sessionId: 'session-1',
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

describe('a stuck pane and a working pane do not report the same thing', () => {
  it('separates them at the tracker', () => {
    const tracker = trackerWithBothPanes()

    const stuck = tracker.read(STUCK)
    const working = tracker.read(WORKING)

    expect(stuck).toEqual({
      observed: true,
      pending: { evidence: 'submit-without-turn', sinceMs: 1_000 }
    })
    expect(working).toEqual({ observed: true, pending: null })
    expect(stuck).not.toEqual(working)
  })

  it('separates them in what `terminal state` prints, where both said awaiting-input', () => {
    const tracker = trackerWithBothPanes()

    const stuck = formatTerminalAgentSessionState(sessionState(STUCK, tracker.read(STUCK)))
    const working = formatTerminalAgentSessionState(sessionState(WORKING, tracker.read(WORKING)))

    expect(stuck).toContain('state: awaiting-input')
    expect(working).toContain('state: awaiting-input')
    expect(stuck).toContain('unsubmitted input: submitted, but the agent never started a turn')
    expect(working).toContain('unsubmitted input: none')
  })
})

describe('what the tracker reports and why', () => {
  it('reports text written with no submit behind it', () => {
    const tracker = new TerminalUnsubmittedInputTracker()
    tracker.beginObserving(STUCK)

    tracker.recordWrite(STUCK, { hasText: true, submitted: false, atMs: 42 })

    expect(tracker.read(STUCK)).toEqual({
      observed: true,
      pending: { evidence: 'text-without-submit', sinceMs: 42 }
    })
  })

  it('holds a submit pending until the agent reacts, not until bytes come back', () => {
    const tracker = new TerminalUnsubmittedInputTracker()
    tracker.beginObserving(STUCK)
    tracker.recordWrite(STUCK, { hasText: true, submitted: true, atMs: 1 })

    // The terminal echoing our own payload proves delivery to the PTY, which was
    // already true and is exactly what made the pane look healthy.
    tracker.observe(STUCK, 'run the suite\r\n')

    expect(tracker.read(STUCK)).toEqual({
      observed: true,
      pending: { evidence: 'submit-without-turn', sinceMs: 1 }
    })
  })

  it('starts a fresh scan per submit, so bytes from before it cannot clear it', () => {
    const tracker = new TerminalUnsubmittedInputTracker()
    tracker.beginObserving(STUCK)

    // A partial affordance arrives under the first submit — not acceptance yet.
    tracker.recordWrite(STUCK, { hasText: true, submitted: true, atMs: 1 })
    tracker.observe(STUCK, INTERRUPT_AFFORDANCE.slice(0, 8))
    expect(tracker.read(STUCK)).toEqual({
      observed: true,
      pending: { evidence: 'submit-without-turn', sinceMs: 1 }
    })

    // The second submit must not inherit that half-match: joined across the two,
    // the tail alone would complete the phrase and clear a turn that never began.
    tracker.recordWrite(STUCK, { hasText: true, submitted: true, atMs: 2 })
    tracker.observe(STUCK, INTERRUPT_AFFORDANCE.slice(8))

    expect(tracker.read(STUCK)).toEqual({
      observed: true,
      pending: { evidence: 'submit-without-turn', sinceMs: 2 }
    })
  })

  it('says it cannot tell for a PTY it never watched, rather than saying healthy', () => {
    const tracker = new TerminalUnsubmittedInputTracker()

    expect(tracker.read('adopted-after-restart')).toEqual({
      observed: false,
      reason: 'pty-not-watched'
    })
    expect(tracker.read(null)).toEqual({ observed: false, reason: 'pty-gone' })
  })

  it('does not treat an interrupt as a submit, because it cancels rather than sends', () => {
    const tracker = new TerminalUnsubmittedInputTracker()
    tracker.beginObserving(STUCK)

    tracker.recordWrite(STUCK, { hasText: true, submitted: false, atMs: 7 })

    expect(tracker.read(STUCK)).toEqual({
      observed: true,
      pending: { evidence: 'text-without-submit', sinceMs: 7 }
    })
  })
})

describe('an older host that does not report the field', () => {
  it('reads as unobservable, never as nothing pending', () => {
    const printed = formatTerminalAgentSessionState(sessionState('term-1', undefined))

    expect(printed).toContain('unsubmitted input: unobservable — this host does not report it')
    expect(printed).not.toContain('unsubmitted input: none')
  })
})
