import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const {
  acquireMock,
  releaseMock,
  getClientsMock,
  planeRequestMock,
  clearTokenMock,
  getWorkspaceFileMock
} = vi.hoisted(() => ({
  acquireMock: vi.fn(async () => undefined),
  releaseMock: vi.fn(),
  getClientsMock: vi.fn(),
  planeRequestMock: vi.fn(),
  clearTokenMock: vi.fn(),
  getWorkspaceFileMock: vi.fn()
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
  clearWorkspaceTokenOnAuthError: clearTokenMock
}))

vi.mock('./plane-workspace-store', () => ({
  getWorkspaceFile: getWorkspaceFileMock,
  // Pulled in transitively by work-items.ts, which the shared error mapper lives
  // next to; stubbed so the mock satisfies the whole module link.
  getCachedViewer: vi.fn(() => null),
  setCachedViewer: vi.fn(),
  getPlaneWorkspaceId: vi.fn(() => 'ws-id')
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

type Captured = { path?: string; method?: string; body?: unknown }

function captureRequest(response: unknown): Captured {
  const captured: Captured = {}
  planeRequestMock.mockImplementation((_c, url: string, init?: RequestInit) => {
    captured.path = pathOf(url)
    captured.method = init?.method
    captured.body = init?.body === undefined ? undefined : JSON.parse(init.body as string)
    return Promise.resolve(response)
  })
  return captured
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  clearTokenMock.mockClear()
  getWorkspaceFileMock.mockReset()
  getWorkspaceFileMock.mockReturnValue({
    version: 1,
    activeWorkspaceId: null,
    selectedWorkspaceId: null,
    workspaces: []
  })
})

describe('createProject', () => {
  it('POSTs name + identifier to the workspace projects path and maps the result', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest({ id: 'proj-1', identifier: 'MP', name: 'My Project' })

    const result = await createProject({
      name: 'My Project',
      identifier: 'MP',
      description: 'Ships the thing',
      workspace: 'ws-acme'
    })

    expect(captured.method).toBe('POST')
    expect(captured.path).toBe('/api/v1/workspaces/acme/projects/')
    expect(captured.body).toEqual({
      name: 'My Project',
      identifier: 'MP',
      description: 'Ships the thing'
    })
    expect(result).toEqual({
      ok: true,
      project: {
        id: 'proj-1',
        identifier: 'MP',
        name: 'My Project',
        workspaceSlug: 'acme',
        // A freshly created project is never archived (ORCA-140).
        archived: false
      }
    })
  })

  // Plane's project description is plain text, unlike work-item/comment bodies.
  it('sends description as plain text, never description_html', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest({ id: 'proj-1', identifier: 'MP', name: 'My Project' })

    await createProject({ name: 'My Project', identifier: 'MP', description: '**bold**' })

    expect(captured.body).toEqual({
      name: 'My Project',
      identifier: 'MP',
      description: '**bold**'
    })
  })

  it('omits description when not provided', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest({ id: 'proj-1', identifier: 'MP', name: 'My Project' })

    await createProject({ name: 'My Project', identifier: 'MP' })

    expect(captured.body).toEqual({ name: 'My Project', identifier: 'MP' })
  })

  it('falls back to a workspace slug when the selection is not a saved id', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockImplementation((selection?: string) =>
      selection === 'ws-1' ? [client('acme')] : []
    )
    getWorkspaceFileMock.mockReturnValue({
      version: 1,
      activeWorkspaceId: 'ws-1',
      selectedWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', baseUrl: 'https://api.plane.so', workspaceSlug: 'acme' }]
    })
    const captured = captureRequest({ id: 'proj-1', identifier: 'MP', name: 'My Project' })

    const result = await createProject({ name: 'My Project', identifier: 'MP', workspace: 'ACME' })

    expect(captured.path).toBe('/api/v1/workspaces/acme/projects/')
    expect(result.ok).toBe(true)
  })

  it('names the unmatched workspace when nothing resolves', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([])

    const result = await createProject({ name: 'My Project', identifier: 'MP', workspace: 'ghost' })

    expect(result).toEqual({
      ok: false,
      error: 'No connected Plane workspace matches "ghost".'
    })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })

  it('returns ok:false when no workspace is connected at all', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([])

    const result = await createProject({ name: 'My Project', identifier: 'MP' })

    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(planeRequestMock).not.toHaveBeenCalled()
  })

  it('maps a Plane rejection to ok:false and clears a bad token', async () => {
    const { createProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const authError = new MockPlaneApiError('Identifier already taken', 401)
    planeRequestMock.mockRejectedValue(authError)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await createProject({ name: 'My Project', identifier: 'MP' })

    expect(result).toEqual({ ok: false, error: 'Identifier already taken' })
    expect(clearTokenMock).toHaveBeenCalledWith(client(), authError)
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })
})

describe('updateProject', () => {
  it('PATCHes only the provided fields to the project path', async () => {
    const { updateProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest({ id: 'proj-1', identifier: 'MP', name: 'Renamed' })

    const result = await updateProject({ projectId: 'proj-1', name: 'Renamed' })

    expect(captured.method).toBe('PATCH')
    expect(captured.path).toBe('/api/v1/workspaces/acme/projects/proj-1/')
    expect(captured.body).toEqual({ name: 'Renamed' })
    expect(result).toEqual({
      ok: true,
      project: {
        id: 'proj-1',
        identifier: 'MP',
        name: 'Renamed',
        workspaceSlug: 'acme',
        archived: false
      }
    })
  })

  it('sends every provided field, including an emptied description', async () => {
    const { updateProject } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest({ id: 'proj-1', identifier: 'NEW', name: 'Renamed' })

    await updateProject({
      projectId: 'proj-1',
      name: 'Renamed',
      identifier: 'NEW',
      description: ''
    })

    expect(captured.body).toEqual({ name: 'Renamed', identifier: 'NEW', description: '' })
  })
})

describe('setProjectArchived', () => {
  it('POSTs the archive path when archiving', async () => {
    const { setProjectArchived } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest(null)

    const result = await setProjectArchived({ projectId: 'proj-1', archived: true })

    expect(captured.method).toBe('POST')
    expect(captured.path).toBe('/api/v1/workspaces/acme/projects/proj-1/archive/')
    expect(captured.body).toBeUndefined()
    expect(result).toEqual({ ok: true })
  })

  it('DELETEs the same archive path when unarchiving', async () => {
    const { setProjectArchived } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    const captured = captureRequest(null)

    const result = await setProjectArchived({ projectId: 'proj-1', archived: false })

    expect(captured.method).toBe('DELETE')
    expect(captured.path).toBe('/api/v1/workspaces/acme/projects/proj-1/archive/')
    expect(result).toEqual({ ok: true })
  })

  it('reports which direction failed', async () => {
    const { setProjectArchived } = await import('./plane-project-write')
    getClientsMock.mockReturnValue([client()])
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('Project not found', 404))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await setProjectArchived({ projectId: 'proj-1', archived: false })

    expect(warn).toHaveBeenCalledWith('[plane]', 'Failed to unarchive project.', expect.anything())
  })
})
