import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './db'
import { recordTurnAcceptanceInBackground } from './dispatch-turn-acceptance'
import { DISPATCH_SUBMIT_RETRY_AFTER_MS } from './dispatch-submit-retry'
import type { AgentPromptSubmitProbe } from '../agent-prompt-submit-probe'

const UNACCEPTED = { accepted: false, evidence: null, waitedMs: 5_000 }

describe('recordTurnAcceptanceInBackground (ORCA-754)', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    vi.useFakeTimers()
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  function dispatched(): string {
    const runId = db.createRun({
      objective: 'submit retry',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    }).id
    const task = db.createTask({ spec: 'work', runId })
    return db.createDispatchContext(task.id, 'term_member').id
  }

  function stuckProbe(): AgentPromptSubmitProbe & { presses: number } {
    const probe = {
      presses: 0,
      state: () => (probe.presses > 0 ? ('turn-seen' as const) : ('awaiting-turn' as const)),
      pressEnter: async () => {
        probe.presses += 1
        return true
      }
    }
    return probe
  }

  it('presses Enter for a dispatch whose brief was never submitted, then records the turn', async () => {
    const dispatchId = dispatched()
    const probe = stuckProbe()

    const done = recordTurnAcceptanceInBackground(
      db,
      dispatchId,
      Promise.resolve(UNACCEPTED),
      probe
    )
    await vi.advanceTimersByTimeAsync(DISPATCH_SUBMIT_RETRY_AFTER_MS * 2)
    await done

    expect(probe.presses).toBe(1)
    expect(db.getDispatchContextById(dispatchId)?.turn_accepted_at).not.toBeNull()
  })

  it('never presses for a dispatch that already sent a lifecycle signal', async () => {
    const dispatchId = dispatched()
    db.recordDispatchLifecycleSignal(dispatchId, new Date().toISOString())
    const probe = stuckProbe()

    const done = recordTurnAcceptanceInBackground(
      db,
      dispatchId,
      Promise.resolve(UNACCEPTED),
      probe
    )
    await vi.advanceTimersByTimeAsync(DISPATCH_SUBMIT_RETRY_AFTER_MS * 3)
    await done

    expect(probe.presses).toBe(0)
  })

  it('keeps today’s behaviour for a pane it could not observe', async () => {
    const dispatchId = dispatched()

    await recordTurnAcceptanceInBackground(db, dispatchId, Promise.resolve(UNACCEPTED), null)

    expect(vi.getTimerCount()).toBe(0)
    expect(db.getDispatchContextById(dispatchId)?.turn_accepted_at).toBeNull()
  })
})
