import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const { acquireMock, releaseMock, getClientsMock, planeRequestMock, clearTokenMock } = vi.hoisted(
  () => ({
    acquireMock: vi.fn(async () => undefined),
    releaseMock: vi.fn(),
    getClientsMock: vi.fn(),
    planeRequestMock: vi.fn(),
    clearTokenMock: vi.fn()
  })
)

class MockPlaneApiError extends Error {
  status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

vi.mock('./client', () => ({
  acquire: acquireMock,
  release: releaseMock,
  getClients: getClientsMock,
  planeRequest: planeRequestMock,
  PlaneApiError: MockPlaneApiError,
  clearWorkspaceTokenOnAuthError: clearTokenMock
}))

function client(): PlaneClientForWorkspace {
  return {
    baseUrl: 'https://api.plane.so',
    workspaceSlug: 'acme',
    headers: { 'x-api-key': 'key', 'x-workspace-slug': 'acme' }
  }
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReturnValue([client()])
  planeRequestMock.mockReset()
  clearTokenMock.mockClear()
})

describe('Plane planning client', () => {
  it.each([
    ['cycle', 'cycles'],
    ['module', 'modules']
  ] as const)('lists %ss from the project route', async (kind, route) => {
    const { listPlanningContainers } = await import('./plane-planning')
    planeRequestMock.mockResolvedValue({
      results: [{ id: `${kind}-1`, name: 'Roadmap', start_date: '2026-07-01' }],
      next_cursor: '',
      next_page_results: false
    })

    const result = await listPlanningContainers({ kind, projectId: 'project-1' })

    expect(planeRequestMock).toHaveBeenCalledWith(
      client(),
      `/api/v1/workspaces/acme/projects/project-1/${route}/?per_page=100`
    )
    expect(result).toEqual([{ id: `${kind}-1`, name: 'Roadmap', startDate: '2026-07-01' }])
  })

  it('lists cycle assignments and preserves the work item id', async () => {
    const { listPlanningWorkItems } = await import('./plane-planning')
    planeRequestMock.mockResolvedValue({
      results: [{ id: 'assignment-1', issue: 'item-1', created_at: '2026-07-25' }],
      next_cursor: '',
      next_page_results: false
    })

    const result = await listPlanningWorkItems({
      kind: 'cycle',
      projectId: 'project-1',
      containerId: 'cycle-1'
    })

    expect(planeRequestMock).toHaveBeenCalledWith(
      client(),
      '/api/v1/workspaces/acme/projects/project-1/cycles/cycle-1/cycle-issues/?per_page=100'
    )
    expect(result).toEqual([
      {
        id: 'assignment-1',
        workItemId: 'item-1',
        createdAt: '2026-07-25'
      }
    ])
  })

  it('POSTs repeated work item ids to a module', async () => {
    const { addPlanningWorkItems } = await import('./plane-planning')
    planeRequestMock.mockResolvedValue({})

    const result = await addPlanningWorkItems({
      kind: 'module',
      projectId: 'project-1',
      containerId: 'module-1',
      workItemIds: ['item-1', 'item-2']
    })

    expect(planeRequestMock).toHaveBeenCalledWith(
      client(),
      '/api/v1/workspaces/acme/projects/project-1/modules/module-1/module-issues/',
      { method: 'POST', body: JSON.stringify({ issues: ['item-1', 'item-2'] }) }
    )
    expect(result).toEqual({ ok: true })
  })

  it('propagates list API errors instead of returning an empty success', async () => {
    const { listPlanningContainers } = await import('./plane-planning')
    const error = new MockPlaneApiError('Forbidden', 403)
    planeRequestMock.mockRejectedValue(error)

    await expect(listPlanningContainers({ kind: 'module', projectId: 'project-1' })).rejects.toBe(
      error
    )
    expect(clearTokenMock).toHaveBeenCalledWith(client(), error)
  })

  it('returns a failed mutation when the add-items API request fails', async () => {
    const { addPlanningWorkItems } = await import('./plane-planning')
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('Bad request', 400))

    await expect(
      addPlanningWorkItems({
        kind: 'cycle',
        projectId: 'project-1',
        containerId: 'cycle-1',
        workItemIds: ['item-1']
      })
    ).resolves.toEqual({ ok: false, error: 'Bad request' })
  })
})
