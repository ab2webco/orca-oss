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

describe('401 token clearing (deferred from Slice 4/5)', () => {
  it('clears the workspace token when updateWorkItem hits an auth error', async () => {
    const { updateWorkItem } = await import('./plane-work-item-writes')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await updateWorkItem({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      updates: { stateId: 'state-2' }
    })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('clears the workspace token when addWorkItemComment hits an auth error', async () => {
    const { addWorkItemComment } = await import('./plane-work-item-writes')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await addWorkItemComment({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      body: 'Looks good'
    })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('clears the workspace token when listWorkItemComments hits an auth error', async () => {
    const { listWorkItemComments } = await import('./plane-work-item-writes')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await listWorkItemComments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(result).toEqual([])
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })
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

describe('createWorkItem', () => {
  it('POSTs the mapped body and derives identifier/url from the response', async () => {
    const { createWorkItem } = await import('./plane-work-item-create')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url).pathname
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({
        id: 'wi-new',
        sequence_id: 42,
        project: 'proj-1',
        project_identifier: 'PROJ'
      })
    })

    const result = await createWorkItem({
      projectId: 'proj-1',
      title: 'Investigate flaky login',
      workspaceId: 'acme',
      stateId: 'state-3',
      assigneeIds: ['user-1'],
      labelIds: ['label-1', 'label-2'],
      priority: 'high',
      startDate: '2026-01-01',
      targetDate: '2026-02-01',
      parentId: 'wi-parent'
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/work-items/')
    expect(capturedBody).toEqual({
      name: 'Investigate flaky login',
      state: 'state-3',
      assignees: ['user-1'],
      labels: ['label-1', 'label-2'],
      priority: 'high',
      start_date: '2026-01-01',
      target_date: '2026-02-01',
      parent: 'wi-parent'
    })
    expect(result).toEqual({
      ok: true,
      id: 'wi-new',
      identifier: 'PROJ-42',
      url: 'https://app.plane.so/acme/browse/PROJ-42/'
    })
  })

  it('sends only name when only the required title is set', async () => {
    const { createWorkItem } = await import('./plane-work-item-create')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'wi-new', sequence_id: 1, project_identifier: 'PROJ' })
    })

    await createWorkItem({ projectId: 'proj-1', title: 'Bare item' })

    expect(capturedBody).toEqual({ name: 'Bare item' })
  })

  it('runs description through markdownToPlaneHtml', async () => {
    const { createWorkItem } = await import('./plane-work-item-create')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: { description_html?: string } | undefined
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'wi-new', sequence_id: 1, project_identifier: 'PROJ' })
    })

    await createWorkItem({ projectId: 'proj-1', title: 'X', description: '**bold** text' })

    expect(capturedBody?.description_html).toBe('<p><strong>bold</strong> text</p>')
  })

  it('resolves the project identifier from the project list when absent from the response', async () => {
    const { createWorkItem } = await import('./plane-work-item-create')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ id: 'wi-new', sequence_id: 7, project: 'proj-1' })
      }
      // Fallback path: the projects list resolves proj-1 -> PROJ.
      return Promise.resolve(page([{ id: 'proj-1', identifier: 'PROJ', name: 'Project' }]))
    })

    const result = await createWorkItem({ projectId: 'proj-1', title: 'X' })

    expect(result).toEqual({
      ok: true,
      id: 'wi-new',
      identifier: 'PROJ-7',
      url: 'https://app.plane.so/acme/browse/PROJ-7/'
    })
  })

  it('returns ok:false and clears the token on an auth error', async () => {
    const { createWorkItem } = await import('./plane-work-item-create')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await createWorkItem({ projectId: 'proj-1', title: 'X' })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('returns ok:false when no Plane workspace is connected', async () => {
    const { createWorkItem } = await import('./plane-work-item-create')
    getClientsMock.mockReturnValue([])

    const result = await createWorkItem({ projectId: 'proj-1', title: 'X' })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})

describe('createPlaneState', () => {
  it('POSTs to the project states path with name + group and maps the result', async () => {
    const { createPlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url).pathname
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({
        id: 'state-new',
        name: 'In Review',
        group: 'started',
        sequence: 30000,
        color: '#abc'
      })
    })

    const result = await createPlaneState({
      projectId: 'proj-1',
      workspaceId: 'acme',
      name: 'In Review',
      group: 'started'
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/states/')
    // color is required by the API; omitting it falls back to the group default.
    expect(capturedBody).toEqual({ name: 'In Review', group: 'started', color: '#f59e0b' })
    expect(result).toEqual({
      ok: true,
      state: {
        id: 'state-new',
        name: 'In Review',
        group: 'started',
        sequence: 30000,
        color: '#abc'
      }
    })
  })

  it('uses the explicit color when provided (overriding the group default)', async () => {
    const { createPlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 's', name: 'X', group: 'backlog' })
    })

    await createPlaneState({
      projectId: 'proj-1',
      name: 'X',
      group: 'backlog',
      color: '#123456'
    })

    expect(capturedBody).toEqual({ name: 'X', group: 'backlog', color: '#123456' })
  })

  it('returns ok:false and clears the token on an auth error', async () => {
    const { createPlaneState } = await import('./plane-work-item-writes')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await createPlaneState({ projectId: 'proj-1', name: 'X', group: 'unstarted' })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('returns ok:false when no Plane workspace is connected', async () => {
    const { createPlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([])

    const result = await createPlaneState({ projectId: 'proj-1', name: 'X', group: 'unstarted' })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})

describe('updatePlaneState', () => {
  it('PATCHes the project state path with only the provided fields', async () => {
    const { updatePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url).pathname
      capturedMethod = init?.method
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'state-2', name: 'Renamed', group: 'unstarted' })
    })

    const result = await updatePlaneState({
      projectId: 'proj-1',
      workspaceId: 'acme',
      stateId: 'state-2',
      name: 'Renamed'
    })

    expect(capturedMethod).toBe('PATCH')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/states/state-2/')
    expect(capturedBody).toEqual({ name: 'Renamed' })
    expect(result).toEqual({
      ok: true,
      state: {
        id: 'state-2',
        name: 'Renamed',
        group: 'unstarted',
        sequence: undefined,
        color: undefined
      }
    })
  })

  it('sends both name and color when both are provided', async () => {
    const { updatePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'state-2', name: 'Renamed', group: 'started' })
    })

    await updatePlaneState({
      projectId: 'proj-1',
      stateId: 'state-2',
      name: 'Renamed',
      color: '#00ff00'
    })

    expect(capturedBody).toEqual({ name: 'Renamed', color: '#00ff00' })
  })

  it('returns ok:false and clears the token on an auth error', async () => {
    const { updatePlaneState } = await import('./plane-work-item-writes')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await updatePlaneState({
      projectId: 'proj-1',
      stateId: 'state-2',
      name: 'Renamed'
    })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('returns ok:false when no Plane workspace is connected', async () => {
    const { updatePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([])

    const result = await updatePlaneState({
      projectId: 'proj-1',
      stateId: 'state-2',
      name: 'Renamed'
    })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })

  it('includes sequence in the PATCH body when provided (column reorder)', async () => {
    const { updatePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedBody: unknown
    planeRequestMock.mockImplementation((_client, _url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return Promise.resolve({ id: 'state-2', name: 'Doing', group: 'started', sequence: 2000 })
    })

    await updatePlaneState({ projectId: 'proj-1', stateId: 'state-2', sequence: 2000 })

    expect(capturedBody).toEqual({ sequence: 2000 })
  })
})

describe('deletePlaneState', () => {
  it('DELETEs the project state path', async () => {
    const { deletePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    let capturedPath: string | undefined
    let capturedMethod: string | undefined
    planeRequestMock.mockImplementation((_client, url: string, init?: RequestInit) => {
      capturedPath = pathOf(url).pathname
      capturedMethod = init?.method
      return Promise.resolve(undefined)
    })

    const result = await deletePlaneState({
      projectId: 'proj-1',
      workspaceId: 'acme',
      stateId: 'state-2'
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedPath).toBe('/api/v1/workspaces/acme/projects/proj-1/states/state-2/')
    expect(result).toEqual({ ok: true })
  })

  it('returns ok:false and clears the token on an auth error', async () => {
    const { deletePlaneState } = await import('./plane-work-item-writes')
    const acme = client()
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    const result = await deletePlaneState({ projectId: 'proj-1', stateId: 'state-2' })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('surfaces the API error when Plane rejects the delete (state still has items)', async () => {
    const { deletePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('State has work items', 400))

    const result = await deletePlaneState({ projectId: 'proj-1', stateId: 'state-2' })

    expect(result).toEqual({ ok: false, error: 'State has work items' })
  })

  it('returns ok:false when no Plane workspace is connected', async () => {
    const { deletePlaneState } = await import('./plane-work-item-writes')
    getClientsMock.mockReturnValue([])

    const result = await deletePlaneState({ projectId: 'proj-1', stateId: 'state-2' })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
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
