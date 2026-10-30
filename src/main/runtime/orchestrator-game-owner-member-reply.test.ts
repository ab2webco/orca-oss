import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { replyToMemberAsLead } from './orchestrator-game-owner-member-reply'

const LEAD_PANE = 'tab_lead:11111111-1111-4111-8111-111111111111'

let db: OrchestrationDb | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function project() {
  db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'Inbox replies',
    coordinatorHandle: 'term_lead',
    coordinatorPaneKey: LEAD_PANE
  })
  const task = db.createTask({ spec: 'ask', runId: run.id })
  const dispatch = db.createDispatchContext(task.id, 'term_member')
  const ask = (question: string) =>
    db!.createQuestion({
      runId: run.id,
      dispatchId: dispatch.id,
      askerHandle: 'term_member',
      question
    }).message.id
  const notified: string[] = []
  const reply = (id: string, text: string) =>
    replyToMemberAsLead(
      db!,
      (handle) => notified.push(handle),
      { handle: 'term_lead', paneKey: LEAD_PANE },
      { id, text }
    )
  return { db, run, dispatch, ask, reply, notified }
}

describe('replyToMemberAsLead', () => {
  it("answers a waiting question as the lead, so the member's ask returns the person's words", () => {
    const { db, dispatch, ask, reply, notified } = project()
    const id = ask('Which port?')

    expect(reply(id, '8080')).toEqual({ mode: 'answered', question: 'Which port?' })

    expect(db.getQuestion(id)).toMatchObject({ status: 'answered', answer_body: '8080' })
    expect(notified).toEqual([`dispatch:${dispatch.id}`])
  })

  it("overrides an answered question with a follow-up on its thread that names the lead's answer", () => {
    const { db, run, dispatch, ask, reply, notified } = project()
    const id = ask('Rebase?')
    db.answerQuestion({
      messageId: id,
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      body: 'No'
    })

    expect(reply(id, 'Yes, rebase onto main')).toEqual({ mode: 'override', question: 'Rebase?' })

    const sent = db.getAllMessagesForHandle(`dispatch:${dispatch.id}`, 10)[0]
    expect(sent).toMatchObject({
      from_handle: 'term_lead',
      thread_id: id,
      priority: 'high'
    })
    expect(sent?.body).toContain('Yes, rebase onto main')
    expect(sent?.body).toContain('"No"')
    expect(db.getQuestion(id)).toMatchObject({ answer_body: 'No' })
    expect(notified).toEqual([`dispatch:${dispatch.id}`])
  })

  it("replies to a member's decision gate on its thread, from the lead", () => {
    const { db, run, reply } = project()
    const gate = db.insertMessage({
      from: 'term_member',
      to: 'term_lead',
      subject: 'Ship now?',
      body: 'Ship in lab.111?',
      type: 'decision_gate',
      runId: run.id
    })

    expect(reply(gate.id, 'Wait for lab.112')).toEqual({
      mode: 'reply',
      question: 'Ship in lab.111?'
    })
    expect(db.getAllMessagesForHandle('term_member', 10)[0]).toMatchObject({
      from_handle: 'term_lead',
      body: 'Wait for lab.112',
      thread_id: gate.id
    })
  })

  it('refuses a question whose member is gone, and mail outside the lead run', () => {
    const { db, dispatch, ask, reply } = project()
    const id = ask('Still there?')
    db.closeQuestionsForDispatch(dispatch.id)

    expect(() => reply(id, 'Yes')).toThrow(/member is gone/)
    expect(() => reply('msg_missing', 'Yes')).toThrow(/not in this lead's run/)
  })
})
