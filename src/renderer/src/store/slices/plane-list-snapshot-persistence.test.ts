// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create, type StoreApi } from 'zustand'
import type { AppState } from '../types'
import type { PlaneConnectionStatus, PlaneWorkItem } from '../../../../shared/plane-types'
import { resolvePlanePaneSeedState } from '@/components/task-page-plane-snapshot-freshness'

const planeListWorkItems = vi.fn()
const planeStatus = vi.fn()
const planeDisconnect = vi.fn()

vi.mock('@/runtime/runtime-plane-client', () => ({
  planeStatus: (...args: unknown[]) => planeStatus(...args),
  planeConnect: vi.fn(),
  planeDisconnect: (...args: unknown[]) => planeDisconnect(...args),
  planeSelectWorkspace: vi.fn(),
  planeTestConnection: vi.fn(),
  planeGetWorkItem: vi.fn(),
  planeSearchWorkItems: vi.fn(),
  planeListWorkItems: (...args: unknown[]) => planeListWorkItems(...args),
  planeListProjects: vi.fn(),
  planeUpdateWorkItem: vi.fn(),
  planeAddWorkItemComment: vi.fn(),
  planeListWorkItemComments: vi.fn(),
  planeListStates: vi.fn(),
  planeListLabels: vi.fn(),
  planeListMembers: vi.fn()
}))

const STORAGE_KEY = 'orca.plane.work-item-list.v1'
const ALL_PROJECTS_CACHE_KEY = 'ws-1::workItems::all::'

const connectedStatus: PlaneConnectionStatus = {
  connected: true,
  viewer: { id: 'v1', displayName: 'Viewer', email: null },
  activeWorkspaceId: 'ws-1',
  selectedWorkspaceId: 'ws-1'
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

/**
 * A renderer launch: module state (in-flight maps, cache generations, the store)
 * is rebuilt from scratch while localStorage survives — the exact shape this
 * feature has to work across, and the one `createTestStore()` alone does not give.
 */
async function launchRenderer(): Promise<StoreApi<AppState>> {
  vi.resetModules()
  const { createPlaneSlice } = await import('./plane')
  const store = create<AppState>()(
    (...a) =>
      ({
        settings: null,
        ...createPlaneSlice(...a)
      }) as AppState
  )
  store.setState({ planeStatus: connectedStatus })
  return store
}

async function seedPersistedList(items: PlaneWorkItem[]): Promise<void> {
  const store = await launchRenderer()
  planeListWorkItems.mockResolvedValue(items)
  await store.getState().listPlaneWorkItems('all', undefined, 'ws-1')
}

describe('Plane list snapshot persists across a renderer launch (ORCA-492)', () => {
  beforeEach(() => {
    localStorage.clear()
    planeListWorkItems.mockReset()
    planeStatus.mockReset()
    planeDisconnect.mockReset()
  })

  it('paints the previous list before the fan-out answers, instead of a blocking skeleton', async () => {
    await seedPersistedList([workItem('ORCA-1'), workItem('ORCA-2')])

    const store = await launchRenderer()
    // The 21-project fan-out that times out at 30 s: never settles here.
    planeListWorkItems.mockReturnValue(new Promise<PlaneWorkItem[]>(() => {}))
    void store.getState().listPlaneWorkItems('all', undefined, 'ws-1')

    const seed = resolvePlanePaneSeedState(
      store.getState().getCachedPlaneWorkItemsEntry({ kind: 'list', filter: 'all' })
    )
    expect(seed.blocking).toBe(false)
    expect(seed.seededItems?.map((item) => item.identifier)).toEqual(['ORCA-1', 'ORCA-2'])
    expect(seed.seededFetchedAt).toBeTypeOf('number')
  })

  it('survives the boot connection check, which resets every in-memory Plane cache', async () => {
    await seedPersistedList([workItem('ORCA-1')])

    const store = await launchRenderer()
    store.setState({ planeStatus: { connected: false, viewer: null } })
    planeStatus.mockResolvedValue(connectedStatus)
    await store.getState().checkPlaneConnection()

    const entry = store.getState().getCachedPlaneWorkItemsEntry({ kind: 'list', filter: 'all' })
    expect(entry?.data?.map((item) => item.identifier)).toEqual(['ORCA-1'])
  })

  it('keeps the persisted list on screen when the relaunched fan-out times out', async () => {
    await seedPersistedList([workItem('ORCA-1')])

    const store = await launchRenderer()
    planeListWorkItems.mockRejectedValue(
      new Error('The Orca Lab runtime closed the connection before responding')
    )
    await expect(store.getState().listPlaneWorkItems('all', undefined, 'ws-1')).resolves.toEqual([
      workItem('ORCA-1')
    ])
  })

  it('does not serve a snapshot taken under a different runtime scope', async () => {
    await seedPersistedList([workItem('ORCA-1')])

    const store = await launchRenderer()
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-9' } as AppState['settings']
    })
    expect(
      store.getState().getCachedPlaneWorkItemsEntry({ kind: 'list', filter: 'all' })
    ).toBeNull()
  })

  it('ignores a stored payload whose items are not work items', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scopeKey: 'local',
        entries: {
          [ALL_PROJECTS_CACHE_KEY]: { fetchedAt: Date.now(), items: [{ id: 'x' }] }
        }
      })
    )
    const store = await launchRenderer()
    expect(
      store.getState().getCachedPlaneWorkItemsEntry({ kind: 'list', filter: 'all' })
    ).toBeNull()
  })

  it('drops the snapshot on disconnect', async () => {
    await seedPersistedList([workItem('ORCA-1')])
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    const store = await launchRenderer()
    planeDisconnect.mockResolvedValue(undefined)
    await store.getState().disconnectPlane()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
