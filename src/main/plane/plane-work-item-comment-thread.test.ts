import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const {
  acquireMock,
  releaseMock,
  getClientsMock,
  planeRequestMock,
  clearWorkspaceTokenOnAuthErrorMock
} = vi.hoisted(() => ({
  acquireMock: vi.fn(async () => undefined),
  releaseMock: vi.fn(),
  getClientsMock: vi.fn(),
  planeRequestMock: vi.fn(),
  clearWorkspaceTokenOnAuthErrorMock: vi.fn()
}))

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
  clearWorkspaceTokenOnAuthError: clearWorkspaceTokenOnAuthErrorMock
}))

function client(workspaceSlug = 'acme'): PlaneClientForWorkspace {
  return {
    baseUrl: 'https://api.plane.so',
    workspaceSlug,
    headers: { 'x-api-key': `key-${workspaceSlug}`, 'x-workspace-slug': workspaceSlug }
  }
}

function pathOf(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://placeholder')
  return { pathname: parsed.pathname, params: parsed.searchParams }
}

function page<T>(results: T[], nextCursor = '', nextPageResults = false) {
  return { results, next_cursor: nextCursor, next_page_results: nextPageResults }
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  clearWorkspaceTokenOnAuthErrorMock.mockClear()
})

describe('listWorkItemComments', () => {
  it('paginates via cursor and maps html bodies to markdown', async () => {
    const { listWorkItemComments } = await import('./plane-work-item-comment-thread')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockImplementation((_client, url: string) => {
      const { pathname, params } = pathOf(url)
      expect(pathname).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/comments/')
      const cursor = params.get('cursor')
      if (cursor === 'page-2') {
        return Promise.resolve(
          page([
            {
              id: 'c-2',
              comment_html: '<p>second</p>',
              created_at: '2026-01-02T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              actor: { id: 'u-1', display_name: 'Ada' }
            }
          ])
        )
      }
      return Promise.resolve(
        page(
          [
            {
              id: 'c-1',
              comment_html: '<p><strong>first</strong></p>',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              actor: { id: 'u-2', display_name: 'Grace' }
            }
          ],
          'page-2',
          true
        )
      )
    })

    const comments = await listWorkItemComments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(comments).toEqual([
      {
        id: 'c-1',
        body: '**first**',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        user: { id: 'u-2', displayName: 'Grace', email: undefined, avatarUrl: undefined }
      },
      {
        id: 'c-2',
        body: 'second',
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        user: { id: 'u-1', displayName: 'Ada', email: undefined, avatarUrl: undefined }
      }
    ])
  })

  it('returns an empty array when the request fails', async () => {
    const { listWorkItemComments } = await import('./plane-work-item-comment-thread')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('Server error', 500))

    const comments = await listWorkItemComments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(comments).toEqual([])
  })

  it('returns an empty array when no Plane workspace is connected', async () => {
    const { listWorkItemComments } = await import('./plane-work-item-comment-thread')
    getClientsMock.mockReturnValue([])

    const comments = await listWorkItemComments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(comments).toEqual([])
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})

describe('readWorkItemCommentThread', () => {
  it('reports an empty thread as a successful read, not a failure', async () => {
    const { readWorkItemCommentThread } = await import('./plane-work-item-comment-thread')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockResolvedValue(page([]))

    const read = await readWorkItemCommentThread({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(read).toEqual({ ok: true, comments: [] })
  })

  it('reports the failure instead of an empty thread, and clears the token on 401', async () => {
    const { readWorkItemCommentThread } = await import('./plane-work-item-comment-thread')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const read = await readWorkItemCommentThread({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(read).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('reports an unresolved workspace as a failure, since nothing was read', async () => {
    const { readWorkItemCommentThread } = await import('./plane-work-item-comment-thread')
    getClientsMock.mockReturnValue([])

    const read = await readWorkItemCommentThread({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(read).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})
