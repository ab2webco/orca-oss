import { describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import {
  answerHostOwnerQuestion,
  openOwnerQuestionCount,
  ownerQuestionContextLink,
  readHostOwnerQuestions
} from './game-owner-questions-rpc'

const question = {
  id: 'q1',
  ticket: 'ORCA-1',
  question: 'Ship it?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
}

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } } as RpcResponse
}

function failure(code: string, message: string): RpcResponse {
  return { id: 'x', ok: false, error: { code, message }, _meta: { runtimeId: 'rt' } } as RpcResponse
}

function clientReplying(response: RpcResponse) {
  const sendRequest = vi.fn(async () => response)
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

describe('readHostOwnerQuestions', () => {
  it('reads every project and drops the ones without a readable question', async () => {
    const { client, sendRequest } = clientReplying(
      ok({
        projects: [
          { repoId: 'r1', repoName: 'orca', worktreeId: 'w1', questions: [question] },
          { repoId: 'r2', repoName: 'empty', worktreeId: null, questions: [{ id: 3 }] }
        ]
      })
    )

    await expect(readHostOwnerQuestions(client)).resolves.toEqual({
      status: 'ok',
      projects: [{ repoId: 'r1', repoName: 'orca', worktreeId: 'w1', questions: [question] }]
    })
    expect(sendRequest).toHaveBeenCalledWith('game.ownerQuestionsAll', {})
  })

  // Why both codes: a host without the method answers method_not_found, and one whose
  // mobile allowlist predates it refuses with forbidden before dispatch.
  it.each(['method_not_found', 'forbidden'])(
    'reports a host that answers %s as unavailable',
    async (code) => {
      const { client } = clientReplying(failure(code, 'nope'))

      await expect(readHostOwnerQuestions(client)).resolves.toEqual({ status: 'unavailable' })
    }
  )

  it('throws any other failure so the screen can offer a retry', async () => {
    const { client } = clientReplying(failure('internal_error', 'store unreadable'))

    await expect(readHostOwnerQuestions(client)).rejects.toThrow('store unreadable')
  })
})

describe('answerHostOwnerQuestion', () => {
  it('sends a picked option by its 1-based number', async () => {
    const { client, sendRequest } = clientReplying(
      ok({ question, delivered: true, repeated: false })
    )

    await answerHostOwnerQuestion(client, { worktreeId: 'w1', id: 'q1', reply: { option: 2 } })

    expect(sendRequest).toHaveBeenCalledWith('game.ownerAnswer', {
      worktreeId: 'w1',
      id: 'q1',
      option: 2
    })
  })

  it('sends typed text trimmed', async () => {
    const { client, sendRequest } = clientReplying(
      ok({ question, delivered: true, repeated: false })
    )

    await answerHostOwnerQuestion(client, {
      worktreeId: 'w1',
      id: 'q1',
      reply: { text: '  later  ' }
    })

    expect(sendRequest).toHaveBeenCalledWith('game.ownerAnswer', {
      worktreeId: 'w1',
      id: 'q1',
      text: 'later'
    })
  })

  it('refuses empty text without calling the host', async () => {
    const { client, sendRequest } = clientReplying(ok({}))

    await expect(
      answerHostOwnerQuestion(client, { worktreeId: 'w1', id: 'q1', reply: { text: '   ' } })
    ).rejects.toThrow('The answer is empty.')
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('throws the host refusal', async () => {
    const { client } = clientReplying(
      failure('internal_error', 'Question q1 is already answered: Yes')
    )

    await expect(
      answerHostOwnerQuestion(client, { worktreeId: 'w1', id: 'q1', reply: { option: 1 } })
    ).rejects.toThrow('Question q1 is already answered: Yes')
  })
})

describe('openOwnerQuestionCount', () => {
  it('counts questions across projects', () => {
    expect(
      openOwnerQuestionCount([
        {
          repoId: 'r1',
          repoName: 'a',
          worktreeId: 'w1',
          questions: [question, { ...question, id: 'q2' }]
        },
        { repoId: 'r2', repoName: 'b', worktreeId: null, questions: [question] }
      ])
    ).toBe(3)
  })
})

describe('ownerQuestionContextLink', () => {
  it.each([
    ['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/1'],
    [' http://example.com/a ', 'http://example.com/a'],
    ['see https://example.com', null],
    ['javascript:alert(1)', null],
    ['file:///etc/passwd', null],
    [null, null]
  ])('reads %s as %s', (context, link) => {
    expect(ownerQuestionContextLink(context)).toBe(link)
  })
})
