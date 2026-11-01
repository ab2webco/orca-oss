import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'
import { OrchestrationDb } from './orchestration/db'
import { tellGameLead } from './orchestrator-game-lead-note'

const LEAD_WATCH_TYPES = ['worker_done', 'escalation', 'question', 'decision_gate'] as const
const LEAD_PANE = 'tab_lead:11111111-1111-4111-8111-111111111111'
const LEAD = { handle: 'term_lead', paneKey: LEAD_PANE }
const NOTE = {
  subject: 'Owner answered CIN-1: Ship it?',
  body: 'Answer: Yes',
  payload: { ownerQuestionId: 'oq_1' }
}

const dirs: string[] = []
const dbs: OrchestrationDb[] = []

afterEach(() => {
  for (const one of dbs.splice(0)) {
    one.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A host whose legacy mail was adopted, as every long-lived install's is: a message needs its Run. */
function adoptedDb(): OrchestrationDb {
  const dir = mkdtempSync(join(tmpdir(), 'orca-lead-note-'))
  dirs.push(dir)
  const path = join(dir, 'orchestration.db')
  const before = new OrchestrationDb(path)
  const adopted = before.createRun({
    objective: 'adopted legacy',
    coordinatorHandle: 'term_old_coordinator',
    coordinatorPaneKey: 'tab_old:22222222-2222-4222-8222-222222222222'
  })
  before.close()
  const raw = new SyncDatabase(path)
  raw
    .prepare(
      'INSERT INTO legacy_adoptions (source_run_id, adopted_run_id, scheduler_state_lost) VALUES (?, ?, 1)'
    )
    .run('run_legacy_local', adopted.id)
  raw.close()
  const db = new OrchestrationDb(path)
  dbs.push(db)
  return db
}

function memoryDb(): OrchestrationDb {
  const db = new OrchestrationDb(':memory:')
  dbs.push(db)
  return db
}

function leadDelivery(db: OrchestrationDb, runId: string, generation: number) {
  return db.getOrCreateRunDelivery({
    runId,
    consumerGeneration: generation,
    terminalHandle: 'term_lead',
    wakeTypes: [...LEAD_WATCH_TYPES]
  })
}

describe('tellGameLead', () => {
  it("reaches the lead's mail watch as an escalation from owner and wakes it", () => {
    const db = memoryDb()
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const notify = vi.fn()

    expect(tellGameLead(db, notify, LEAD, NOTE)).toBe(true)

    expect(notify).toHaveBeenCalledWith('term_lead', 'escalation')
    // Why (ORCA-861): mail from outside the lead's members wakes a watch whatever its types.
    expect(db.hasUnreadOutsideMemberRunMail(run.id, 'term_lead')).toBe(true)
    expect(leadDelivery(db, run.id, run.consumer_generation)?.messages).toMatchObject([
      {
        run_id: run.id,
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

  // Why (ORCA-942): with no runId an adopted host refused every owner note, and the refusal was swallowed.
  it("writes into the lead's Run on a host whose legacy mail was adopted", () => {
    const db = adoptedDb()
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const notify = vi.fn()

    expect(tellGameLead(db, notify, LEAD, NOTE)).toBe(true)

    expect(notify).toHaveBeenCalledWith('term_lead', 'escalation')
    expect(leadDelivery(db, run.id, run.consumer_generation)?.messages).toMatchObject([
      { run_id: run.id, from_handle: 'owner', type: 'escalation' }
    ])
  })

  it('finds the Run by the lead handle when Orca cannot tell its pane', () => {
    const db = adoptedDb()
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })

    expect(tellGameLead(db, vi.fn(), { handle: 'term_lead', paneKey: null }, NOTE)).toBe(true)

    expect(leadDelivery(db, run.id, run.consumer_generation)?.messages).toHaveLength(1)
  })

  it('returns false instead of throwing when the database refuses the write', () => {
    const closed = new OrchestrationDb(':memory:')
    closed.close()
    const notify = vi.fn()

    expect(tellGameLead(closed, notify, LEAD, { subject: 's', body: 'b', payload: {} })).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})
