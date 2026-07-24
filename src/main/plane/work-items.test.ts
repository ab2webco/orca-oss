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

function client(workspaceSlug: string): PlaneClientForWorkspace {
  return {
    baseUrl: 'https://api.plane.so',
    workspaceSlug,
    headers: { 'x-api-key': `key-${workspaceSlug}`, 'x-workspace-slug': workspaceSlug }
  }
}

function page<T>(results: T[], nextCursor = '', nextPageResults = false) {
  return { results, next_cursor: nextCursor, next_page_results: nextPageResults }
}

function projectsPage(projects: { id: string; identifier: string; name: string }[]) {
  return page(projects)
}

function pathOf(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://placeholder')
  return { pathname: parsed.pathname, params: parsed.searchParams }
}

const ALPHA = { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha Project' }
const BETA = { id: 'proj-2', identifier: 'BETA', name: 'Beta Project' }

function rawWorkItem(id: string, projectId: string, sequenceId: number) {
  return {
    id,
    project: projectId,
    sequence_id: sequenceId,
    name: `Work item ${id}`,
    priority: 'medium',
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    assignees: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
}

// Requests routed by pathname: a project-scoped work-items call always
// carries /projects/<id>/ before /work-items/, a workspace-wide call never
// does -- that distinction is exactly what proves whether the two-level
// (getClients x listProjects) fan-out was avoided per the Step 0 spike.
function routeRequest(
  handlers: Partial<{
    projects: (client: PlaneClientForWorkspace) => unknown
    projectWorkItems: (
      client: PlaneClientForWorkspace,
      projectId: string,
      params: URLSearchParams
    ) => unknown
    workspaceWorkItems: (client: PlaneClientForWorkspace, params: URLSearchParams) => unknown
    retrieveByUuid: (
      client: PlaneClientForWorkspace,
      projectId: string,
      workItemId: string
    ) => unknown
    retrieveByIdentifier: (client: PlaneClientForWorkspace, identifier: string) => unknown
  }>
) {
  return async (planeClient: PlaneClientForWorkspace, url: string) => {
    const { pathname, params } = pathOf(url)
    const projectWorkItemsMatch =
      /^\/api\/v1\/workspaces\/[^/]+\/projects\/([^/]+)\/work-items\/$/.exec(pathname)
    const workspaceWorkItemsMatch = /^\/api\/v1\/workspaces\/[^/]+\/work-items\/$/.exec(pathname)
    const retrieveUuidMatch =
      /^\/api\/v1\/workspaces\/[^/]+\/projects\/([^/]+)\/work-items\/([^/]+)\/$/.exec(pathname)
    const retrieveIdentifierMatch = /^\/api\/v1\/workspaces\/[^/]+\/work-items\/([^/]+)\/$/.exec(
      pathname
    )
    const projectsMatch = /^\/api\/v1\/workspaces\/[^/]+\/projects\/$/.exec(pathname)

    if (retrieveUuidMatch && handlers.retrieveByUuid) {
      return handlers.retrieveByUuid(planeClient, retrieveUuidMatch[1], retrieveUuidMatch[2])
    }
    if (projectWorkItemsMatch && handlers.projectWorkItems) {
      return handlers.projectWorkItems(planeClient, projectWorkItemsMatch[1], params)
    }
    if (retrieveIdentifierMatch && handlers.retrieveByIdentifier) {
      return handlers.retrieveByIdentifier(planeClient, retrieveIdentifierMatch[1])
    }
    if (workspaceWorkItemsMatch && handlers.workspaceWorkItems) {
      return handlers.workspaceWorkItems(planeClient, params)
    }
    if (projectsMatch && handlers.projects) {
      return handlers.projects(planeClient)
    }
    throw new Error(`Unhandled mock request: ${pathname}`)
  }
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  clearWorkspaceTokenOnAuthErrorMock.mockClear()
})

describe('401 token clearing (deferred from Slice 4/5)', () => {
  it('clears the workspace token when searchWorkItems hits an auth error', async () => {
    const { searchWorkItems } = await import('./work-items')
    const acme = client('acme')
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    await expect(searchWorkItems({ query: 'priority = urgent', workspaceId: 'acme' })).rejects.toBe(
      authError
    )

    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('clears the workspace token when getWorkItem hits an auth error', async () => {
    const { getWorkItem } = await import('./work-items')
    const acme = client('acme')
    getClientsMock.mockReturnValue([acme])
    const authError = new MockPlaneApiError('Unauthorized', 401)
    planeRequestMock.mockRejectedValue(authError)

    await expect(getWorkItem({ workItemId: 'ALPHA-1', workspaceId: 'acme' })).rejects.toBe(
      authError
    )

    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })
})

describe('listWorkItems: single project + cursor pagination', () => {
  it('scopes to the given project and paginates until next_page_results is false', async () => {
    const { listWorkItems } = await import('./work-items')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        projectWorkItems: (_client, projectId, params) => {
          expect(projectId).toBe('proj-1')
          const cursor = params.get('cursor')
          return cursor === 'page-2'
            ? page([rawWorkItem('wi-2', 'proj-1', 2)])
            : page([rawWorkItem('wi-1', 'proj-1', 1)], 'page-2', true)
        }
      })
    )

    const items = await listWorkItems({
      projectId: 'proj-1',
      filter: 'assigned',
      workspaceId: 'acme'
    })

    expect(items.map((item) => item.identifier)).toEqual(['ALPHA-1', 'ALPHA-2'])
  })

  it('sends the pinned PQL string for the given filter', async () => {
    const { listWorkItems } = await import('./work-items')
    getClientsMock.mockReturnValue([client('acme')])
    let capturedPql: string | null = null
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        projectWorkItems: (_client, _projectId, params) => {
          capturedPql = params.get('pql')
          return page([])
        }
      })
    )

    await listWorkItems({ projectId: 'proj-1', filter: 'done', workspaceId: 'acme' })
    expect(capturedPql).toBe('assignee = currentUser() AND stateGroup IN closedStates()')
  })
})

describe('listWorkItems: workspace-wide fan-out across connected Plane workspaces', () => {
  it('fans out per project within each client -- no working workspace-wide work-items route, so an "all projects" selection lists each client\'s projects then issues one project-scoped GET per project', async () => {
    const clients = [client('acme'), client('beta')]
    getClientsMock.mockReturnValue(clients)
    const { listWorkItems } = await import('./work-items')

    planeRequestMock.mockImplementation(
      routeRequest({
        // acme has two projects, beta has one -- proves the per-project fan-out
        // isn't just incidentally 1:1 with clients.
        projects: (planeClient) =>
          projectsPage(planeClient.workspaceSlug === 'acme' ? [ALPHA, BETA] : [BETA]),
        projectWorkItems: (planeClient, projectId) => {
          if (planeClient.workspaceSlug === 'acme' && projectId === 'proj-1') {
            return page([rawWorkItem('wi-1', 'proj-1', 1)])
          }
          if (planeClient.workspaceSlug === 'acme' && projectId === 'proj-2') {
            return page([rawWorkItem('wi-2', 'proj-2', 2)])
          }
          return page([rawWorkItem('wi-3', 'proj-2', 1)])
        }
      })
    )

    const items = await listWorkItems({ filter: 'all', workspaceId: 'all' })

    // One projects-list call per client (2), plus one project-scoped
    // work-items call per project across both clients (2 for acme + 1 for
    // beta = 3) = 5 total. Never a workspace-wide /work-items/ call.
    expect(planeRequestMock).toHaveBeenCalledTimes(5)
    const calledUrls = planeRequestMock.mock.calls.map((call) => call[1] as string)
    expect(
      calledUrls.some((url) => /\/workspaces\/[^/]+\/work-items\/$/.test(pathOf(url).pathname))
    ).toBe(false)
    expect(
      calledUrls.filter((url) =>
        /\/workspaces\/[^/]+\/projects\/[^/]+\/work-items\/$/.test(pathOf(url).pathname)
      )
    ).toHaveLength(3)
    expect(items.map((item) => item.identifier).sort()).toEqual(
      ['ALPHA-1', 'BETA-1', 'BETA-2'].sort()
    )
  })

  it('preserves client order and never runs more than MAX_CONCURRENT=4 requests at once', async () => {
    const clients = Array.from({ length: 6 }, (_unused, index) => client(`ws-${index}`))
    getClientsMock.mockReturnValue(clients)
    const { listWorkItems } = await import('./work-items')

    let active = 0
    let maxActive = 0
    planeRequestMock.mockImplementation(
      async (planeClient: PlaneClientForWorkspace, url: string) => {
        const { pathname } = pathOf(url)
        const index = Number(planeClient.workspaceSlug.split('-')[1])
        if (pathname.endsWith('/projects/')) {
          return projectsPage([
            { id: `proj-${index}`, identifier: `WS${index}`, name: `Ws ${index}` }
          ])
        }
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return page([rawWorkItem(`wi-${index}`, `proj-${index}`, index)])
      }
    )

    const items = await listWorkItems({ filter: 'all', workspaceId: 'all' })

    expect(maxActive).toBeLessThanOrEqual(4)
    expect(items.map((item) => item.id)).toEqual(['wi-0', 'wi-1', 'wi-2', 'wi-3', 'wi-4', 'wi-5'])
  })

  it('tolerates one failing connected workspace under an all-workspace selection', async () => {
    getClientsMock.mockReturnValue([client('acme'), client('beta')])
    const { listWorkItems } = await import('./work-items')

    planeRequestMock.mockImplementation(
      routeRequest({
        projects: (planeClient) =>
          projectsPage(planeClient.workspaceSlug === 'acme' ? [ALPHA] : [BETA]),
        projectWorkItems: (planeClient) => {
          if (planeClient.workspaceSlug === 'acme') {
            throw new Error('acme is down')
          }
          return page([rawWorkItem('wi-3', 'proj-2', 1)])
        }
      })
    )

    const items = await listWorkItems({ filter: 'all', workspaceId: 'all' })
    expect(items.map((item) => item.identifier)).toEqual(['BETA-1'])
  })
})

describe('searchWorkItems', () => {
  it('passes the raw PQL query through unmodified', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { searchWorkItems } = await import('./work-items')
    const complexQuery =
      'priority = "urgent" AND assignee = currentUser() AND stateGroup NOT IN closedStates() ' +
      'AND labels IN ("bug", "regression") AND createdAt > "2026-01-01" OR parent IS NOT EMPTY'
    let capturedPql: string | null = null
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        projectWorkItems: (_client, _projectId, params) => {
          capturedPql = params.get('pql')
          return page([])
        }
      })
    )

    await searchWorkItems({ query: complexQuery, projectId: 'proj-1', workspaceId: 'acme' })
    expect(capturedPql).toBe(complexQuery)
  })

  it('lets a Plane 400 for an over-complex PQL surface instead of being swallowed', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { searchWorkItems } = await import('./work-items')
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        projectWorkItems: () => {
          throw new MockPlaneApiError('Query too complex: max 5 conditions', 400)
        }
      })
    )

    await expect(
      searchWorkItems({
        query: 'a=1 AND b=2 AND c=3 AND d=4 AND e=5 AND f=6',
        projectId: 'proj-1',
        workspaceId: 'acme'
      })
    ).rejects.toThrow('Query too complex')
  })

  it('returns [] for a blank query without making any request', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { searchWorkItems } = await import('./work-items')
    expect(await searchWorkItems({ query: '   ', workspaceId: 'acme' })).toEqual([])
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})

describe('getWorkItem: UUID vs PROJECT-N identifier routing', () => {
  it('retrieves by human identifier directly, without needing to resolve a project UUID first', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { getWorkItem } = await import('./work-items')
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        retrieveByIdentifier: (_client, identifier) => {
          expect(identifier).toBe('ALPHA-12')
          return rawWorkItem('wi-1', 'proj-1', 12)
        }
      })
    )

    const item = await getWorkItem({ workItemId: 'ALPHA-12', workspaceId: 'acme' })
    expect(item?.identifier).toBe('ALPHA-12')
  })

  it('retrieves a UUID directly against the given project', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { getWorkItem } = await import('./work-items')
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        retrieveByUuid: (_client, projectId, workItemId) => {
          expect(projectId).toBe('proj-1')
          expect(workItemId).toBe('11111111-1111-1111-1111-111111111111')
          return rawWorkItem('11111111-1111-1111-1111-111111111111', 'proj-1', 7)
        }
      })
    )

    const item = await getWorkItem({
      workItemId: '11111111-1111-1111-1111-111111111111',
      projectId: 'proj-1',
      workspaceId: 'acme'
    })
    expect(item?.identifier).toBe('ALPHA-7')
  })

  it('fans out across every project when a UUID is given with no projectId, and 404s cleanly if none match', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { getWorkItem } = await import('./work-items')
    const targetId = '22222222-2222-2222-2222-222222222222'
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA, BETA]),
        retrieveByUuid: (_client, projectId, workItemId) => {
          if (projectId === 'proj-2' && workItemId === targetId) {
            return rawWorkItem(targetId, 'proj-2', 3)
          }
          throw new MockPlaneApiError('Not found', 404)
        }
      })
    )

    const found = await getWorkItem({ workItemId: targetId, workspaceId: 'acme' })
    expect(found?.identifier).toBe('BETA-3')

    const notFound = await getWorkItem({ workItemId: 'no-such-id', workspaceId: 'acme' })
    expect(notFound).toBeNull()
  })

  it('returns null cleanly on a 404 for an unknown identifier', async () => {
    getClientsMock.mockReturnValue([client('acme')])
    const { getWorkItem } = await import('./work-items')
    planeRequestMock.mockImplementation(
      routeRequest({
        projects: () => projectsPage([ALPHA]),
        retrieveByIdentifier: () => {
          throw new MockPlaneApiError('Not found', 404)
        }
      })
    )

    expect(await getWorkItem({ workItemId: 'ALPHA-999', workspaceId: 'acme' })).toBeNull()
  })
})
