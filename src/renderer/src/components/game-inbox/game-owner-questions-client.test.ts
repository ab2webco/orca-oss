import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  answerGameOwnerQuestion,
  gameInboxTargetOf,
  readOpenGameOwnerQuestions
} from './game-owner-questions-client'

const QUESTION = {
  id: 'oq_1',
  ticket: 'ORCA-1',
  question: 'Ship it?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-10-29T10:00:00.000Z',
  answer: null
}

function stubRuntime(result: unknown) {
  const call = vi.fn(async (_args: { method: string; params?: unknown }) => ({
    id: 'r1',
    ok: true,
    result,
    _meta: { runtimeId: 'rt' }
  }))
  vi.stubGlobal('window', { api: { runtime: { call } } })
  return call
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gameInboxTargetOf', () => {
  it('reads a paired host its own board and every other workspace the local one', () => {
    expect(gameInboxTargetOf('runtime:env-1')).toEqual({
      kind: 'environment',
      environmentId: 'env-1'
    })
    expect(gameInboxTargetOf('ssh:box')).toEqual({ kind: 'local' })
    expect(gameInboxTargetOf('local')).toEqual({ kind: 'local' })
    expect(gameInboxTargetOf(null)).toEqual({ kind: 'local' })
  })
})

describe('readOpenGameOwnerQuestions', () => {
  it("asks the worktree's board and drops entries this build cannot read", async () => {
    const call = stubRuntime({ questions: [QUESTION, { id: 'oq_2' }], open: 2 })

    const questions = await readOpenGameOwnerQuestions({
      target: { kind: 'local' },
      worktreeId: 'repo::wt'
    })

    expect(questions).toEqual([QUESTION])
    expect(call).toHaveBeenCalledWith({
      method: 'game.ownerQuestions',
      params: { worktreeId: 'repo::wt' }
    })
  })
})

describe('answerGameOwnerQuestion', () => {
  it('sends an option by its number or free text', async () => {
    const call = stubRuntime({ question: QUESTION, delivered: true, repeated: false })
    const scope = { target: { kind: 'local' } as const, worktreeId: 'repo::wt' }

    await answerGameOwnerQuestion(scope, 'oq_1', { option: 2 })
    await answerGameOwnerQuestion(scope, 'oq_1', { text: 'Later' })

    expect(call.mock.calls.map(([args]) => args)).toEqual([
      { method: 'game.ownerAnswer', params: { worktreeId: 'repo::wt', id: 'oq_1', option: 2 } },
      { method: 'game.ownerAnswer', params: { worktreeId: 'repo::wt', id: 'oq_1', text: 'Later' } }
    ])
  })
})
