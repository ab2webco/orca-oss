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

describe('addWorkItemLink', () => {
  it('POSTs url + title and maps the created link', async () => {
    const { addWorkItemLink } = await import('./plane-work-item-links')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_c, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url)
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'link-1', url: 'https://x.dev', title: 'Docs' })
    })

    const result = await addWorkItemLink({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      url: 'https://x.dev',
      title: 'Docs',
      workspaceId: 'acme'
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/links/')
    expect(capturedBody).toEqual({ url: 'https://x.dev', title: 'Docs' })
    expect(result).toEqual({
      ok: true,
      link: { id: 'link-1', url: 'https://x.dev', title: 'Docs' }
    })
  })

  it('omits title when not provided', async () => {
    const { addWorkItemLink } = await import('./plane-work-item-links')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_c, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'link-1', url: 'https://x.dev' })
    })

    await addWorkItemLink({ projectId: 'proj-1', workItemId: 'wi-1', url: 'https://x.dev' })

    expect(capturedBody).toEqual({ url: 'https://x.dev' })
  })
})

describe('deleteWorkItemLink', () => {
  it('DELETEs the link path', async () => {
    const { deleteWorkItemLink } = await import('./plane-work-item-links')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    planeRequestMock.mockImplementation((_c, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url)
      capturedMethod = init?.method
      return Promise.resolve(undefined)
    })

    const result = await deleteWorkItemLink({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      linkId: 'link-1'
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedPath).toBe(
      '/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/links/link-1/'
    )
    expect(result).toEqual({ ok: true })
  })
})

describe('listWorkItemLinks', () => {
  it('maps a bare array response', async () => {
    const { listWorkItemLinks } = await import('./plane-work-item-links')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockResolvedValue([{ id: 'l1', url: 'https://a.dev', title: 'A' }])

    const links = await listWorkItemLinks({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(links).toEqual([{ id: 'l1', url: 'https://a.dev', title: 'A' }])
  })

  it('maps a paginated results envelope', async () => {
    const { listWorkItemLinks } = await import('./plane-work-item-links')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockResolvedValue({ results: [{ id: 'l2', url: 'https://b.dev' }] })

    const links = await listWorkItemLinks({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(links).toEqual([{ id: 'l2', url: 'https://b.dev', title: undefined }])
  })
})
