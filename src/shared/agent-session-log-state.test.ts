import { describe, expect, it } from 'vitest'
import { foldAgentSessionLogState } from './agent-session-log-state'

const queuedInput = { supported: true as const, pending: 0 }

describe('foldAgentSessionLogState', () => {
  // "I could not see the boundary" and "there is no boundary" must not collapse:
  // the first is a busy agent the scan could not reach (ORCA-236 review).
  it('separates a scan that ran out of budget from a log with no turns', () => {
    expect(
      foldAgentSessionLogState({
        lifecycle: null,
        queuedInput,
        unparsedRecords: 0,
        scanReachedCeiling: true
      })
    ).toEqual({ read: false, reason: 'turn-boundary-beyond-scan' })

    expect(
      foldAgentSessionLogState({
        lifecycle: null,
        queuedInput,
        unparsedRecords: 0,
        scanReachedCeiling: false
      })
    ).toMatchObject({ read: true, state: 'no-activity' })
  })

  it('lets queued input pick queued-input over awaiting-input', () => {
    const completed = { state: 'completed' as const, turnId: 't', timestamp: 5 }
    expect(
      foldAgentSessionLogState({
        lifecycle: completed,
        queuedInput: { supported: true, pending: 1 },
        unparsedRecords: 0,
        scanReachedCeiling: false
      })
    ).toMatchObject({ state: 'queued-input', lastTurnAtMs: 5 })

    expect(
      foldAgentSessionLogState({
        lifecycle: completed,
        queuedInput: { supported: false, reason: 'none written' },
        unparsedRecords: 0,
        scanReachedCeiling: false
      })
    ).toMatchObject({ state: 'awaiting-input' })
  })
})
