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

describe('deleteWorkItem', () => {
  it('DELETEs the project-scoped work item path', async () => {
    const { deleteWorkItem } = await import('./plane-work-item-delete')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    planeRequestMock.mockImplementation((_c, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url)
      capturedMethod = init?.method
      return Promise.resolve(undefined)
    })

    const result = await deleteWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workspaceId: 'acme'
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/')
    expect(result).toEqual({ ok: true })
  })

  it('clears the token and surfaces the error on an auth failure', async () => {
    const { deleteWorkItem } = await import('./plane-work-item-delete')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await deleteWorkItem({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearTokenMock).toHaveBeenCalledWith(acme, authError)
  })

  it('returns ok:false when no workspace is connected', async () => {
    const { deleteWorkItem } = await import('./plane-work-item-delete')
    getClientsMock.mockReturnValue([])

    const result = await deleteWorkItem({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})
