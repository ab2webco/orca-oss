// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalGameInboxChanged } from './game-inbox-signal'
import { useGameInboxThreads } from './useGameInboxThreads'

const SCOPE = { target: { kind: 'local' } as const, worktreeId: 'repo::wt' }

const thread = (ticket: string) => ({
  ticket,
  messages: [],
  last: '2026-10-29T10:00:00Z',
  waiting: 0
})

function stubRuntime(respond: () => unknown) {
  let pushed: (() => void) | null = null
  const call = vi.fn(async () => ({
    id: 'r',
    ok: true,
    result: respond(),
    _meta: { runtimeId: 'rt' }
  }))
  const onGameInboxChanged = (callback: () => void) => {
    pushed = callback
    return () => {
      pushed = null
    }
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: { call, onGameInboxChanged } }
  })
  return { call, push: () => pushed?.() }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'api')
})

describe('useGameInboxThreads', () => {
  it('while closed, listens to pushed mail only until it learns the project has a team', async () => {
    let threads: ReturnType<typeof thread>[] = []
    const runtime = stubRuntime(() => ({ threads, waiting: [], answered: [] }))
    const { result } = renderHook(() => useGameInboxThreads(SCOPE, false))
    await waitFor(() => expect(runtime.call).toHaveBeenCalledTimes(1))

    threads = [thread('ORCA-1')]
    act(() => runtime.push())
    await waitFor(() => expect(result.current.threads).toHaveLength(1))

    act(() => runtime.push())
    act(() => signalGameInboxChanged())
    expect(runtime.call).toHaveBeenCalledTimes(2)
  })

  it('reads while open and rereads when the local runtime or a paired host says mail arrived', async () => {
    let threads = [thread('ORCA-1')]
    const runtime = stubRuntime(() => ({ threads, waiting: [], answered: [] }))
    const { result } = renderHook(() => useGameInboxThreads(SCOPE, true))
    await waitFor(() => expect(result.current.threads.map((one) => one.ticket)).toEqual(['ORCA-1']))

    threads = [thread('ORCA-2'), thread('ORCA-1')]
    act(() => runtime.push())
    await waitFor(() => expect(result.current.threads).toHaveLength(2))

    threads = []
    act(() => signalGameInboxChanged())
    await waitFor(() => expect(result.current.threads).toEqual([]))
  })

  it('shows an empty Inbox when the host cannot answer (an older build without threads)', async () => {
    const call = vi.fn(async () => ({
      id: 'r',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method' }
    }))
    Object.defineProperty(window, 'api', { configurable: true, value: { runtime: { call } } })
    const { result } = renderHook(() => useGameInboxThreads(SCOPE, true))

    await waitFor(() => expect(call).toHaveBeenCalled())
    expect(result.current).toMatchObject({ threads: [], waiting: [], answered: [] })
  })
})

describe('useGameInboxThreads reply (ORCA-878)', () => {
  it('replies for the person, then rereads; a refused reply is thrown for the row to show', async () => {
    let waiting = 1
    const call = vi.fn(async (args: { method: string; params?: { text?: string } }) => {
      if (args.method === 'game.ownerReplyToMember') {
        if (args.params?.text === 'late') {
          return {
            id: 'r',
            ok: false,
            error: { code: 'runtime_error', message: 'Its member is gone' }
          }
        }
        waiting = 0
        return {
          id: 'r',
          ok: true,
          result: { mode: 'answered', delivered: true },
          _meta: { runtimeId: 'rt' }
        }
      }
      return {
        id: 'r',
        ok: true,
        result: {
          threads: [thread('ORCA-1')],
          waiting: Array.from({ length: waiting }, () => ({
            id: 'q1',
            ticket: 'ORCA-1',
            kind: 'question',
            subject: 'Question',
            body: 'Which port?',
            at: '2026-10-29T10:00:00Z',
            answerer: 'lead'
          })),
          answered: []
        },
        _meta: { runtimeId: 'rt' }
      }
    })
    Object.defineProperty(window, 'api', { configurable: true, value: { runtime: { call } } })
    const { result } = renderHook(() => useGameInboxThreads(SCOPE, true))
    await waitFor(() => expect(result.current.waiting).toHaveLength(1))

    await act(() => result.current.reply({ id: 'q1', text: '8080', ticket: 'ORCA-1' }))
    expect(result.current.waiting).toEqual([])
    await expect(result.current.reply({ id: 'q1', text: 'late' })).rejects.toThrow(/member is gone/)
  })
})
