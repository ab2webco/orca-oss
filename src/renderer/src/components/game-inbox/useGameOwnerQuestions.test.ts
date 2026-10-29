// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalGameOwnerQuestionsChanged } from './game-owner-questions-signal'
import { useGameOwnerQuestions } from './useGameOwnerQuestions'

const question = (id: string) => ({
  id,
  ticket: null,
  question: `Question ${id}?`,
  options: [],
  context: null,
  askedAt: '2026-10-29T10:00:00.000Z',
  answer: null
})

const SCOPE = { target: { kind: 'local' } as const, worktreeId: 'repo::wt' }

type RuntimeCall = { method: string; params?: unknown }

function stubRuntime(respond: (args: RuntimeCall) => unknown) {
  let pushed: (() => void) | null = null
  const call = vi.fn(async (args: RuntimeCall) => {
    const result = respond(args)
    return result instanceof Error
      ? { id: 'r', ok: false, error: { code: 'runtime_error', message: result.message } }
      : { id: 'r', ok: true, result, _meta: { runtimeId: 'rt' } }
  })
  const onGameOwnerQuestionsChanged = (callback: () => void) => {
    pushed = callback
    return () => {
      pushed = null
    }
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: { call, onGameOwnerQuestionsChanged } }
  })
  return { call, push: () => pushed?.() }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'api')
})

describe('useGameOwnerQuestions', () => {
  it('reads nothing without a worktree', () => {
    const { call } = stubRuntime(() => ({ questions: [] }))
    const { result } = renderHook(() => useGameOwnerQuestions(null))

    expect(result.current.questions).toEqual([])
    expect(call).not.toHaveBeenCalled()
  })

  it('rereads when the local runtime or a paired host says the questions changed', async () => {
    let open = [question('oq_1')]
    const runtime = stubRuntime(() => ({ questions: open }))
    const { result } = renderHook(() => useGameOwnerQuestions(SCOPE))
    await waitFor(() => expect(result.current.questions.map((one) => one.id)).toEqual(['oq_1']))

    open = [question('oq_1'), question('oq_2')]
    act(() => runtime.push())
    await waitFor(() => expect(result.current.questions).toHaveLength(2))

    open = []
    act(() => signalGameOwnerQuestionsChanged())
    await waitFor(() => expect(result.current.questions).toEqual([]))
  })

  it('answers, then rereads; a refused answer is thrown for the row to show', async () => {
    let open = [question('oq_1')]
    const { call } = stubRuntime((args) => {
      if (args.method === 'game.ownerAnswer') {
        const params = args.params as { text?: string }
        if (params.text === 'No') {
          return new Error('Question oq_1 is already answered: Yes')
        }
        open = []
        return { delivered: true, repeated: false }
      }
      return { questions: open }
    })
    const { result } = renderHook(() => useGameOwnerQuestions(SCOPE))
    await waitFor(() => expect(result.current.questions).toHaveLength(1))

    await act(() => result.current.answer('oq_1', { text: 'Yes' }))
    expect(result.current.questions).toEqual([])
    await expect(result.current.answer('oq_1', { text: 'No' })).rejects.toThrow(/already answered/)
    expect(call.mock.calls.filter(([args]) => args.method === 'game.ownerAnswer')).toHaveLength(2)
  })
})
