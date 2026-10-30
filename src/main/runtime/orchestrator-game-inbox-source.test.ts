import { describe, expect, it } from 'vitest'
import { gameInboxSourceOf, type GameInboxDb } from './orchestrator-game-inbox-source'

const row = (id: string, to: string) => ({
  id,
  from_handle: 'term_x',
  to_handle: to,
  subject: id,
  body: id,
  type: 'status',
  read: 0,
  sequence: Number(id.slice(4)),
  created_at: '2026-10-16 10:00:00',
  payload: null
})

function fakeDb(): { db: GameInboxDb; asked: string[] } {
  const asked: string[] = []
  const db: GameInboxDb = {
    getCurrentRunForPane: (paneKey) =>
      paneKey === 'tab:lead' ? { id: 'run_1', coordinator_handle: 'term_lead_old' } : undefined,
    listWorkerTerminalResources: () => [
      { dispatchId: 'd1', taskId: 't1', agentTerminalHandle: 'term_1' },
      { dispatchId: 'd1b', taskId: 't1', agentTerminalHandle: null },
      { dispatchId: 'd9', taskId: 't9', agentTerminalHandle: 'term_9' }
    ],
    getTask: (id) =>
      id === 't1'
        ? { task_title: 'CIN-1 Cartelera', display_name: null }
        : { task_title: 'Docs', display_name: null },
    listPendingQuestions: (runId) => (runId === 'run_1' ? [row('msg_1', 'term_lead')] : []),
    listAnsweredQuestions: (runId) =>
      runId === 'run_1'
        ? [
            {
              ...row('msg_3', 'run:run_1'),
              answer_body: '8080',
              answered_at: '2026-10-16 10:05:00'
            }
          ]
        : [],
    getAllMessagesForHandle: (handle) => {
      asked.push(handle)
      return handle === 'dispatch:d1b'
        ? [row('msg_2', handle)]
        : handle === 'term_lead'
          ? [row('msg_1', handle)]
          : []
    }
  }
  return { db, asked }
}

describe('gameInboxSourceOf', () => {
  it("collects the lead's terminals and run mailbox and each ticket's terminals and dispatches, closed ones too", () => {
    const { db, asked } = fakeDb()

    const source = gameInboxSourceOf(db, { handle: 'term_lead', paneKey: 'tab:lead' })

    expect(source.leadAddresses).toEqual(['term_lead', 'term_lead_old', 'run:run_1'])
    expect(source.members).toEqual([
      { ticket: 'CIN-1', addresses: ['term_1', 'dispatch:d1', 'dispatch:d1b'] }
    ])
    expect(source.mail.map((one) => one.id)).toEqual(['msg_1', 'msg_2'])
    expect(asked).toEqual([
      'term_lead',
      'term_lead_old',
      'run:run_1',
      'term_1',
      'dispatch:d1',
      'dispatch:d1b'
    ])
  })

  it("carries the ids of the run's questions still awaiting an answer (ORCA-746 T6)", () => {
    const { db } = fakeDb()

    expect(
      gameInboxSourceOf(db, { handle: 'term_lead', paneKey: 'tab:lead' }).pendingQuestions
    ).toEqual([row('msg_1', 'term_lead')])
  })

  it("carries the run's answered questions with their answers, for the Inbox audit (ORCA-878)", () => {
    const { db } = fakeDb()

    expect(
      gameInboxSourceOf(db, { handle: 'term_lead', paneKey: 'tab:lead' }).answeredQuestions
    ).toEqual([
      { ...row('msg_3', 'run:run_1'), answer_body: '8080', answered_at: '2026-10-16 10:05:00' }
    ])
  })

  it('has only the lead terminal when the lead has no run yet', () => {
    const { db } = fakeDb()
    const source = gameInboxSourceOf(db, { handle: 'term_lead', paneKey: null })
    expect(source.leadAddresses).toEqual(['term_lead'])
    expect(source.members).toEqual([])
  })

  it("carries the peer leads' labels so mail from one is named", () => {
    const { db } = fakeDb()
    const source = gameInboxSourceOf(
      db,
      { handle: 'term_lead', paneKey: null },
      { term_peer: 'Bo' }
    )
    expect(source.peerLeads).toEqual({ term_peer: 'Bo' })
  })
})
