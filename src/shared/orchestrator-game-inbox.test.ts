import { describe, expect, it } from 'vitest'
import { gameInboxesOf, type GameInboxMail, type GameInboxSource } from './orchestrator-game-inbox'

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
    created_at: `2026-10-16 10:00:${String(sequence).padStart(2, '0')}`,
    payload: null,
    ...overrides
  }
}

function source(rows: GameInboxMail[]): GameInboxSource {
  return {
    leadAddresses: ['term_lead', 'run:run_1'],
    members: [
      { ticket: 'CIN-1', addresses: ['term_1', 'dispatch:d1', 'term_1b', 'dispatch:d1b'] },
      { ticket: 'CIN-2', addresses: ['term_2', 'dispatch:d2'] }
    ],
    mail: rows
  }
}

describe('gameInboxesOf', () => {
  it("files every message under the lead or the ticket it was sent to, newest first, naming the sender's ticket", () => {
    sequence = 0
    const rows = [
      mail('term_lead', 'term_1', { type: 'question' }),
      mail('term_1', 'term_lead'),
      mail('dispatch:d1b', 'term_lead'),
      mail('run:run_1', 'term_2', { read: 1 })
    ]

    const [lead, cin1, cin2] = gameInboxesOf(source(rows), {})

    expect(lead?.key).toBe('lead')
    expect(lead?.messages.map((one) => [one.id, one.from, one.unread])).toEqual([
      ['msg_4', 'CIN-2', false],
      ['msg_1', 'CIN-1', true]
    ])
    expect(lead?.unread).toBe(1)
    expect(cin1).toMatchObject({ key: 'CIN-1', unread: 2 })
    expect(cin1?.messages.map((one) => [one.id, one.from, one.to])).toEqual([
      ['msg_3', 'lead', 'CIN-1'],
      ['msg_2', 'lead', 'CIN-1']
    ])
    expect(cin2).toMatchObject({ key: 'CIN-2', unread: 0, messages: [] })
  })

  it("names a peer project's lead by its label instead of its raw handle", () => {
    sequence = 0
    const rows = [mail('term_lead', 'term_peer', { type: 'request' }), mail('term_lead', 'term_x')]

    const [lead] = gameInboxesOf({ ...source(rows), peerLeads: { term_peer: 'Bo' } }, {})

    expect(lead?.messages.map((one) => one.from)).toEqual(['term_x', 'lead Bo'])
  })

  it('keeps naming this lead and its members first when a peer shares their handle', () => {
    sequence = 0
    const rows = [mail('term_lead', 'term_1'), mail('term_1', 'term_lead')]

    const [lead, cin1] = gameInboxesOf(
      { ...source(rows), peerLeads: { term_1: 'Bo', term_lead: 'Bo' } },
      {}
    )

    expect(lead?.messages.map((one) => one.from)).toEqual(['CIN-1'])
    expect(cin1?.messages.map((one) => one.from)).toEqual(['lead'])
  })

  it("keeps a member's worker_done once per dispatch, even when it lands twice", () => {
    sequence = 0
    const done = { type: 'worker_done', payload: JSON.stringify({ dispatchId: 'd1' }) }
    const rows = [
      mail('run:run_1', 'term_1', { ...done, body: 'TERMINADO CIN-1' }),
      mail('run:run_1', 'term_1', { ...done, body: 'TERMINADO CIN-1 (again)' }),
      mail('run:run_1', 'term_1b', {
        type: 'worker_done',
        payload: JSON.stringify({ dispatchId: 'd1b' })
      })
    ]

    const [lead] = gameInboxesOf(source(rows), {})

    expect(lead?.messages.map((one) => one.id)).toEqual(['msg_3', 'msg_1'])
    expect(lead?.unread).toBe(2)
  })

  it('leaves heartbeats out of the inbox: three beats and a worker_done are one unread message (ORCA-637)', () => {
    sequence = 0
    const beat = { type: 'heartbeat', subject: 'alive', body: '' }
    const rows = [
      mail('run:run_1', 'term_1', beat),
      mail('run:run_1', 'term_1', beat),
      mail('run:run_1', 'term_1', { type: 'worker_done', subject: 'done' }),
      mail('run:run_1', 'term_1', beat)
    ]

    const [lead] = gameInboxesOf(source(rows), {})

    expect(lead?.messages.map((one) => [one.id, one.type])).toEqual([['msg_3', 'worker_done']])
    expect(lead?.unread).toBe(1)
  })

  it("collapses a member's failure once a later dispatch of the same ticket is alive (ORCA-746)", () => {
    sequence = 0
    const rows = [
      mail('run:run_1', 'dispatch:d1', {
        subject: 'Setup failed for worker d1',
        payload: JSON.stringify({ dispatchId: 'd1', setupState: 'failed' })
      }),
      mail('run:run_1', 'dispatch:d2', {
        subject: 'First signal deadline expired',
        payload: JSON.stringify({ dispatchId: 'd2', reason: 'first_signal_deadline_expired' })
      }),
      mail('run:run_1', 'term_1b', {
        type: 'heartbeat',
        payload: JSON.stringify({ dispatchId: 'd1b' })
      })
    ]

    const [lead] = gameInboxesOf(source(rows), {})

    expect(lead?.messages.map((one) => one.id)).toEqual(['msg_2'])
    expect(lead?.unread).toBe(1)
  })

  it('drops a deadline failure once the same dispatch is reattached, but not when it is only orphaned (ORCA-658)', () => {
    sequence = 0
    const failed = (dispatchId: string) =>
      mail('run:run_1', `dispatch:${dispatchId}`, {
        payload: JSON.stringify({ dispatchId, reason: 'first_signal_deadline_expired' })
      })
    const rows = [
      failed('d1'),
      failed('d2'),
      mail('run:run_1', 'dispatch:d1', {
        payload: JSON.stringify({ dispatchId: 'd1', reason: 'reattached_by_activity' })
      }),
      mail('run:run_1', 'dispatch:d2', {
        payload: JSON.stringify({ dispatchId: 'd2', reason: 'orphaned_still_working' })
      })
    ]

    const [lead] = gameInboxesOf(source(rows), {})

    expect(lead?.messages.map((one) => one.id)).toEqual(['msg_4', 'msg_3', 'msg_2'])
  })

  it("collapses a member's failure once the same ticket reports success, and keeps it while only the failed dispatch talks", () => {
    sequence = 0
    const rows = [
      mail('run:run_1', 'term_1', {
        type: 'escalation',
        subject: 'Agent exited unexpectedly (code 1)',
        payload: JSON.stringify({ taskId: 't1', exitCode: 1, handle: 'term_1' })
      }),
      mail('run:run_1', 'term_2', {
        type: 'worker_done',
        payload: JSON.stringify({ dispatchId: 'd2', outcome: 'failed' })
      }),
      mail('run:run_1', 'term_2', {
        type: 'heartbeat',
        payload: JSON.stringify({ dispatchId: 'd2' })
      }),
      mail('run:run_1', 'term_1b', {
        type: 'worker_done',
        payload: JSON.stringify({ dispatchId: 'd1b', outcome: 'succeeded' })
      })
    ]

    const [lead] = gameInboxesOf(source(rows), {})

    expect(lead?.messages.map((one) => one.id)).toEqual(['msg_4', 'msg_2'])
  })

  it('keeps an unanswered question in the lead waiting list past the 50-message cap (ORCA-746 T6)', () => {
    sequence = 0
    const question = mail('term_lead', 'term_1', { type: 'question', read: 1 })
    const rows = Array.from({ length: 60 }, () => mail('term_lead', 'term_2'))

    // Why: the question is outside the window the mail read keeps, as an old one is once a lead has 100 newer messages.
    const lead = gameInboxesOf({ ...source(rows), pendingQuestions: [question] }, {})[0]

    expect(lead?.messages.some((one) => one.id === 'msg_1')).toBe(false)
    expect(lead?.waiting).toEqual([
      { id: 'msg_1', from: 'CIN-1', subject: 's1', at: '2026-10-16 10:00:01' }
    ])
  })

  it('counts as read what the board marked read up to its cursor, or what the agent already read', () => {
    sequence = 0
    const rows = [
      mail('term_lead', 'term_1'),
      mail('term_lead', 'term_2'),
      mail('term_lead', 'term_2', { read: 1 })
    ]

    const [lead] = gameInboxesOf(source(rows), { lead: 1 })

    expect(lead?.messages.map((one) => [one.id, one.unread])).toEqual([
      ['msg_3', false],
      ['msg_2', true],
      ['msg_1', false]
    ])
    expect(lead?.unread).toBe(1)
    expect(lead?.newest).toBe(3)
  })
})
