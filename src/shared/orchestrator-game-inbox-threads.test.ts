import { describe, expect, it } from 'vitest'
import type { GameInboxMail, GameInboxSource } from './orchestrator-game-inbox'
import { gameInboxThreadsOf } from './orchestrator-game-inbox-threads'

let sequence = 0
const mail = (to: string, from: string, overrides: Partial<GameInboxMail> = {}): GameInboxMail => {
  sequence += 1
  return {
    id: `msg_${sequence}`,
    from_handle: from,
    to_handle: to,
    subject: `s${sequence}`,
    body: `b${sequence}`,
    type: 'status',
    read: 0,
    sequence,
    created_at: `2026-10-29 10:00:${String(sequence).padStart(2, '0')}`,
    payload: null,
    ...overrides
  }
}

function source(rows: GameInboxMail[], extra: Partial<GameInboxSource> = {}): GameInboxSource {
  return {
    leadAddresses: ['term_lead', 'run:run_1'],
    members: [
      { ticket: 'CIN-1', addresses: ['term_1', 'dispatch:d1'] },
      { ticket: 'CIN-2', addresses: ['term_2', 'dispatch:d2'] }
    ],
    mail: rows,
    ...extra
  }
}

describe('gameInboxThreadsOf', () => {
  it('groups lead and member mail by ticket, oldest first, newest thread first', () => {
    sequence = 0
    const rows = [
      mail('dispatch:d1', 'term_lead', { type: 'dispatch' }),
      mail('term_lead', 'term_1', { type: 'question' }),
      mail('term_2', 'term_lead', { type: 'dispatch' }),
      mail('run:run_1', 'dispatch:d1', { type: 'worker_done' }),
      mail('term_lead', 'term_1', { type: 'heartbeat' })
    ]

    const { threads } = gameInboxThreadsOf(source(rows))

    expect(threads.map((thread) => thread.ticket)).toEqual(['CIN-1', 'CIN-2'])
    expect(threads[0]?.messages.map((one) => [one.id, one.from, one.to, one.kind])).toEqual([
      ['msg_1', 'lead', 'CIN-1', 'dispatch'],
      ['msg_2', 'CIN-1', 'lead', 'question'],
      ['msg_4', 'CIN-1', 'lead', 'worker_done']
    ])
    expect(threads[0]?.last).toBe('2026-10-29 10:00:04')
    expect(threads[1]?.messages.map((one) => one.id)).toEqual(['msg_3'])
  })

  it('keeps mail the same message reached twice once, and leaves the lead-only mail out of threads', () => {
    sequence = 0
    const row = mail('term_lead', 'term_1')
    const { threads } = gameInboxThreadsOf(source([row, row, mail('term_lead', 'term_other')]))

    expect(threads).toHaveLength(1)
    expect(threads[0]?.messages.map((one) => one.id)).toEqual([row.id])
  })

  it('marks rejected reports, dead dispatches and failed outcomes as failures, a rejected heartbeat included', () => {
    sequence = 0
    const rows = [
      mail('run:run_1', 'dispatch:d1', {
        type: 'worker_done',
        payload: JSON.stringify({
          _orcaLifecycleRejection: { code: 'invalid_envelope', reason: 'summary is empty' }
        })
      }),
      mail('term_lead', 'dispatch:d1', {
        type: 'escalation',
        payload: JSON.stringify({ reason: 'first_signal_deadline_expired' })
      }),
      mail('term_lead', 'term_1', {
        type: 'worker_done',
        payload: JSON.stringify({ outcome: 'failed' })
      }),
      mail('term_lead', 'term_1', {
        type: 'heartbeat',
        payload: JSON.stringify({
          _orcaLifecycleRejection: { code: 'stale_dispatch', reason: 'old' }
        })
      }),
      mail('term_lead', 'term_1', { type: 'status' })
    ]

    const messages = gameInboxThreadsOf(source(rows)).threads[0]?.messages ?? []

    expect(messages.map((one) => one.failure)).toEqual([
      { kind: 'rejected', reason: 'summary is empty' },
      { kind: 'failed', reason: 'first_signal_deadline_expired' },
      { kind: 'failed', reason: null },
      { kind: 'rejected', reason: 'old' },
      null
    ])
  })

  it('lists as Waiting the pending questions and the decision gates the lead has not answered yet, oldest first', () => {
    sequence = 0
    const question = mail('run:run_1', 'dispatch:d1', { type: 'question', body: 'Which port?' })
    const answeredGate = mail('term_lead', 'term_2', { type: 'decision_gate' })
    const reply = mail('term_2', 'term_lead')
    const openGate = mail('term_lead', 'term_1', { type: 'decision_gate', body: 'Ship it?' })

    const { waiting, threads } = gameInboxThreadsOf(
      source([question, answeredGate, reply, openGate], { pendingQuestions: [question] })
    )

    expect(waiting).toEqual([
      {
        id: question.id,
        ticket: 'CIN-1',
        kind: 'question',
        subject: question.subject,
        body: 'Which port?',
        at: question.created_at,
        answerer: 'lead'
      },
      {
        id: openGate.id,
        ticket: 'CIN-1',
        kind: 'decision_gate',
        subject: openGate.subject,
        body: 'Ship it?',
        at: openGate.created_at,
        answerer: 'lead'
      }
    ])
    expect(threads.find((thread) => thread.ticket === 'CIN-1')?.waiting).toBe(2)
    expect(threads.find((thread) => thread.ticket === 'CIN-2')?.waiting).toBe(0)
  })

  it('audits what the lead answered: each question with its answer and when, newest first', () => {
    sequence = 0
    const first = mail('run:run_1', 'dispatch:d1', { type: 'question', body: 'Which port?' })
    const gate = mail('term_lead', 'term_2', { type: 'decision_gate', body: 'Ship it?' })
    const gateReply = mail('term_2', 'term_lead', { body: 'Yes, ship it.' })
    const second = mail('run:run_1', 'dispatch:d2', { type: 'question', body: 'Rebase?' })

    const { answered } = gameInboxThreadsOf(
      source([first, gate, gateReply, second], {
        answeredQuestions: [
          { ...first, answer_body: '8080', answered_at: '2026-10-29 10:05:00' },
          { ...second, answer_body: 'Yes', answered_at: '2026-10-29 10:09:00' }
        ]
      })
    )

    expect(answered).toEqual([
      {
        id: second.id,
        ticket: 'CIN-2',
        kind: 'question',
        question: 'Rebase?',
        answer: 'Yes',
        askedAt: second.created_at,
        answeredAt: '2026-10-29 10:09:00'
      },
      {
        id: first.id,
        ticket: 'CIN-1',
        kind: 'question',
        question: 'Which port?',
        answer: '8080',
        askedAt: first.created_at,
        answeredAt: '2026-10-29 10:05:00'
      },
      {
        id: gate.id,
        ticket: 'CIN-2',
        kind: 'decision_gate',
        question: 'Ship it?',
        answer: 'Yes, ship it.',
        askedAt: gate.created_at,
        answeredAt: gateReply.created_at
      }
    ])
  })
})
