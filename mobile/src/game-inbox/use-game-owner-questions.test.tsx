import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import { useGameOwnerQuestions, type GameOwnerQuestionsInbox } from './use-game-owner-questions'

const question = {
  id: 'q1',
  ticket: null,
  question: 'Ship it?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
}
const project = { repoId: 'r1', repoName: 'orca', worktreeId: 'w1', questions: [question] }

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } } as RpcResponse
}
function failure(code: string, message: string): RpcResponse {
  return { id: 'x', ok: false, error: { code, message }, _meta: { runtimeId: 'rt' } } as RpcResponse
}

// Why a list: the root's type-aware lint cannot resolve this type, so a `| null` union reads as any.
const renderers: ReactTestRenderer[] = []
const mounted = (): ReactTestRenderer => renderers.at(-1)!
let inbox: GameOwnerQuestionsInbox | null = null

function Probe(props: { client: RpcClient | null; connected: boolean; active: boolean }) {
  inbox = useGameOwnerQuestions(props.client, props.connected, props.active)
  return null
}

async function render(sendRequest: RpcClient['sendRequest'], connected = true, active = true) {
  const client = { sendRequest } as unknown as RpcClient
  await act(async () => {
    renderers[renderers.length] = create(createElement(Probe, { client, connected, active }))
  })
  return client
}

afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount()
    }
  })
  inbox = null
})

describe('useGameOwnerQuestions', () => {
  it('waits for a connection before reading', async () => {
    const sendRequest = vi.fn(async () => ok({ projects: [project] }))
    await render(sendRequest, false)

    expect(sendRequest).not.toHaveBeenCalled()
    expect(inbox?.state).toEqual({ kind: 'loading' })
  })

  it('rereads each time the screen regains focus, and not while it is away', async () => {
    const sendRequest = vi.fn(async () => ok({ projects: [project] }))
    const client = await render(sendRequest, true, false)
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () =>
      mounted().update(createElement(Probe, { client, connected: true, active: true }))
    )
    await act(async () =>
      mounted().update(createElement(Probe, { client, connected: true, active: false }))
    )
    await act(async () =>
      mounted().update(createElement(Probe, { client, connected: true, active: true }))
    )

    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('reads the open questions once connected', async () => {
    await render(vi.fn(async () => ok({ projects: [project] })))

    expect(inbox?.state).toEqual({ kind: 'ready', projects: [project] })
  })

  it('shows an older host as unavailable, not as an empty list', async () => {
    await render(vi.fn(async () => failure('method_not_found', 'Unknown method')))

    expect(inbox?.state).toEqual({ kind: 'unavailable' })
  })

  it('shows a failed first read as an error a retry clears', async () => {
    const replies = [failure('internal_error', 'store unreadable'), ok({ projects: [project] })]
    await render(vi.fn(async () => replies.shift()!))

    expect(inbox?.state).toEqual({ kind: 'error', message: 'store unreadable' })
    await act(async () => inbox!.reload())
    expect(inbox?.state).toEqual({ kind: 'ready', projects: [project] })
  })

  it('keeps the list on a failed refresh and says the refresh failed', async () => {
    const replies = [ok({ projects: [project] }), failure('internal_error', 'timeout')]
    await render(vi.fn(async () => replies.shift()!))

    await act(async () => inbox!.reload())

    expect(inbox?.state).toEqual({ kind: 'ready', projects: [project] })
    expect(inbox?.refreshError).toBe('timeout')
  })

  it('rereads after an answer so the answered question leaves the list', async () => {
    const sendRequest = vi.fn(async (method: string) =>
      method === 'game.ownerAnswer'
        ? ok({ question, delivered: true, repeated: false })
        : ok({ projects: sendRequest.mock.calls.length > 1 ? [] : [project] })
    )
    await render(sendRequest)

    await act(async () => inbox!.answer('w1', 'q1', { option: 1 }))

    expect(sendRequest).toHaveBeenCalledWith('game.ownerAnswer', {
      worktreeId: 'w1',
      id: 'q1',
      option: 1
    })
    expect(inbox?.state).toEqual({ kind: 'ready', projects: [] })
  })

  it('throws a refused answer to the card and keeps the question', async () => {
    const sendRequest = vi.fn(async (method: string) =>
      method === 'game.ownerAnswer'
        ? failure('internal_error', 'Option 3 is not one of 2.')
        : ok({ projects: [project] })
    )
    await render(sendRequest)

    let thrown: unknown = null
    await act(async () => {
      thrown = await inbox!.answer('w1', 'q1', { option: 3 }).catch((error: unknown) => error)
    })

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('Option 3 is not one of 2.')
    expect(inbox?.state).toEqual({ kind: 'ready', projects: [project] })
  })
})
