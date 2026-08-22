import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '../types'
import type { PlaneConnectionStatus, PlaneWorkItem } from '../../../../shared/plane-types'
import { createPlaneSlice } from './plane'
import {
  bumpPlaneCacheGeneration,
  canWritePlaneReadResult,
  currentPlaneCacheGeneration,
  currentPlaneMutationGeneration,
  evictStalePlaneCacheEntries,
  isFreshPlaneCacheEntry,
  resetPlaneGenerationsForTests
} from './plane-cache-guards'

const planeStatus = vi.fn()
const planeConnect = vi.fn()
const planeDisconnect = vi.fn()
const planeSelectWorkspace = vi.fn()
const planeTestConnection = vi.fn()
const planeGetWorkItem = vi.fn()
const planeSearchWorkItems = vi.fn()
const planeListWorkItems = vi.fn()
const planeListProjects = vi.fn()
const planeUpdateWorkItem = vi.fn()
const planeAddWorkItemComment = vi.fn()
const planeListWorkItemComments = vi.fn()
const planeListStates = vi.fn()
const planeListLabels = vi.fn()
const planeListMembers = vi.fn()

vi.mock('@/runtime/runtime-plane-client', () => ({
  planeStatus: (...args: unknown[]) => planeStatus(...args),
  planeConnect: (...args: unknown[]) => planeConnect(...args),
  planeDisconnect: (...args: unknown[]) => planeDisconnect(...args),
  planeSelectWorkspace: (...args: unknown[]) => planeSelectWorkspace(...args),
  planeTestConnection: (...args: unknown[]) => planeTestConnection(...args),
  planeGetWorkItem: (...args: unknown[]) => planeGetWorkItem(...args),
  planeSearchWorkItems: (...args: unknown[]) => planeSearchWorkItems(...args),
  planeListWorkItems: (...args: unknown[]) => planeListWorkItems(...args),
  planeListProjects: (...args: unknown[]) => planeListProjects(...args),
  planeUpdateWorkItem: (...args: unknown[]) => planeUpdateWorkItem(...args),
  planeAddWorkItemComment: (...args: unknown[]) => planeAddWorkItemComment(...args),
  planeListWorkItemComments: (...args: unknown[]) => planeListWorkItemComments(...args),
  planeListStates: (...args: unknown[]) => planeListStates(...args),
  planeListLabels: (...args: unknown[]) => planeListLabels(...args),
  planeListMembers: (...args: unknown[]) => planeListMembers(...args)
}))

function createTestStore() {
  return create<AppState>()(
    (...a) =>
      ({
        settings: null,
        ...createPlaneSlice(...a)
      }) as AppState
  )
}

function connectedStatus(workspaceId = 'ws-1'): PlaneConnectionStatus {
  return {
    connected: true,
    viewer: { id: 'v1', displayName: 'Viewer', email: null },
    activeWorkspaceId: workspaceId,
    selectedWorkspaceId: workspaceId
  }
}

function workItem(id: string): PlaneWorkItem {
  return {
    id,
    identifier: id,
    sequenceId: 1,
    title: id,
    url: `https://plane.example/${id}`,
    project: { id: 'p-1', identifier: 'P', name: 'Project' },
    state: { id: 's-1', name: 'Todo', group: 'unstarted' },
    labels: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('plane-cache-guards', () => {
  beforeEach(() => {
    resetPlaneGenerationsForTests()
  })

  it('accepts a write whose context and generations match the live values', () => {
    expect(
      canWritePlaneReadResult(
        'ctx-a',
        'ctx-a',
        currentPlaneCacheGeneration(),
        currentPlaneMutationGeneration()
      )
    ).toBe(true)
  })

  it('rejects a stale write when the context key drifted from the live context', () => {
    expect(
      canWritePlaneReadResult(
        'ctx-a',
        'ctx-b',
        currentPlaneCacheGeneration(),
        currentPlaneMutationGeneration()
      )
    ).toBe(false)
  })

  it('rejects a stale write once the cache generation moved on', () => {
    const staleCacheGeneration = currentPlaneCacheGeneration()
    bumpPlaneCacheGeneration()
    expect(
      canWritePlaneReadResult(
        'ctx-a',
        'ctx-a',
        staleCacheGeneration,
        currentPlaneMutationGeneration()
      )
    ).toBe(false)
  })

  it('rejects a stale write once the mutation generation moved on', () => {
    const staleMutationGeneration = currentPlaneMutationGeneration()
    const store = createTestStoreForMutation()
    void store.getState().disconnectPlane()
    expect(
      canWritePlaneReadResult(
        'ctx-a',
        'ctx-a',
        currentPlaneCacheGeneration(),
        staleMutationGeneration
      )
    ).toBe(false)
  })

  function createTestStoreForMutation() {
    planeDisconnect.mockResolvedValue(undefined)
    return createTestStore()
  }

  it('treats entries younger than the TTL as fresh and older ones as stale', () => {
    const now = Date.now()
    expect(isFreshPlaneCacheEntry({ data: 'x', fetchedAt: now }, 1_000)).toBe(true)
    expect(isFreshPlaneCacheEntry({ data: 'x', fetchedAt: now - 2_000 }, 1_000)).toBe(false)
    expect(isFreshPlaneCacheEntry(undefined)).toBe(false)
  })

  it('evicts the oldest entries once the cache exceeds the max size', () => {
    const cache: Record<string, { data: string; fetchedAt: number }> = {}
    for (let i = 0; i < 5; i += 1) {
      cache[`k${i}`] = { data: `v${i}`, fetchedAt: i }
    }
    const pruned = evictStalePlaneCacheEntries(cache, 3)
    expect(Object.keys(pruned).sort()).toEqual(['k2', 'k3', 'k4'])
  })
})

describe('createPlaneSlice caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPlaneGenerationsForTests()
  })

  it('serves a fresh work-item list from cache and lets a forced refresh bypass it', async () => {
    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-1')])
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })

    await store.getState().listPlaneWorkItems('assigned')
    expect(store.getState().getCachedPlaneWorkItems({ kind: 'list', filter: 'assigned' })).toEqual([
      workItem('PLN-1')
    ])
    expect(planeListWorkItems).toHaveBeenCalledTimes(1)

    await store.getState().listPlaneWorkItems('assigned')
    expect(planeListWorkItems).toHaveBeenCalledTimes(1)

    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-2')])
    await store.getState().listPlaneWorkItems('assigned', undefined, undefined, { force: true })
    expect(planeListWorkItems).toHaveBeenCalledTimes(2)
    expect(store.getState().getCachedPlaneWorkItems({ kind: 'list', filter: 'assigned' })).toEqual([
      workItem('PLN-2')
    ])
  })

  // The Plane pane seeds from this entry on every entry, so it must survive the
  // TTL: expiry means "refetch in the background", not "show nothing".
  it('keeps serving a TTL-expired list entry, with its fetchedAt, to the seed selector', async () => {
    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-1')])
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })

    await store.getState().listPlaneWorkItems('assigned')
    const entry = store.getState().getCachedPlaneWorkItemsEntry({ kind: 'list', filter: 'assigned' })
    expect(entry?.data).toEqual([workItem('PLN-1')])
    expect(typeof entry?.fetchedAt).toBe('number')

    // Age the entry well past PLANE_CACHE_TTL (120s).
    store.setState((s) => ({
      planeListCache: Object.fromEntries(
        Object.entries(s.planeListCache).map(([key, value]) => [
          key,
          { ...value, fetchedAt: value.fetchedAt - 600_000 }
        ])
      )
    }))

    const stale = store.getState().getCachedPlaneWorkItemsEntry({ kind: 'list', filter: 'assigned' })
    expect(stale?.data).toEqual([workItem('PLN-1')])

    // ...and the expiry still drives a real refetch rather than being ignored.
    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-2')])
    await store.getState().listPlaneWorkItems('assigned')
    expect(planeListWorkItems).toHaveBeenCalledTimes(2)
  })

  // Stale-while-revalidate's classic hole: a background GET that was already
  // in flight when the user dragged a card must not land the pre-drag
  // snapshot back over the optimistic patch once it resolves. Regression for
  // ORCA-275 (the SWR pane keeps a fetch running while the board stays
  // interactive, unlike the old blocking-skeleton load).
  it('does not let a revalidation started before a work-item patch clobber it on resolve', async () => {
    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-1')])
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })

    // Warm the cache the way the pane's mount-time seed does.
    await store.getState().listPlaneWorkItems('assigned')

    // A background revalidation starts while the pane still shows PLN-1 in
    // its cached (Todo) state.
    const gate = deferred<PlaneWorkItem[]>()
    planeListWorkItems.mockReturnValueOnce(gate.promise)
    const revalidation = store
      .getState()
      .listPlaneWorkItems('assigned', undefined, undefined, { force: true })

    // The user drags the card to Done before the revalidation settles — the
    // same optimistic call task-page-plane-board.tsx makes on drop.
    const doneState = { id: 's-2', name: 'Done', group: 'completed' }
    store.getState().patchPlaneWorkItem('PLN-1', { state: doneState })

    // The revalidation resolves with the snapshot it captured BEFORE the
    // drag — still Todo.
    gate.resolve([workItem('PLN-1')])
    const resolved = await revalidation

    // Neither the value handed back to the caller (what TaskPage renders)
    // nor the cache a later mount seeds from may show the pre-drag state.
    expect(resolved.find((item) => item.id === 'PLN-1')?.state.id).toBe('s-2')
    expect(
      store
        .getState()
        .getCachedPlaneWorkItems({ kind: 'list', filter: 'assigned' })
        ?.find((item) => item.id === 'PLN-1')?.state.id
    ).toBe('s-2')
  })

  it('dedupes concurrent list requests for the same key into one promise', async () => {
    const gate = deferred<PlaneWorkItem[]>()
    planeListWorkItems.mockReturnValueOnce(gate.promise)
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })

    const first = store.getState().listPlaneWorkItems('assigned')
    const second = store.getState().listPlaneWorkItems('assigned')
    expect(planeListWorkItems).toHaveBeenCalledTimes(1)

    gate.resolve([workItem('PLN-1')])
    await expect(first).resolves.toEqual([workItem('PLN-1')])
    await expect(second).resolves.toEqual([workItem('PLN-1')])
  })

  it('evicts entries once the cache exceeds the max size (500) for one cache map', async () => {
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })
    planeGetWorkItem.mockImplementation((_s, id: string) => Promise.resolve(workItem(id)))

    for (let i = 0; i < 501; i += 1) {
      await store.getState().fetchPlaneWorkItem(`PLN-${i}`)
    }

    expect(Object.keys(store.getState().planeWorkItemCache)).toHaveLength(500)
  })

  it('bumps planeListInvalidationToken and forces a refetch of the list cache', async () => {
    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-1')])
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })

    await store.getState().listPlaneWorkItems('assigned')
    const tokenBefore = store.getState().planeListInvalidationToken.version

    store.getState().invalidatePlaneWorkItemLists()
    expect(store.getState().planeListInvalidationToken.version).toBe(tokenBefore + 1)
    expect(
      store.getState().getCachedPlaneWorkItems({ kind: 'list', filter: 'assigned' })
    ).toBeNull()

    planeListWorkItems.mockResolvedValueOnce([workItem('PLN-2')])
    await store.getState().listPlaneWorkItems('assigned')
    expect(planeListWorkItems).toHaveBeenCalledTimes(2)
    expect(store.getState().getCachedPlaneWorkItems({ kind: 'list', filter: 'assigned' })).toEqual([
      workItem('PLN-2')
    ])
  })

  it('ignores a stale work-item write after the active runtime context changes', async () => {
    const staleRead = deferred<PlaneWorkItem>()
    const freshRead = deferred<PlaneWorkItem>()
    planeGetWorkItem.mockReturnValueOnce(staleRead.promise).mockReturnValueOnce(freshRead.promise)
    const store = createTestStore()
    store.setState({ planeStatus: connectedStatus() })

    const staleRequest = store.getState().fetchPlaneWorkItem('PLN-1')
    store.setState({ settings: { activeRuntimeEnvironmentId: 'runtime-1' } as never })
    const freshRequest = store.getState().fetchPlaneWorkItem('PLN-1')

    freshRead.resolve(workItem('PLN-1-fresh'))
    await freshRequest
    expect(store.getState().planeWorkItemCache['ws-1::item::PLN-1']?.data).toEqual(
      workItem('PLN-1-fresh')
    )

    staleRead.resolve(workItem('PLN-1-stale'))
    await staleRequest
    expect(store.getState().planeWorkItemCache['ws-1::item::PLN-1']?.data).toEqual(
      workItem('PLN-1-fresh')
    )
  })
})
