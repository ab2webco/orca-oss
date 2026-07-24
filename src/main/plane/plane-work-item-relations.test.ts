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

function client(workspaceSlug = 'acme'): PlaneClientForWorkspace {
  return {
    baseUrl: 'https://api.plane.so',
    workspaceSlug,
    headers: { 'x-api-key': `key-${workspaceSlug}`, 'x-workspace-slug': workspaceSlug }
  }
}

function pathOf(url: string): string {
  return new URL(url, 'http://placeholder').pathname
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  clearTokenMock.mockClear()
})

describe('addWorkItemRelation', () => {
  it('POSTs relation_type + issues[] to the relations sub-route', async () => {
    const { addWorkItemRelation } = await import('./plane-work-item-relations')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_c, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url)
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve(undefined)
    })

    const result = await addWorkItemRelation({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      relationType: 'blocking',
      relatedWorkItemId: 'wi-2',
      workspaceId: 'acme'
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/relations/')
    expect(capturedBody).toEqual({ relation_type: 'blocking', issues: ['wi-2'] })
    expect(result).toEqual({ ok: true })
  })
})

describe('listWorkItemRelations', () => {
  it('flattens the grouped response into typed relations', async () => {
    const { listWorkItemRelations } = await import('./plane-work-item-relations')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockResolvedValue({
      blocking: [{ id: 'wi-2', name: 'Blocked thing', sequence_id: 2 }],
      relates_to: [{ related_issue: 'wi-3', name: 'Related thing' }],
      blocked_by: []
    })

    const relations = await listWorkItemRelations({ projectId: 'proj-1', workItemId: 'wi-1' })

    // Iteration order follows the RELATION_TYPES list (relates_to before blocking).
    expect(relations).toEqual([
      {
        id: 'wi-3',
        relationType: 'relates_to',
        relatedWorkItemId: 'wi-3',
        name: 'Related thing',
        sequenceId: undefined
      },
      {
        id: 'wi-2',
        relationType: 'blocking',
        relatedWorkItemId: 'wi-2',
        name: 'Blocked thing',
        sequenceId: 2
      }
    ])
  })

  it('returns [] on failure', async () => {
    const { listWorkItemRelations } = await import('./plane-work-item-relations')
    getClientsMock.mockReturnValue([client()])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('boom', 500))

    const relations = await listWorkItemRelations({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(relations).toEqual([])
  })
})
