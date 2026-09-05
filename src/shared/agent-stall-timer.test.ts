import { describe, expect, it } from 'vitest'
import {
  advanceAgentStallTimer,
  createAgentStallTimerState,
  isAgentStallTimerIntervalMinutes,
  type AgentStallProbe,
  type AgentStallTickOutcome,
  type AgentStallTimerState
} from './agent-stall-timer'

const fingerprint = (value: string): AgentStallProbe => ({ kind: 'fingerprint', value })
const unreadable: AgentStallProbe = { kind: 'unreadable' }

function runTicks(
  state: AgentStallTimerState,
  probes: AgentStallProbe[]
): { state: AgentStallTimerState; outcomes: AgentStallTickOutcome[] } {
  const outcomes: AgentStallTickOutcome[] = []
  let current = state
  for (const probe of probes) {
    const result = advanceAgentStallTimer(current, probe)
    current = result.state
    outcomes.push(result.outcome)
  }
  return { state: current, outcomes }
}

describe('agent stall timer', () => {
  it('does not escalate while the fingerprint keeps changing', () => {
    const armed = createAgentStallTimerState(fingerprint('a'))

    const { outcomes } = runTicks(armed, [fingerprint('b'), fingerprint('c'), fingerprint('d')])

    expect(outcomes).toEqual(['progressing', 'progressing', 'progressing'])
  })

  it('escalates once when the fingerprint stops changing, not on every tick', () => {
    const armed = createAgentStallTimerState(fingerprint('a'))

    const { outcomes } = runTicks(armed, [fingerprint('a'), fingerprint('a'), fingerprint('a')])

    expect(outcomes).toEqual(['escalate', 'stalled-already-escalated', 'stalled-already-escalated'])
  })

  it('re-arms after progress resumes so a second stall escalates again', () => {
    const armed = createAgentStallTimerState(fingerprint('a'))

    const { outcomes } = runTicks(armed, [
      fingerprint('a'),
      fingerprint('b'),
      fingerprint('b'),
      fingerprint('b')
    ])

    expect(outcomes).toEqual(['escalate', 'progressing', 'escalate', 'stalled-already-escalated'])
  })

  it('escalates on a worktree whose only work is staged and then abandoned', () => {
    // The 11-hour case: no new commits, a dirty tree that stopped changing. A level-based
    // signal reads this as healthy; the delta does not.
    const armed = createAgentStallTimerState(fingerprint('head=1 dirty=staged-fix'))

    const { outcomes } = runTicks(armed, [
      fingerprint('head=1 dirty=staged-fix'),
      fingerprint('head=1 dirty=staged-fix')
    ])

    expect(outcomes).toEqual(['escalate', 'stalled-already-escalated'])
  })

  it('does not escalate on an unreadable probe and keeps the previous fingerprint', () => {
    const armed = createAgentStallTimerState(fingerprint('a'))

    const first = advanceAgentStallTimer(armed, unreadable)
    expect(first.outcome).toBe('unreadable')
    expect(first.state).toEqual(armed)

    // The carried-forward fingerprint still decides the next readable tick.
    expect(advanceAgentStallTimer(first.state, fingerprint('a')).outcome).toBe('escalate')
  })

  it('an unreadable probe never advances the latch on its own', () => {
    const armed = createAgentStallTimerState(fingerprint('a'))

    const { outcomes } = runTicks(armed, [unreadable, unreadable, unreadable])

    expect(outcomes).toEqual(['unreadable', 'unreadable', 'unreadable'])
  })

  it('treats the first readable tick as the baseline when arming could not read one', () => {
    const armed = createAgentStallTimerState(unreadable)
    expect(armed.lastFingerprint).toBeNull()

    const { outcomes } = runTicks(armed, [fingerprint('a'), fingerprint('a')])

    expect(outcomes).toEqual(['progressing', 'escalate'])
  })

  it('accepts only the three offered intervals', () => {
    expect(isAgentStallTimerIntervalMinutes(15)).toBe(true)
    expect(isAgentStallTimerIntervalMinutes(30)).toBe(true)
    expect(isAgentStallTimerIntervalMinutes(60)).toBe(true)
    expect(isAgentStallTimerIntervalMinutes(45)).toBe(false)
    expect(isAgentStallTimerIntervalMinutes(0)).toBe(false)
  })
})
