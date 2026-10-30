import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GameBoard,
  type GameBoardLead,
  type GameBoardProject,
  type GameLeadNote
} from './orchestrator-game-board'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { GameStopSwitch } from './orchestrator-game-stop-switch'
import type { OwnerMemberReply } from './orchestrator-game-owner-member-reply'

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

function board(project: GameBoardProject, outcome: () => OwnerMemberReply) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-member-reply-'))
  dirs.push(dir)
  const told: { lead: GameBoardLead; note: GameLeadNote }[] = []
  const replies: unknown[] = []
  const game = new GameBoard({
    store: new GameHistoryStore(() => dir),
    stops: new GameStopSwitch(() => join(dir, 'stop')),
    projectOf: async () => project,
    inboxSourceOf: () => ({ leadAddresses: [], members: [], mail: [] }),
    tellLead: (lead, note) => {
      told.push({ lead, note })
      return true
    },
    replyToMember: (lead, args) => {
      replies.push({ lead, args })
      return outcome()
    }
  })
  return { game, told, replies }
}

describe('GameBoard.replyToMember (ORCA-878)', () => {
  it('sends the person’s words through the lead, then tells the lead once to record them on the ticket', async () => {
    const { game, told, replies } = board(LEAD, () => ({
      mode: 'answered',
      question: 'Which port?'
    }))

    await expect(
      game.replyToMember({ worktreeId: 'wt', id: 'msg_1', text: '8080', ticket: 'orca-14' })
    ).resolves.toEqual({ mode: 'answered', delivered: true })

    expect(replies).toEqual([{ lead: LEAD_TERMINAL, args: { id: 'msg_1', text: '8080' } }])
    expect(told).toEqual([
      {
        lead: LEAD_TERMINAL,
        note: {
          subject: 'Owner answered ORCA-14: Which port?',
          body: 'Answer: 8080\nQuestion: Which port?\nRecord this on ORCA-14.',
          payload: { ownerMemberReply: 'msg_1', mode: 'answered', ticket: 'ORCA-14', text: '8080' }
        }
      }
    ])
  })

  it('names an override as one, so the lead does not repeat its earlier answer', async () => {
    const { game, told } = board(LEAD, () => ({ mode: 'override', question: 'Rebase?' }))

    await game.replyToMember({ worktreeId: 'wt', id: 'msg_2', text: 'Yes' })

    expect(told[0]?.note.subject).toBe('Owner overrode your answer: Rebase?')
    expect(told[0]?.note.body).toContain('Record this.')
  })

  it('refuses a member, and a project with no live lead to speak through', async () => {
    const outcome = (): OwnerMemberReply => ({ mode: 'reply', question: 'x' })
    await expect(
      board({ ...LEAD, isMember: true, memberTicket: 'CIN-1' }, outcome).game.replyToMember({
        terminalHandle: 'term_1',
        id: 'msg_1',
        text: 'x'
      })
    ).rejects.toThrow(/member/)
    await expect(
      board({ ...LEAD, lead: null }, outcome).game.replyToMember({
        worktreeId: 'wt',
        id: 'msg_1',
        text: 'x'
      })
    ).rejects.toThrow(/no live lead/)
  })

  it('passes on why the reply failed, so the Inbox can show it', async () => {
    const { game, told } = board(LEAD, () => {
      throw new Error('Its member is gone, so the reply was not sent.')
    })

    await expect(game.replyToMember({ worktreeId: 'wt', id: 'msg_1', text: 'x' })).rejects.toThrow(
      /member is gone/
    )
    expect(told).toEqual([])
  })
})
