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

describe('createLabel', () => {
  it('POSTs name + color to the project labels path and maps the result', async () => {
    const { createLabel } = await import('./plane-label')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_c, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url)
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'label-1', name: 'Bug', color: '#ef4444' })
    })

    const result = await createLabel({
      projectId: 'proj-1',
      name: 'Bug',
      color: '#ef4444',
      workspaceId: 'acme'
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/labels/')
    expect(capturedBody).toEqual({ name: 'Bug', color: '#ef4444' })
    expect(result).toEqual({ ok: true, label: { id: 'label-1', name: 'Bug', color: '#ef4444' } })
  })

  it('omits color when not provided', async () => {
    const { createLabel } = await import('./plane-label')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_c, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'label-1', name: 'Bug' })
    })

    await createLabel({ projectId: 'proj-1', name: 'Bug' })

    expect(capturedBody).toEqual({ name: 'Bug' })
  })

  it('returns ok:false when no workspace is connected', async () => {
    const { createLabel } = await import('./plane-label')
    getClientsMock.mockReturnValue([])

    const result = await createLabel({ projectId: 'proj-1', name: 'Bug' })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})
