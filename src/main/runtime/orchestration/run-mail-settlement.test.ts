import { afterEach, describe, expect, it } from 'vitest'
import type Database from '../../sqlite/sync-database'
import { OrchestrationDb } from './db'
import type { RunRow } from './types'

const PREVIOUS_LEAD_PANE = 'tab_old:11111111-1111-4111-8111-111111111111'
const NEW_LEAD_PANE = 'tab_new:22222222-2222-4222-9222-222222222222'

function sqliteFor(db: OrchestrationDb): Database.Database {
  return (db as unknown as { db: Database.Database }).db
}

describe('Run mail a previous lead already settled (ORCA-824)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
  })

  function createLeadRun(): { d: OrchestrationDb; run: RunRow } {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'Lead mailbox',
      coordinatorHandle: 'term_old_lead',
      coordinatorPaneKey: PREVIOUS_LEAD_PANE
    })
    return { d: db, run }
  }

  function startMember(d: OrchestrationDb, run: RunRow, name: string): string {
    const task = d.createTask({ spec: name, runId: run.id })
    return d.createDispatchContext(task.id, `term_${name}`).id
  }

  function memberMail(
    d: OrchestrationDb,
    run: RunRow,
    dispatchId: string,
    type: 'worker_done' | 'escalation' | 'status',
    subject: string
  ): string {
    return d.insertMessage({
      from: `term_${dispatchId}`,
      to: `run:${run.id}`,
      subject,
      type,
      payload: JSON.stringify({ dispatchId }),
      runId: run.id
    }).id
  }

  // Why: SQLite stamps whole seconds, so a fixture written in the bind's second would read as the new lead's mail.
  function backdateMail(d: OrchestrationDb): void {
    sqliteFor(d).prepare("UPDATE messages SET created_at = '2026-10-26 16:00:00'").run()
  }

  function claimByNewLead(d: OrchestrationDb, run: RunRow): RunRow {
    return d.bindRun({
      runId: run.id,
      coordinatorHandle: 'term_new_lead',
      coordinatorPaneKey: NEW_LEAD_PANE
    })!
  }

  it("leaves out of the new lead's batch what the previous lead's era settled", () => {
    const { d, run } = createLeadRun()
    const merged = startMember(d, run, 'merged')
    const answered = startMember(d, run, 'answered')
    const revoked = startMember(d, run, 'revoked')
    const working = startMember(d, run, 'working')

    const mergedDone = memberMail(d, run, merged, 'worker_done', 'PR merged')
    const mergedStatus = memberMail(d, run, merged, 'status', 'CI green')
    const mergedEscalation = memberMail(d, run, merged, 'escalation', 'needed a rebase')
    d.completeDispatch(merged)
    const answeredQuestion = d.createQuestion({
      runId: run.id,
      dispatchId: answered,
      askerHandle: 'term_answered',
      question: 'A or B?'
    }).message.id
    d.answerQuestion({
      messageId: answeredQuestion,
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      body: 'A'
    })
    const revokedQuestion = d.createQuestion({
      runId: run.id,
      dispatchId: revoked,
      askerHandle: 'term_revoked',
      question: 'Still there?'
    }).message.id
    d.failDispatch(revoked, 'revoked')
    d.closeQuestionsForDispatch(revoked)
    const openQuestion = d.createQuestion({
      runId: run.id,
      dispatchId: working,
      askerHandle: 'term_working',
      question: 'Which API?'
    }).message.id
    const note = d.insertMessage({
      from: 'term_someone',
      to: `run:${run.id}`,
      subject: 'plain note',
      runId: run.id
    }).id
    backdateMail(d)

    const newLead = claimByNewLead(d, run)
    const batch = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: newLead.consumer_generation
    })

    expect(batch?.messages.map((message) => message.id)).toEqual([openQuestion, note])
    for (const id of [
      mergedDone,
      mergedStatus,
      mergedEscalation,
      answeredQuestion,
      revokedQuestion
    ]) {
      expect(d.getMessageById(id)?.read).toBe(1)
    }
    const history = d.getRunMailboxHistory(run.id, 100)
    expect(history.map((message) => message.id)).toEqual(
      expect.arrayContaining([mergedDone, answeredQuestion, revokedQuestion])
    )
  })

  it("settles a finished member's note that names no dispatch by its sender's dispatch", () => {
    const { d, run } = createLeadRun()
    const finished = startMember(d, run, 'finished')
    const live = startMember(d, run, 'live')
    const finishedNote = d.insertMessage({
      from: 'term_finished',
      to: `run:${run.id}`,
      subject: 'paused, evidence saved',
      type: 'status',
      runId: run.id
    }).id
    const liveNote = d.insertMessage({
      from: 'term_live',
      to: `run:${run.id}`,
      subject: 'half way',
      type: 'status',
      runId: run.id
    }).id
    d.completeDispatch(finished)
    backdateMail(d)

    const newLead = claimByNewLead(d, run)
    const batch = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: newLead.consumer_generation
    })

    expect(batch?.messages.map((message) => message.id)).toEqual([liveNote])
    expect(d.getMessageById(finishedNote)?.read).toBe(1)
    expect(live).toBeTruthy()
  })

  it("keeps the current lead's own worker_done live until it acks it", () => {
    const { d, run } = createLeadRun()
    const member = startMember(d, run, 'member')
    const done = memberMail(d, run, member, 'worker_done', 'PR open')
    d.completeDispatch(member)

    const batch = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })

    expect(batch?.messages.map((message) => message.id)).toEqual([done])
  })

  it('keeps a worker_done from a still-live member after a lead change', () => {
    const { d, run } = createLeadRun()
    const member = startMember(d, run, 'member')
    const status = memberMail(d, run, member, 'status', 'half way')
    backdateMail(d)

    const newLead = claimByNewLead(d, run)
    const batch = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: newLead.consumer_generation
    })

    expect(batch?.messages.map((message) => message.id)).toEqual([status])
  })

  it('drops a question the lead already answered from the live queue in the same lead session', () => {
    const { d, run } = createLeadRun()
    const member = startMember(d, run, 'member')
    const question = d.createQuestion({
      runId: run.id,
      dispatchId: member,
      askerHandle: 'term_member',
      question: 'A or B?'
    }).message.id
    d.answerQuestion({
      messageId: question,
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      body: 'B'
    })

    expect(d.getUnreadMessages(`run:${run.id}`)).toEqual([])
    expect(
      d.getOrCreateRunDelivery({ runId: run.id, consumerGeneration: run.consumer_generation })
    ).toBeUndefined()
  })

  it('stops counting settled mail for the terminal pointer', () => {
    const { d, run } = createLeadRun()
    const member = startMember(d, run, 'member')
    memberMail(d, run, member, 'worker_done', 'PR merged')
    d.completeDispatch(member)
    backdateMail(d)
    claimByNewLead(d, run)

    expect(d.getUndeliveredUnreadMessages(`run:${run.id}`)).toEqual([])
    expect(d.getUnreadMessages(`run:${run.id}`)).toEqual([])
  })

  it('does not rewrite a batch the current lead already holds', () => {
    const { d, run } = createLeadRun()
    const member = startMember(d, run, 'member')
    const question = d.createQuestion({
      runId: run.id,
      dispatchId: member,
      askerHandle: 'term_member',
      question: 'A or B?'
    }).message.id
    const held = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })!
    d.answerQuestion({
      messageId: question,
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      body: 'A'
    })

    const replay = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })

    expect(replay).toMatchObject({ replayed: true })
    expect(replay?.delivery.id).toBe(held.delivery.id)
    expect(replay?.messages.map((message) => message.id)).toEqual([question])
  })
})
