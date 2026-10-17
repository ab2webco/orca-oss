import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameBoard, type GameBoardProject } from './orchestrator-game-board'
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

function board(rows: GameInboxMail[]) {
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
        mail: rows
      }
    }
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
      newest: 0
    })
  })

  it('sums each inbox for game state: unread count and last message, the lead first', async () => {
    const { game } = board([mail(1, 'term_1', 'term_lead'), mail(2, 'term_lead', 'term_1')])

    expect(await game.inboxSummary({ terminalHandle: 'term_lead' })).toEqual([
      { key: 'lead', unread: 1, last: { at: '2026-10-16 10:00:00', from: 'CIN-1', subject: 's2' } },
      { key: 'CIN-1', unread: 1, last: { at: '2026-10-16 10:00:00', from: 'lead', subject: 's1' } }
    ])
  })
})
