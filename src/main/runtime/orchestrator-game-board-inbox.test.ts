import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameBoard, withProjectLead, type GameBoardProject } from './orchestrator-game-board'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { GameStopSwitch } from './orchestrator-game-stop-switch'
import type { GameInboxMail } from '../../shared/orchestrator-game-inbox'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const LEAD_TERMINAL = { handle: 'term_lead', paneKey: 'tab:lead' }
const LEAD: GameBoardProject = {
  key: 'repo:r1',
  isMember: false,
  memberTicket: null,
  lead: LEAD_TERMINAL
}
const MEMBER: GameBoardProject = {
  key: 'repo:r1',
  isMember: true,
  memberTicket: 'CIN-1',
  lead: LEAD_TERMINAL
}

const mail = (sequence: number, to: string, from: string): GameInboxMail => ({
  id: `msg_${sequence}`,
  from_handle: from,
  to_handle: to,
  subject: `s${sequence}`,
  body: `b${sequence}`,
  type: 'question',
  read: 0,
  sequence,
  created_at: '2026-10-16 10:00:00',
  payload: null
})

function board(rows: GameInboxMail[], pendingQuestions: GameInboxMail[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-inbox-'))
  dirs.push(dir)
  const asked: unknown[] = []
  const game = new GameBoard({
    store: new GameHistoryStore(() => dir),
    stops: new GameStopSwitch(() => join(dir, 'stop')),
    projectOf: async (caller) => (caller.terminalHandle === 'term_1' ? MEMBER : LEAD),
    inboxSourceOf: (lead) => {
      asked.push(lead)
      return {
        leadAddresses: ['term_lead', 'run:run_1'],
        members: [{ ticket: 'CIN-1', addresses: ['term_1', 'dispatch:d1'] }],
        mail: rows,
        pendingQuestions
      }
    },
    tellLead: () => true
  })
  return { game, asked }
}

describe('GameBoard inbox', () => {
  it("reads the lead's inbox, and marks what it read so it is unread no more", async () => {
    const { game, asked } = board([mail(1, 'term_lead', 'term_1'), mail(2, 'term_lead', 'term_1')])

    const first = await game.inbox({ terminalHandle: 'term_lead', markRead: true })
    expect(first.inbox).toMatchObject({ key: 'lead', unread: 2 })
    expect(first.inbox.messages.map((one) => [one.id, one.from, one.unread])).toEqual([
      ['msg_2', 'CIN-1', true],
      ['msg_1', 'CIN-1', true]
    ])
    expect(asked).toEqual([LEAD_TERMINAL])

    const again = await game.inbox({ terminalHandle: 'term_lead', unread: true })
    expect(again.inbox).toMatchObject({ key: 'lead', unread: 0, messages: [] })
  })

  it("reads a ticket's inbox for the lead, and a member only ever its own", async () => {
    const { game } = board([mail(1, 'term_1', 'term_lead'), mail(2, 'term_lead', 'term_1')])

    expect(
      (await game.inbox({ terminalHandle: 'term_lead', ticket: 'cin-1' })).inbox
    ).toMatchObject({
      key: 'CIN-1',
      unread: 1
    })
    expect((await game.inbox({ terminalHandle: 'term_1', ticket: 'lead' })).inbox.key).toBe('CIN-1')
    expect((await game.inbox({ terminalHandle: 'term_lead', ticket: 'CIN-9' })).inbox).toEqual({
      key: 'CIN-9',
      unread: 0,
      messages: [],
      waiting: [],
      newest: 0
    })
  })

  it('sums each inbox for game state: unread count and last message, the lead first', async () => {
    const { game } = board([mail(1, 'term_1', 'term_lead'), mail(2, 'term_lead', 'term_1')])

    expect(await game.inboxSummary({ terminalHandle: 'term_lead' })).toEqual([
      {
        key: 'lead',
        unread: 1,
        last: { at: '2026-10-16 10:00:00', from: 'CIN-1', subject: 's2' },
        waiting: []
      },
      {
        key: 'CIN-1',
        unread: 1,
        last: { at: '2026-10-16 10:00:00', from: 'lead', subject: 's1' },
        waiting: []
      }
    ])
  })

  it('lists the questions the lead has not answered as waiting on it, even after it read them (ORCA-746 T6)', async () => {
    // Why: the question is past the window the mail read keeps, so only the pending list carries it.
    const { game } = board([], [{ ...mail(1, 'term_lead', 'term_1'), read: 1 }])

    expect(await game.inboxSummary({ terminalHandle: 'term_lead' })).toEqual([
      {
        key: 'lead',
        unread: 0,
        last: null,
        waiting: [{ id: 'msg_1', from: 'CIN-1', subject: 's1', at: '2026-10-16 10:00:00' }]
      },
      { key: 'CIN-1', unread: 0, last: null, waiting: [] }
    ])
  })

  it("gives the person's Inbox every ticket's thread and what waits on the lead, without marking anything read (ORCA-878)", async () => {
    const question = mail(2, 'term_lead', 'term_1')
    const { game } = board([mail(1, 'term_1', 'term_lead'), question], [question])

    const read = await game.inboxThreads({ worktreeId: 'wt_lead' })

    expect(
      read.threads.map((thread) => [thread.ticket, thread.messages.length, thread.waiting])
    ).toEqual([['CIN-1', 2, 1]])
    expect(read.waiting.map((item) => [item.id, item.ticket, item.answerer])).toEqual([
      ['msg_2', 'CIN-1', 'lead']
    ])
    expect(read.answered).toEqual([])
    expect((await game.inbox({ terminalHandle: 'term_lead' })).inbox.unread).toBe(1)
  })

  it("refuses a member the project's threads: it reads only its own ticket", async () => {
    const { game } = board([])

    await expect(game.inboxThreads({ terminalHandle: 'term_1' })).rejects.toThrow(/member/)
  })
})

describe('withProjectLead (ORCA-878)', () => {
  const PERSON: GameBoardProject = {
    key: 'repo:r1',
    isMember: false,
    memberTicket: null,
    lead: null
  }

  it("gives a caller with only a worktree its project's live lead, with that lead's pane", async () => {
    await expect(
      withProjectLead(
        PERSON,
        async () => 'term_lead',
        (handle) => `tab:${handle}`
      )
    ).resolves.toEqual({ ...PERSON, lead: { handle: 'term_lead', paneKey: 'tab:term_lead' } })
    await expect(
      withProjectLead(
        PERSON,
        async () => null,
        () => null
      )
    ).resolves.toEqual(PERSON)
  })

  it('keeps a terminal caller and a member as they are', async () => {
    const lookup = async () => 'term_other'
    await expect(withProjectLead(LEAD, lookup, () => null)).resolves.toBe(LEAD)
    await expect(withProjectLead({ ...MEMBER, lead: null }, lookup, () => null)).resolves.toEqual({
      ...MEMBER,
      lead: null
    })
  })
})
