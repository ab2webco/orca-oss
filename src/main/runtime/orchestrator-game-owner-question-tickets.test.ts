import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameBoard, type GameBoardProject, type GameLeadNote } from './orchestrator-game-board'
import { GameHistoryStore } from './orchestrator-game-history-store'
import {
  keepRemoteMemberOwnerAnswers,
  readBoardOwnerAnswer,
  readRemoteMemberOwnerAnswer,
  shareOwnerAnswersWithRemoteMember,
  type OwnerAnswerShareMark,
  type RemoteMemberOwnerAnswers
} from './orchestrator-game-member-owner-answer-check'
import { GameStopSwitch } from './orchestrator-game-stop-switch'
import {
  gameOwnerQuestionDraftOf,
  parseGameOwnerQuestion
} from '../../shared/orchestrator-game-owner-questions'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-owner-tickets-'))
  dirs.push(dir)
  return dir
}

const LEAD: GameBoardProject = {
  key: 'repo:cineco',
  isMember: false,
  memberTicket: null,
  lead: { handle: 'term_lead', paneKey: 'tab:lead' }
}
const memberOn = (ticket: string): GameBoardProject => ({
  ...LEAD,
  isMember: true,
  memberTicket: ticket
})

function leadHost() {
  const dir = tempDir()
  const store = new GameHistoryStore(() => dir)
  const told: GameLeadNote[] = []
  const game = new GameBoard({
    store,
    stops: new GameStopSwitch(() => join(dir, 'stop')),
    projectOf: async () => LEAD,
    inboxSourceOf: () => ({ leadAddresses: [], members: [], mail: [] }),
    tellLead: (_lead, note) => {
      told.push(note)
      return true
    },
    now: () => new Date(Date.UTC(2026, 10, 27, 10, 0, 0))
  })
  return { game, store, told }
}

const NOW = Date.parse('2026-11-27T10:05:00.000Z')
const fresh = { keptAt: NOW - 1_000, now: NOW }

/** Members of CIN-1401 and CIN-1838 run on host m1; the lead and its board stay on its own host. */
async function pairedHosts() {
  const lead = leadHost()
  const m1Dir = tempDir()
  const m1 = new GameHistoryStore(() => m1Dir)
  const members: Record<string, string> = { ctx_1401: 'CIN-1401', ctx_1838: 'CIN-1838' }
  const deps = {
    memberOf: async (dispatchId: string) =>
      members[dispatchId]
        ? { ticket: members[dispatchId], projectKey: LEAD.key, environmentId: 'env_m1' }
        : null,
    questionsOf: (key: string) => lead.store.ownerQuestions(key),
    send: async (_env: string, shared: RemoteMemberOwnerAnswers) => {
      await keepRemoteMemberOwnerAnswers(m1, shared)
    },
    version: () => 1,
    now: () => NOW,
    sent: new Map<string, OwnerAnswerShareMark>()
  }
  const share = async () => {
    deps.sent.clear()
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1401')
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1838')
  }
  return { lead, m1, deps, share }
}

describe('one owner question for several tickets (ORCA-1490)', () => {
  it('a member on a paired host reads a question on its ticket and one naming several tickets', async () => {
    const { lead, m1, share } = await pairedHosts()
    const own = await lead.game.askOwner({ ticket: 'CIN-1401', question: 'Merge #12?' })
    const several = await lead.game.askOwner({
      tickets: ['cin-1900', 'CIN-1401', 'CIN-1838'],
      question: 'Merge the three PRs and deploy?',
      options: ['Yes', 'No']
    })
    await lead.game.answerOwner({ id: several.question.id, option: 1 })
    await share()

    await expect(
      readRemoteMemberOwnerAnswer(m1, 'ctx_1401', own.question.id, fresh)
    ).resolves.toMatchObject({ question: { id: own.question.id, ticket: 'CIN-1401' } })
    for (const dispatchId of ['ctx_1401', 'ctx_1838']) {
      await expect(
        readRemoteMemberOwnerAnswer(m1, dispatchId, several.question.id, fresh)
      ).resolves.toMatchObject({
        question: {
          id: several.question.id,
          tickets: ['CIN-1900', 'CIN-1401', 'CIN-1838'],
          answer: { text: 'Yes' }
        }
      })
    }
  })

  it('refuses a paired-host member whose ticket the question does not name', async () => {
    const { lead, m1, share } = await pairedHosts()
    const other = await lead.game.askOwner({
      tickets: ['CIN-1900', 'CIN-1401'],
      question: 'Merge both?'
    })
    await share()

    await expect(
      readRemoteMemberOwnerAnswer(m1, 'ctx_1838', other.question.id, fresh)
    ).rejects.toThrow(
      `No question ${other.question.id} naming your ticket reached this host. Your lead's host shares every question that names your ticket`
    )
  })

  it("shares each copy under the member's own ticket, so a member host from before it keeps it", async () => {
    const { lead, deps } = await pairedHosts()
    const several = await lead.game.askOwner({
      tickets: ['CIN-1900', 'CIN-1838'],
      question: 'Merge both?'
    })
    const sent: RemoteMemberOwnerAnswers[] = []
    deps.send = async (_env, shared) => {
      sent.push(shared)
    }

    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1838')
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1401')

    // What a pre-ORCA-1490 member host keeps: questions whose `ticket` is its own.
    const keptByOldHost = sent.flatMap((one) =>
      one.questions.filter(
        (q) => (q as { ticket: string | null }).ticket?.toUpperCase() === one.ticket.toUpperCase()
      )
    )
    expect(sent.map((one) => one.ticket)).toEqual(['CIN-1838'])
    expect(keptByOldHost).toMatchObject([{ id: several.question.id, ticket: 'CIN-1838' }])
  })

  it("on the lead's host a member reads a question naming its ticket among others, and another is refused", async () => {
    const { game, store } = leadHost()
    const several = await game.askOwner({ tickets: ['CIN-1', 'CIN-2'], question: 'Merge both?' })

    await expect(
      readBoardOwnerAnswer(store, memberOn('cin-2'), { id: several.question.id })
    ).resolves.toMatchObject({ question: { ticket: 'CIN-1', tickets: ['CIN-1', 'CIN-2'] } })
    await expect(
      readBoardOwnerAnswer(store, memberOn('CIN-3'), { id: several.question.id })
    ).rejects.toThrow(
      `Question ${several.question.id} does not name your ticket CIN-3, so it does not cover your work. Ask your lead to ask the person with --ticket CIN-3.`
    )
  })

  it('tells the lead the answer once, naming every ticket', async () => {
    const { game, told } = leadHost()
    const several = await game.askOwner({ tickets: ['CIN-1', 'CIN-2'], question: 'Merge both?' })

    await game.answerOwner({ id: several.question.id, text: 'Yes' })
    await game.answerOwner({ id: several.question.id, text: 'Yes' })

    expect(told).toHaveLength(1)
    expect(told[0].subject).toBe('Owner answered CIN-1, CIN-2: Merge both?')
    expect(told[0].body).toContain('Record this answer on CIN-1, CIN-2')
    expect(told[0].payload).toMatchObject({ ticket: 'CIN-1', tickets: ['CIN-1', 'CIN-2'] })
  })
})

describe('the several-ticket record', () => {
  it('keeps a one-ticket record exactly as older builds wrote it, and dedupes several', () => {
    expect(gameOwnerQuestionDraftOf({ ticket: ' cin-1 ', question: 'Q' })).toEqual({
      ticket: 'CIN-1',
      question: 'Q',
      options: [],
      context: null
    })
    expect(
      gameOwnerQuestionDraftOf({ ticket: 'cin-1', tickets: ['CIN-2', 'cin-1', ' '], question: 'Q' })
    ).toMatchObject({ ticket: 'CIN-1', tickets: ['CIN-1', 'CIN-2'] })
    expect(() =>
      gameOwnerQuestionDraftOf({
        tickets: Array.from({ length: 11 }, (_, i) => `CIN-${i}`),
        question: 'Q'
      })
    ).toThrow('Name at most 10 tickets.')
  })

  it('parses tickets when present and ignores a malformed list', () => {
    const base = {
      id: 'oq_1',
      ticket: 'CIN-1',
      question: 'Q',
      options: [],
      context: null,
      askedAt: '2026-11-27T10:00:00.000Z',
      answer: null
    }
    expect(parseGameOwnerQuestion({ ...base, tickets: ['CIN-1', 'CIN-2'] })?.tickets).toEqual([
      'CIN-1',
      'CIN-2'
    ])
    expect(parseGameOwnerQuestion({ ...base, tickets: [1] })).not.toHaveProperty('tickets')
    expect(parseGameOwnerQuestion(base)).not.toHaveProperty('tickets')
  })
})
