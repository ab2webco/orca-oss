// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import type { RuntimePlaneSettings } from '@/runtime/runtime-plane-client'

const runtimeMocks = vi.hoisted(() => ({
  planeGetWorkItem: vi.fn(),
  planeListStates: vi.fn(),
  planeListMembers: vi.fn(),
  planeListWorkItemComments: vi.fn()
}))

vi.mock('@/runtime/runtime-plane-client', () => runtimeMocks)

import { usePlaneWorkItemDetailData } from './use-plane-work-item-detail-data'

function planeWorkItem(overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: 'item-1',
    identifier: 'PROJ-7',
    sequenceId: 7,
    workspaceSlug: 'acme',
    workspaceId: 'ws-1',
    title: 'Fix the thing',
    description: 'Some description',
    url: 'https://app.plane.so/acme/browse/PROJ-7/',
    project: { id: 'proj-1', identifier: 'PROJ', name: 'Project' },
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    priority: 'medium',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('usePlaneWorkItemDetailData: load effect stability', () => {
  it('does not re-run the load effect when providerSettings gets a new identity each render (regression: infinite update-depth loop)', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])

    const item = planeWorkItem()
    const hook = renderHook(
      ({ providerSettings }: { providerSettings: RuntimePlaneSettings }) =>
        usePlaneWorkItemDetailData(item, providerSettings),
      {
        initialProps: {
          providerSettings: {
            activeRuntimeEnvironmentId: null
          } as RuntimePlaneSettings
        }
      }
    )

    await waitFor(() => expect(hook.result.current.itemLoading).toBe(false))
    expect(runtimeMocks.planeGetWorkItem).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListWorkItemComments).toHaveBeenCalledTimes(1)

    // Re-render several times with a brand-new providerSettings object identity
    // each time -- mirrors the real caller, which recomputed providerSettings
    // fresh on every render. Before the fix, the load effect depended on the
    // providerSettings value directly and re-ran on every one of these.
    for (let i = 0; i < 5; i += 1) {
      hook.rerender({
        providerSettings: {
          activeRuntimeEnvironmentId: null
        } as RuntimePlaneSettings
      })
    }

    await waitFor(() => expect(hook.result.current.itemLoading).toBe(false))
    expect(runtimeMocks.planeGetWorkItem).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListStates).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListMembers).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListWorkItemComments).toHaveBeenCalledTimes(1)
  })
})

describe('usePlaneWorkItemDetailData: drafts', () => {
  const settings = { activeRuntimeEnvironmentId: null } as RuntimePlaneSettings

  function renderDetail(item: PlaneWorkItem | null) {
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])
    return renderHook(
      ({ current }: { current: PlaneWorkItem | null }) =>
        usePlaneWorkItemDetailData(current, settings),
      { initialProps: { current: item } }
    )
  }

  it('follows the fetched full item, including the description the list item truncates', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(
      planeWorkItem({
        title: 'Full title',
        description: 'Full description',
        labels: ['bug']
      })
    )

    const hook = renderDetail(planeWorkItem({ description: 'Truncated' }))

    await waitFor(() => expect(hook.result.current.titleDraft).toBe('Full title'))
    expect(hook.result.current.descriptionDraft).toBe('Full description')
    expect(hook.result.current.labelsDraft).toBe('bug')
  })

  it('keeps an edit made while the fetch is in flight instead of overwriting it', async () => {
    let resolveItem: (item: PlaneWorkItem) => void = () => {}
    runtimeMocks.planeGetWorkItem.mockReturnValue(
      new Promise<PlaneWorkItem>((resolve) => {
        resolveItem = resolve
      })
    )

    const hook = renderDetail(planeWorkItem())
    act(() => hook.result.current.setTitleDraft('Typed while loading'))
    act(() => resolveItem(planeWorkItem({ title: 'Full title' })))

    await waitFor(() => expect(hook.result.current.itemLoading).toBe(false))
    expect(hook.result.current.titleDraft).toBe('Typed while loading')
  })

  it('drops an edit when the work item changes', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)

    const hook = renderDetail(planeWorkItem())
    act(() => hook.result.current.setTitleDraft('Edited'))
    expect(hook.result.current.titleDraft).toBe('Edited')

    hook.rerender({
      current: planeWorkItem({ id: 'item-2', title: 'Another item' })
    })

    await waitFor(() => expect(hook.result.current.titleDraft).toBe('Another item'))
  })
})
