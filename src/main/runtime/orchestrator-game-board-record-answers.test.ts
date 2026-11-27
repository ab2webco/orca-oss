import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GameBoard,
  type GameBoardCaller,
  type GameBoardLead,
  type GameBoardProject,
  type GameLeadNote
} from './orchestrator-game-board'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { GameStopSwitch } from './orchestrator-game-stop-switch'

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

const ask = {
  terminalHandle: 'term_lead',
  ticket: 'cin-1',
  question: 'Ship the arcade in lab.111?',
  options: ['Yes', 'Wait for lab.112']
}

// Why these phrases: each is how today's notes told the lead to comment on the tracker (ORCA-1488).
const TRACKER_INSTRUCTION = /Record this|on CIN-1\b/

function board(
  project: () => GameBoardProject,
  recordsAnswersOnTicket?: (caller: GameBoardCaller) => Promise<boolean>
) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-record-answers-'))
  dirs.push(dir)
  const told: { lead: GameBoardLead; note: GameLeadNote }[] = []
  const asked: GameBoardCaller[] = []
  const game = new GameBoard({
    store: new GameHistoryStore(() => dir),
    stops: new GameStopSwitch(() => join(dir, 'stop')),
    projectOf: async () => project(),
    inboxSourceOf: () => ({ leadAddresses: [], members: [], mail: [] }),
    tellLead: (lead, note) => {
      told.push({ lead, note })
      return true
    },
    ...(recordsAnswersOnTicket
      ? {
          recordsAnswersOnTicket: (caller: GameBoardCaller) => {
            asked.push(caller)
            return recordsAnswersOnTicket(caller)
          }
        }
      : {}),
    replyToMember: () => ({ mode: 'answered', question: 'Which port?' })
  })
  return { game, told, asked }
}

describe('GameBoard with orchestrator.recordAnswersOnTicket (ORCA-1488)', () => {
  it('tells the lead the answer is kept in Orca, never to comment it on the tracker, when the project turns it off', async () => {
    const { game, told, asked } = board(
      () => LEAD,
      async () => false
    )
    const { question } = await game.askOwner(ask)

    await game.answerOwner({ terminalHandle: 'term_lead', id: question.id, option: 2 })

    expect(asked).toEqual([{ terminalHandle: 'term_lead', id: question.id, option: 2 }])
    const body = told[0]?.note.body ?? ''
    expect(body).toContain('Answer: Wait for lab.112')
    expect(body).toContain('Orca already keeps this answer')
    expect(body).toContain('do not comment it on the tracker')
    expect(body).not.toMatch(TRACKER_INSTRUCTION)
  })

  it('words a held answer handed over on an inbox read by the same setting', async () => {
    let lead: GameBoardLead | null = null
    const { game, told } = board(
      () => ({ ...LEAD, lead }),
      async () => false
    )
    const { question } = await game.askOwner(ask)
    await game.answerOwner({ worktreeId: 'wt', id: question.id, text: 'Yes' })
    expect(told).toEqual([])

    lead = { handle: 'term_next_lead', paneKey: 'tab:next' }
    await game.inbox({ terminalHandle: 'term_next_lead' })

    expect(told).toHaveLength(1)
    expect(told[0]?.note.body).toContain('do not comment it on the tracker')
    expect(told[0]?.note.body).not.toMatch(TRACKER_INSTRUCTION)
  })

  it('words the Inbox reply note by the same setting', async () => {
    const { game, told } = board(
      () => LEAD,
      async () => false
    )

    await game.replyToMember({ worktreeId: 'wt', id: 'msg_1', text: '8080', ticket: 'cin-1' })

    expect(told[0]?.note.body).toContain('do not comment it on the tracker')
    expect(told[0]?.note.body).not.toMatch(TRACKER_INSTRUCTION)
  })

  it('keeps recording on the ticket when unset, true, or unreadable, with no Orca ids copied there', async () => {
    for (const records of [
      undefined,
      async () => true,
      async (): Promise<boolean> => {
        throw new Error('no yaml')
      }
    ]) {
      const { game, told } = board(() => LEAD, records)
      const { question } = await game.askOwner(ask)

      await game.answerOwner({ terminalHandle: 'term_lead', id: question.id, option: 1 })

      const body = told[0]?.note.body ?? ''
      expect(body).toContain(
        "Record this answer on CIN-1: the question and the answer in product terms, never Orca's ids, hosts or authorizations."
      )
      expect(body).toContain(`cite ${question.id} in that mail, never on the tracker`)
    }
  })
})
