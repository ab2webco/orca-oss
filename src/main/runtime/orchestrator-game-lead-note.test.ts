import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { tellGameLead } from './orchestrator-game-lead-note'

const LEAD_WATCH_TYPES = ['worker_done', 'escalation', 'question', 'decision_gate'] as const

describe('tellGameLead', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it("reaches the lead's mail watch as an escalation from owner and wakes it", () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: 'tab_lead:11111111-1111-4111-8111-111111111111'
    })
    const notify = vi.fn()

    const told = tellGameLead(db, notify, 'term_lead', {
      subject: 'Owner answered CIN-1: Ship it?',
      body: 'Answer: Yes',
      payload: { ownerQuestionId: 'oq_1' }
    })

    expect(told).toBe(true)
    expect(notify).toHaveBeenCalledWith('term_lead', 'escalation')
    // Why (ORCA-861): mail from outside the lead's members wakes a watch whatever its types.
    expect(db.hasUnreadOutsideMemberRunMail(run.id, 'term_lead')).toBe(true)
    const delivery = db.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      terminalHandle: 'term_lead',
      wakeTypes: [...LEAD_WATCH_TYPES]
    })
    expect(delivery?.messages).toMatchObject([
      {
        from_handle: 'owner',
        to_handle: 'term_lead',
        type: 'escalation',
        priority: 'high',
        subject: 'Owner answered CIN-1: Ship it?',
        body: 'Answer: Yes',
        payload: JSON.stringify({ ownerQuestionId: 'oq_1' })
      }
    ])
  })

  it('returns false instead of throwing when the database refuses the write', () => {
    db = new OrchestrationDb(':memory:')
    db.close()
    const closed = db
    db = undefined
    const notify = vi.fn()

    expect(
      tellGameLead(closed, notify, 'term_lead', { subject: 's', body: 'b', payload: {} })
    ).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})
