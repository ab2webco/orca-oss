// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
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
          providerSettings: { activeRuntimeEnvironmentId: null } as RuntimePlaneSettings
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
        providerSettings: { activeRuntimeEnvironmentId: null } as RuntimePlaneSettings
      })
    }

    await waitFor(() => expect(hook.result.current.itemLoading).toBe(false))
    expect(runtimeMocks.planeGetWorkItem).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListStates).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListMembers).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.planeListWorkItemComments).toHaveBeenCalledTimes(1)
  })
})
