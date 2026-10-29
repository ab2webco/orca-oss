import { describe, expect, it } from 'vitest'
import {
  GAME_OWNER_QUESTIONS_MAX,
  addGameOwnerQuestion,
  answerGameOwnerQuestion,
  openGameOwnerQuestions,
  parseGameOwnerQuestion,
  type GameOwnerQuestion
} from './orchestrator-game-owner-questions'

const asked = (id: string, answered = false): GameOwnerQuestion => ({
  id,
  ticket: 'ORCA-1',
  question: `Question ${id}?`,
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-10-29T10:00:00.000Z',
  answer: answered ? { text: 'Yes', at: '2026-10-29T11:00:00.000Z' } : null
})

describe('parseGameOwnerQuestion', () => {
  it('reads a stored question and rejects a damaged one', () => {
    expect(parseGameOwnerQuestion(asked('oq_1', true))).toEqual(asked('oq_1', true))
    expect(parseGameOwnerQuestion({ id: 'oq_1', question: 'x' })).toBeNull()
    expect(parseGameOwnerQuestion({ ...asked('oq_1'), options: [1] })).toBeNull()
    expect(parseGameOwnerQuestion('oq_1')).toBeNull()
  })
})

describe('addGameOwnerQuestion', () => {
  it('appends and keeps entries a newer build wrote', () => {
    const unknown = { id: 'oq_new', shape: 'v2' }
    expect(addGameOwnerQuestion([unknown], asked('oq_1'))).toEqual([unknown, asked('oq_1')])
  })

  it('drops the oldest answered questions past the cap, never an open one', () => {
    const open = asked('oq_open')
    const answered = Array.from({ length: GAME_OWNER_QUESTIONS_MAX }, (_, i) =>
      asked(`oq_${i}`, true)
    )
    const next = addGameOwnerQuestion([open, ...answered], asked('oq_last'))

    expect(next).toHaveLength(GAME_OWNER_QUESTIONS_MAX)
    expect(next[0]).toEqual(open)
    expect(next.at(-1)).toEqual(asked('oq_last'))
    expect(next.some((one) => (one as GameOwnerQuestion).id === 'oq_0')).toBe(false)
  })
})

describe('answerGameOwnerQuestion', () => {
  const at = '2026-10-29T12:00:00.000Z'

  it('answers an open question by its option number or with free text', () => {
    const byOption = answerGameOwnerQuestion([asked('oq_1')], 'oq_1', { option: 2 }, at)
    expect(byOption).toMatchObject({ kind: 'answered', question: { answer: { text: 'No', at } } })
    expect((byOption.kind === 'answered' && byOption.list[0]) || null).toMatchObject({
      answer: { text: 'No' }
    })

    const byText = answerGameOwnerQuestion([asked('oq_1')], 'oq_1', { text: ' Wait ' }, at)
    expect(byText).toMatchObject({ kind: 'answered', question: { answer: { text: 'Wait' } } })
  })

  it('treats the same answer again as a repeat and a different one as a conflict', () => {
    const list = [asked('oq_1', true)]
    expect(answerGameOwnerQuestion(list, 'oq_1', { text: 'Yes' }, at)).toMatchObject({
      kind: 'repeated'
    })
    expect(answerGameOwnerQuestion(list, 'oq_1', { text: 'No' }, at)).toMatchObject({
      kind: 'conflict'
    })
  })

  it('names a missing question, an option out of range and an empty answer', () => {
    expect(answerGameOwnerQuestion([], 'oq_9', { text: 'Yes' }, at)).toEqual({
      kind: 'not_found'
    })
    expect(answerGameOwnerQuestion([asked('oq_1')], 'oq_1', { option: 3 }, at)).toMatchObject({
      kind: 'invalid'
    })
    expect(answerGameOwnerQuestion([asked('oq_1')], 'oq_1', { text: '  ' }, at)).toMatchObject({
      kind: 'invalid'
    })
  })
})

describe('openGameOwnerQuestions', () => {
  it('lists unanswered questions oldest first and skips unreadable entries', () => {
    const list = [asked('oq_1'), { id: 'oq_new', shape: 'v2' }, asked('oq_2', true), asked('oq_3')]
    expect(openGameOwnerQuestions(list).map((one) => one.id)).toEqual(['oq_1', 'oq_3'])
  })
})
