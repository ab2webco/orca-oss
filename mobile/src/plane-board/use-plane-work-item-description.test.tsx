import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import {
  MOBILE_PLANE_WORK_ITEM_DESCRIPTION_CAPABILITY,
  MOBILE_TASKS_PLANE_CAPABILITY
} from '../tasks/plane-mobile-task-source'
import {
  usePlaneWorkItemDescription,
  type PlaneWorkItemDescription
} from './use-plane-work-item-description'

/**
 * The hook that decides where the open card's body comes from. Both wrong
 * answers are silent: a blank body on a lean list looks like a card with no
 * description, and a failed read looks the same again (ORCA-464).
 */
const NEW_HOST = [MOBILE_TASKS_PLANE_CAPABILITY, MOBILE_PLANE_WORK_ITEM_DESCRIPTION_CAPABILITY]
const OLD_HOST = [MOBILE_TASKS_PLANE_CAPABILITY]

function card(description?: string): PlaneMobileWorkItem {
  return {
    id: 'wi-1',
    identifier: 'ALPHA-1',
    sequenceId: 1,
    title: 'Wire the retry',
    url: 'https://plane.test/ALPHA-1',
    project: { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha' },
    state: { id: 's-1', name: 'Todo', group: 'unstarted' },
    labels: [],
    updatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...(description === undefined ? {} : { description })
  } as PlaneMobileWorkItem
}

function clientReturning(result: unknown, calls: string[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string) => {
      calls.push(method)
      return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
}

function mount(
  client: RpcClient | null,
  capabilities: readonly string[],
  item: PlaneMobileWorkItem | null
) {
  const seen: PlaneWorkItemDescription[] = []
  function Probe() {
    seen.push(usePlaneWorkItemDescription(client, capabilities, 'ws-1', item))
    return null
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Probe))
  })
  return { seen, renderer, last: () => seen[seen.length - 1] }
}

describe('where the open card body comes from', () => {
  it('uses the row it already has on a host that still sends descriptions', async () => {
    const calls: string[] = []
    const { last } = mount(
      clientReturning(card('from the list'), calls),
      OLD_HOST,
      card('from the list')
    )

    await act(async () => undefined)

    expect(last()).toEqual({ state: 'ready', text: 'from the list' })
    // Not one round trip: this host answered the list in full, so there is
    // nothing left to read and every card open would pay for nothing.
    expect(calls).toEqual([])
  })

  it('reads it on open where the list omitted it', async () => {
    const calls: string[] = []
    const { seen, last } = mount(clientReturning(card('the real body'), calls), NEW_HOST, card())

    await act(async () => undefined)

    expect(seen[0]).toEqual({ state: 'loading' })
    expect(last()).toEqual({ state: 'ready', text: 'the real body' })
    expect(calls).toEqual(['plane.getWorkItem'])
  })

  it('says the read failed instead of showing an empty body', async () => {
    const failing = {
      sendRequest: vi.fn(async () => ({
        id: '1',
        ok: false as const,
        error: { code: 'internal', message: 'Plane is unreachable' },
        _meta: { runtimeId: 'r' }
      }))
    } as unknown as RpcClient
    const { last } = mount(failing, NEW_HOST, card())

    await act(async () => undefined)

    expect(last()).toEqual({ state: 'failed', error: 'Plane is unreachable' })
  })

  it('does not read anything while no card is open', async () => {
    const calls: string[] = []
    const { last } = mount(clientReturning(card('x'), calls), NEW_HOST, null)

    await act(async () => undefined)

    expect(calls).toEqual([])
    expect(last()).toEqual({ state: 'ready', text: '' })
  })
})
