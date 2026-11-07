import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GameBoard,
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
const MEMBER: GameBoardProject = { ...LEAD, isMember: true, memberTicket: 'CIN-1' }

function board(
  project: (caller: { terminalHandle?: string }) => GameBoardProject,
  accepts: (lead: GameBoardLead) => boolean = () => true,
  later?: (ms: number, run: () => void) => void
) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-owner-'))
  dirs.push(dir)
  const told: { lead: GameBoardLead; note: GameLeadNote }[] = []
  const changed: string[] = []
  const events: string[] = []
  const game = new GameBoard({
    store: new GameHistoryStore(() => dir),
    stops: new GameStopSwitch(() => join(dir, 'stop')),
    projectOf: async (caller) => project(caller),
    inboxSourceOf: () => ({ leadAddresses: [], members: [], mail: [] }),
    tellLead: (lead, note) => {
      if (!accepts(lead)) {
        return false
      }
      told.push({ lead, note })
      return true
    },
    ownerQuestionsChanged: (projectKey) => changed.push(projectKey),
    ownerQuestionSettled: (projectKey, question) =>
      events.push(`${question.answer ? 'answered' : 'asked'} ${projectKey} ${question.id}`),
    now: () => new Date(Date.UTC(2026, 9, 29, 10, 0, 0)),
    ...(later ? { later } : {})
  })
  return { game, told, changed, events }
}

const ask = {
  terminalHandle: 'term_lead',
  ticket: 'cin-1',
  question: 'Ship the arcade in lab.111?',
  options: ['Yes', 'Wait for lab.112'],
  context: 'https://example.test/pr/41'
}

describe('GameBoard owner questions', () => {
  it('keeps what the lead asks with its ticket, options, context and age', async () => {
    const { game } = board(() => LEAD)
    const { question } = await game.askOwner(ask)

    expect(question).toMatchObject({
      id: expect.stringMatching(/^oq_/),
      ticket: 'CIN-1',
      question: 'Ship the arcade in lab.111?',
      options: ['Yes', 'Wait for lab.112'],
      context: 'https://example.test/pr/41',
      askedAt: '2026-10-29T10:00:00.000Z',
      answer: null
    })
    await expect(game.ownerQuestions({ terminalHandle: 'term_lead' })).resolves.toEqual({
      questions: [question],
      open: 1,
      undelivered: []
    })
  })

  it('refuses a member, which asks its lead instead', async () => {
    const { game } = board(() => MEMBER)
    await expect(game.askOwner(ask)).rejects.toThrow(/member asks its lead/)
  })

  it('refuses an empty question and too many options', async () => {
    const { game } = board(() => LEAD)
    await expect(game.askOwner({ ...ask, question: '  ' })).rejects.toThrow(/question is empty/)
    await expect(
      game.askOwner({ ...ask, options: ['1', '2', '3', '4', '5', '6', '7'] })
    ).rejects.toThrow(/at most 6 options/)
  })

  it("delivers the person's answer to the lead as an escalation and closes the question", async () => {
    const { game, told } = board(() => LEAD)
    const { question } = await game.askOwner(ask)

    const answered = await game.answerOwner({
      terminalHandle: 'term_lead',
      id: question.id,
      option: 2
    })

    expect(answered).toMatchObject({
      question: { answer: { text: 'Wait for lab.112' } },
      delivered: true,
      repeated: false
    })
    expect(told).toEqual([
      {
        lead: LEAD_TERMINAL,
        note: {
          subject: 'Owner answered CIN-1: Ship the arcade in lab.111?',
          body: [
            'Answer: Wait for lab.112',
            'Question: Ship the arcade in lab.111?',
            'Record this answer on CIN-1.'
          ].join('\n'),
          payload: { ownerQuestionId: question.id, ticket: 'CIN-1', answer: 'Wait for lab.112' }
        }
      }
    ])
    expect(await game.ownerQuestions({ terminalHandle: 'term_lead' })).toEqual({
      questions: [],
      open: 0,
      undelivered: []
    })
    expect(
      (await game.ownerQuestions({ terminalHandle: 'term_lead', all: true })).questions
    ).toHaveLength(1)
  })

  it('tells the lead once for a repeated answer and refuses a different one', async () => {
    const { game, told } = board(() => LEAD)
    const { question } = await game.askOwner(ask)
    await game.answerOwner({ id: question.id, text: 'Yes' })

    await expect(game.answerOwner({ id: question.id, text: 'Yes' })).resolves.toMatchObject({
      repeated: true,
      delivered: false
    })
    await expect(game.answerOwner({ id: question.id, text: 'No' })).rejects.toThrow(
      /already answered: Yes/
    )
    await expect(game.answerOwner({ id: 'oq_missing', text: 'No' })).rejects.toThrow(/oq_missing/)
    expect(told).toHaveLength(1)
  })

  it('refuses an answer from a member', async () => {
    const { game } = board((caller) => (caller.terminalHandle === 'term_member' ? MEMBER : LEAD))
    const { question } = await game.askOwner(ask)
    await expect(
      game.answerOwner({ terminalHandle: 'term_member', id: question.id, text: 'Yes' })
    ).rejects.toThrow(/member cannot answer/)
  })

  it('signals the project when a question is asked or answered, not when nothing changed', async () => {
    const { game, changed } = board(() => LEAD)
    const { question } = await game.askOwner(ask)
    await game.answerOwner({ id: question.id, text: 'Yes' })
    await game.answerOwner({ id: question.id, text: 'Yes' })
    await game.ownerQuestions({ terminalHandle: 'term_lead' })

    expect(changed).toEqual(['repo:r1', 'repo:r1'])
  })

  // Why (ORCA-942): an answer given while no lead could take it was lost, and the lead asked again.
  it("keeps an answer no lead received and delivers it once to the project's next lead", async () => {
    let lead: GameBoardLead | null = null
    const { game, told } = board(() => ({ ...LEAD, lead }))
    const { question } = await game.askOwner(ask)

    await expect(
      game.answerOwner({ worktreeId: 'wt', id: question.id, text: 'Yes' })
    ).resolves.toMatchObject({ delivered: false, repeated: false })
    expect(told).toEqual([])

    lead = { handle: 'term_next_lead', paneKey: 'tab:next' }
    const listed = await game.ownerQuestions({ terminalHandle: 'term_next_lead' })

    expect(listed).toMatchObject({ questions: [], open: 0 })
    expect(listed.undelivered).toMatchObject([{ id: question.id, answer: { text: 'Yes' } }])
    expect(told).toMatchObject([
      { lead, note: { payload: { ownerQuestionId: question.id, answer: 'Yes' } } }
    ])

    await game.ownerQuestions({ terminalHandle: 'term_next_lead' })
    await game.inbox({ terminalHandle: 'term_next_lead' })
    expect(told).toHaveLength(1)
    expect((await game.ownerQuestions({ terminalHandle: 'term_next_lead' })).undelivered).toEqual(
      []
    )
  })

  it("retries a note the lead's mail refused on the next read of its inbox", async () => {
    let open = false
    const { game, told } = board(
      () => LEAD,
      () => open
    )
    const { question } = await game.askOwner(ask)

    await expect(game.answerOwner({ id: question.id, option: 1 })).resolves.toMatchObject({
      delivered: false
    })
    const stored = await game.ownerQuestions({ terminalHandle: 'term_lead', all: true })
    expect(stored.questions[0]?.answer).toMatchObject({ text: 'Yes', undelivered: true })

    open = true
    await game.inbox({ terminalHandle: 'term_lead' })

    expect(told).toMatchObject([{ lead: LEAD_TERMINAL, note: { payload: { answer: 'Yes' } } }])
    const after = await game.ownerQuestions({ terminalHandle: 'term_lead', all: true })
    expect(after.questions[0]?.answer).toEqual({ text: 'Yes', at: '2026-10-29T10:00:00.000Z' })
  })

  // Why (ORCA-1100): a held answer waited for a read nobody made, so the lead's watch slept through it.
  it('retries a held answer on its own until the live lead takes it, without any read', async () => {
    let lead: GameBoardLead | null = null
    const pending: (() => void)[] = []
    const { game, told, changed } = board(
      () => ({ ...LEAD, lead }),
      () => true,
      (_ms, run) => pending.push(run)
    )
    const { question } = await game.askOwner(ask)
    await expect(
      game.answerOwner({ worktreeId: 'wt', id: question.id, text: 'Yes' })
    ).resolves.toMatchObject({ delivered: false })
    expect(pending).toHaveLength(1)

    const tick = async (): Promise<void> => {
      pending.shift()?.()
      await vi.waitFor(() => expect(pending.length > 0 || told.length > 0).toBe(true))
    }
    await tick()
    expect(told).toEqual([])

    lead = { handle: 'term_fresh_lead', paneKey: 'tab:fresh' }
    changed.length = 0
    await tick()
    await vi.waitFor(() => expect(changed).toEqual(['repo:r1']))

    expect(told).toMatchObject([{ lead, note: { payload: { ownerQuestionId: question.id } } }])
    expect(pending).toEqual([])
  })

  it('runs one retry per project however many answers are held', async () => {
    const pending: (() => void)[] = []
    const { game } = board(
      () => ({ ...LEAD, lead: null }),
      () => true,
      (_ms, run) => pending.push(run)
    )
    const first = await game.askOwner(ask)
    const second = await game.askOwner({ ...ask, question: 'And lab.112?' })
    await game.answerOwner({ worktreeId: 'wt', id: first.question.id, text: 'Yes' })
    await game.answerOwner({ worktreeId: 'wt', id: second.question.id, text: 'No' })

    expect(pending).toHaveLength(1)
  })

  it('hands held answers to a lead that just registered', async () => {
    let lead: GameBoardLead | null = null
    const { game, told, changed } = board(
      () => ({ ...LEAD, lead }),
      () => true,
      () => undefined
    )
    const { question } = await game.askOwner(ask)
    await game.answerOwner({ worktreeId: 'wt', id: question.id, text: 'Yes' })

    await expect(game.heldAnswers.deliver({ terminalHandle: 'term_nobody' })).resolves.toHaveLength(
      1
    )
    lead = { handle: 'term_fresh_lead', paneKey: 'tab:fresh' }
    changed.length = 0
    await expect(game.heldAnswers.deliver({ terminalHandle: 'term_fresh_lead' })).resolves.toEqual(
      []
    )

    expect(changed).toEqual(['repo:r1'])

    expect(told).toMatchObject([{ lead, note: { payload: { ownerQuestionId: question.id } } }])
  })

  it('never delivers to a member, which only reads its own ticket', async () => {
    let caller: GameBoardProject = { ...LEAD, lead: null }
    const { game, told } = board(() => caller)
    const { question } = await game.askOwner(ask)
    await game.answerOwner({ id: question.id, text: 'Yes' })

    caller = MEMBER
    await game.inbox({ terminalHandle: 'term_member' })

    expect(told).toEqual([])
  })

  it('lists the open questions of each project that has any, oldest first', async () => {
    let key = 'repo:r1'
    const { game } = board(() => ({ ...LEAD, key }))
    const first = (await game.askOwner(ask)).question
    const answered = (await game.askOwner({ ...ask, question: 'Answered?' })).question
    await game.answerOwner({ id: answered.id, text: 'Yes' })
    key = 'repo:r2'
    const other = (await game.askOwner({ ...ask, question: 'Other project?' })).question

    const byProject = await game.openOwnerQuestionsOf(['repo:r1', 'repo:r2', 'repo:r3'])

    expect([...byProject.entries()].map(([k, list]) => [k, list.map((q) => q.id)])).toEqual([
      ['repo:r1', [first.id]],
      ['repo:r2', [other.id]]
    ])
  })

  it('tells the host once when a question is asked and once when it is answered', async () => {
    const { game, events } = board(() => LEAD)
    const { question } = await game.askOwner(ask)
    await game.answerOwner({ id: question.id, text: 'Yes' })
    await game.answerOwner({ id: question.id, text: 'Yes' })

    expect(events).toEqual([`asked repo:r1 ${question.id}`, `answered repo:r1 ${question.id}`])
  })
})
