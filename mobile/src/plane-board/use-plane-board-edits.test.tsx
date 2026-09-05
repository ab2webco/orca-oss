import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { decodePlaneWorkItems } from '../tasks/plane-mobile-work-item-read'
import { usePlaneBoardEdits, type PlaneBoardEdits } from './use-plane-board-edits'

const ADA = { id: 'u-1', displayName: 'Ada' }

const items = decodePlaneWorkItems([
  {
    id: 'wi-1',
    identifier: 'ORCA-1',
    title: 'One',
    url: 'https://plane.example/wi-1',
    project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
    priority: 'none',
    assignees: [],
    updatedAt: '2026-09-04T00:00:00.000Z'
  },
  {
    id: 'wi-2',
    identifier: 'ORCA-2',
    title: 'Two',
    url: 'https://plane.example/wi-2',
    project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
    priority: 'none',
    assignees: [],
    updatedAt: '2026-09-04T00:00:00.000Z'
  }
])
const [CARD, OTHER_CARD] = items as [(typeof items)[number], (typeof items)[number]]

type Deferred = { resolve: (result: unknown) => void; reject: (error: Error) => void }

/** Mounts the hook over a host whose replies the test releases one by one. */
function mountEdits() {
  const pending: Deferred[] = []
  let latest: PlaneBoardEdits | null = null
  const client = {
    sendRequest: () =>
      new Promise((resolve, reject) => {
        pending.push({
          resolve: (result) => resolve({ id: '1', ok: true, result }),
          reject
        })
      })
  } as unknown as RpcClient

  function Probe() {
    latest = usePlaneBoardEdits({ client, workspaceId: 'ws-1', items, reload: () => {} })
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
  return {
    pending,
    get edits(): PlaneBoardEdits {
      if (!latest) {
        throw new Error('probe never rendered')
      }
      return latest
    },
    async settle(): Promise<void> {
      for (let hop = 0; hop < 6; hop += 1) {
        await act(async () => {
          await Promise.resolve()
        })
      }
    }
  }
}

describe('usePlaneBoardEdits with two writes in flight on one card', () => {
  it('rolls back only the field the host refused, not the one it already took', async () => {
    const mounted = mountEdits()

    act(() => void mounted.edits.setPriority(CARD, 'high'))
    act(() => void mounted.edits.setAssignees(CARD, [ADA]))
    expect(mounted.pending).toHaveLength(2)

    mounted.pending[1]?.resolve({ ok: true })
    await mounted.settle()
    mounted.pending[0]?.reject(new Error('Priority is locked'))
    await mounted.settle()

    expect(mounted.edits.overrides['wi-1']).toEqual({ assignees: [ADA] })
    expect(mounted.edits.editErrorWorkItemId).toBe('wi-1')
  })

  it('rolls a refused second value back to the first one still on the card', async () => {
    const mounted = mountEdits()

    act(() => void mounted.edits.setPriority(CARD, 'high'))
    act(() => void mounted.edits.setPriority(CARD, 'urgent'))

    mounted.pending[1]?.reject(new Error('Priority is locked'))
    await mounted.settle()

    expect(mounted.edits.overrides['wi-1']).toEqual({ priority: 'high' })
  })

  it('keeps a write that a later one on the same field overrode out of the rollback', async () => {
    const mounted = mountEdits()

    act(() => void mounted.edits.setPriority(CARD, 'high'))
    act(() => void mounted.edits.setPriority(CARD, 'urgent'))

    mounted.pending[1]?.resolve({ ok: true })
    await mounted.settle()
    mounted.pending[0]?.reject(new Error('Priority is locked'))
    await mounted.settle()

    expect(mounted.edits.overrides['wi-1']).toEqual({ priority: 'urgent' })
  })

  it('tracks in-flight edits per card, so a reply for one card does not free another', async () => {
    const mounted = mountEdits()

    act(() => void mounted.edits.setPriority(CARD, 'high'))
    act(() => void mounted.edits.setPriority(OTHER_CARD, 'low'))
    expect([...mounted.edits.editingWorkItemIds]).toEqual(['wi-1', 'wi-2'])

    mounted.pending[0]?.resolve({ ok: true })
    await mounted.settle()

    expect([...mounted.edits.editingWorkItemIds]).toEqual(['wi-2'])
  })
})
