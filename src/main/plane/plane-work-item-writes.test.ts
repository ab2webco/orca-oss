import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const { acquireMock, releaseMock, getClientsMock, planeRequestMock } = vi.hoisted(() => ({
  acquireMock: vi.fn(async () => undefined),
  releaseMock: vi.fn(),
  getClientsMock: vi.fn(),
  planeRequestMock: vi.fn()
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
  PlaneApiError: MockPlaneApiError
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
})

describe('updateWorkItem: partial PATCH mapping', () => {
  it('sends only state when only stateId is set', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    let capturedMethod: string | undefined
    let capturedPath: string | undefined
    planeRequestMock.mockImplementation((_client, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url).pathname
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({})
    })

    const result = await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workspaceId: 'acme',
      updates: { stateId: 'state-2' }
    })

    expect(result).toEqual({ ok: true })
    expect(capturedMethod).toBe('PATCH')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/')
    expect(capturedBody).toEqual({ state: 'state-2' })
  })

  it('sends only assignees when only assigneeIds is set', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({})
    })

    await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      updates: { assigneeIds: ['user-1', 'user-2'] }
    })

    expect(capturedBody).toEqual({ assignees: ['user-1', 'user-2'] })
  })

  it('maps every field at once and omits every unset field', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({})
    })

    await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      updates: {
        title: 'New title',
        stateId: 'state-3',
        assigneeIds: ['user-1'],
        labelIds: ['label-1', 'label-2'],
        priority: 'high',
        startDate: '2026-01-01',
        targetDate: '2026-02-01',
        parentId: 'wi-parent'
      }
    })

    expect(capturedBody).toEqual({
      name: 'New title',
      state: 'state-3',
      assignees: ['user-1'],
      labels: ['label-1', 'label-2'],
      priority: 'high',
      start_date: '2026-01-01',
      target_date: '2026-02-01',
      parent: 'wi-parent'
    })
  })

  it('runs description through markdownToPlaneHtml', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: { description_html?: string } | undefined
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({})
    })

    await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      updates: { description: '**bold** text' }
    })

    expect(capturedBody?.description_html).toBe('<p><strong>bold</strong> text</p>')
  })

  it('allows clearing the parent by sending parentId: null', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({})
    })

    await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      updates: { parentId: null }
    })

    expect(capturedBody).toEqual({ parent: null })
  })

  it('returns ok:false with the server error on a non-2xx response', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('Work item not found', 404))

    const result = await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'missing',
      updates: { stateId: 'state-1' }
    })

    expect(result).toEqual({ ok: false, error: 'Work item not found' })
  })

  it('returns ok:false when no Plane workspace is connected', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([])

    const result = await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      updates: { stateId: 'state-1' }
    })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})

describe('addWorkItemComment', () => {
  it('posts comment_html converted from markdown and returns the new id', async () => {
    const { addWorkItemComment } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url).pathname
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'comment-1' })
    })

    const result = await addWorkItemComment({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      body: '**hello**'
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/comments/')
    expect(capturedBody).toEqual({ comment_html: '<p><strong>hello</strong></p>' })
    expect(result).toEqual({ ok: true, id: 'comment-1' })
  })

  it('returns ok:false on a non-2xx response', async () => {
    const { addWorkItemComment } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('Forbidden', 403))

    const result = await addWorkItemComment({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      body: 'hi'
    })

    expect(result).toEqual({ ok: false, error: 'Forbidden' })
  })
})

describe('listWorkItemComments', () => {
  it('paginates via cursor and maps html bodies to markdown', async () => {
    const { listWorkItemComments } = await import('./plane-work-item-writes')
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
    const { listWorkItemComments } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('Server error', 500))

    const comments = await listWorkItemComments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(comments).toEqual([])
  })

  it('returns an empty array when no Plane workspace is connected', async () => {
    const { listWorkItemComments } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([])

    const comments = await listWorkItemComments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(comments).toEqual([])
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})
