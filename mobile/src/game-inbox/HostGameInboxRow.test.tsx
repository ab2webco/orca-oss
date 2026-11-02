import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { HostGameInboxRow } from './HostGameInboxRow'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text' }))
vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight', Inbox: 'Inbox' }))
// Why: the row reads on focus; the test host has no navigator, so focus is the mount.
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react')
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) }
})

const question = {
  id: 'q1',
  ticket: null,
  question: 'Ship it?',
  options: [],
  context: null,
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
}

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } } as RpcResponse
}
function failure(code: string): RpcResponse {
  return {
    id: 'x',
    ok: false,
    error: { code, message: code },
    _meta: { runtimeId: 'rt' }
  } as RpcResponse
}

// Why a list: the root's type-aware lint cannot resolve this type, so a `| null` union reads as any.
const renderers: ReactTestRenderer[] = []
const mounted = (): ReactTestRenderer => renderers.at(-1)!

afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount()
    }
  })
})

async function render(reply: RpcResponse, connState: ConnectionState = 'connected') {
  const sendRequest = vi.fn(async () => reply)
  const open = vi.fn()
  const client = { sendRequest } as unknown as RpcClient
  await act(async () => {
    renderers[renderers.length] = create(
      createElement(HostGameInboxRow, { hostId: 'host-1', client, connState, open })
    )
  })
  return { sendRequest, open }
}

const texts = (): string[] =>
  mounted()
    .root.findAllByType('Text' as never)
    .map((node) => [node.props.children].flat().join(''))
const entry = () => mounted().root.findByType('Pressable' as never)

describe('HostGameInboxRow', () => {
  it('shows how many questions wait across the host projects', async () => {
    await render(
      ok({
        projects: [
          {
            repoId: 'r1',
            repoName: 'a',
            worktreeId: 'w1',
            questions: [question, { ...question, id: 'q2' }]
          },
          { repoId: 'r2', repoName: 'b', worktreeId: null, questions: [question] }
        ]
      })
    )

    expect(texts()).toEqual(['Inbox', '3'])
    expect(entry().props.accessibilityLabel).toBe('Inbox, 3 questions waiting')
  })

  it('shows no count when nothing waits', async () => {
    await render(ok({ projects: [] }))

    expect(texts()).toEqual(['Inbox'])
  })

  it('hides the count on an older host and leaves the explanation to the Inbox', async () => {
    await render(failure('method_not_found'))

    expect(texts()).toEqual(['Inbox'])
  })

  it('opens the host Inbox', async () => {
    const { open } = await render(ok({ projects: [] }))

    act(() => entry().props.onPress())

    expect(open).toHaveBeenCalledWith('/h/host-1/inbox')
  })

  it('does not read and stays disabled while the host is not connected', async () => {
    const { sendRequest } = await render(ok({ projects: [] }), 'connecting')

    expect(sendRequest).not.toHaveBeenCalled()
    expect(entry().props.disabled).toBe(true)
  })
})
