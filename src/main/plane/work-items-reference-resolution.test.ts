// Locks the ORCA-333 list contract: list URLs never carry `expand` (Plane
// resolves it per row server-side, so list latency grew with item count),
// bare state/label/assignee UUIDs resolve from cached per-project reference
// lists, and a list of N items costs ceil(N/page) page requests.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const { acquireMock, releaseMock, getClientsMock, planeRequestMock } = vi.hoisted(() => ({
  acquireMock: vi.fn(async () => undefined),
  releaseMock: vi.fn(),
  getClientsMock: vi.fn(),
  planeRequestMock: vi.fn()
}))

vi.mock('./client', () => ({
  acquire: acquireMock,
  release: releaseMock,
  getClients: getClientsMock,
  planeRequest: planeRequestMock,
  PlaneApiError: class extends Error {
    status: number | null = null
  },
  clearWorkspaceTokenOnAuthError: vi.fn(),
  USERS_ME_PATH: '/api/v1/users/me/',
  toViewer: () => ({ id: '', displayName: 'Plane user', email: null })
}))

vi.mock('./plane-workspace-store', () => ({
  getCachedViewer: () => null,
  setCachedViewer: vi.fn(),
  getPlaneWorkspaceId: (baseUrl: string, workspaceSlug: string) => `${baseUrl}\n${workspaceSlug}`
}))

const ACME: PlaneClientForWorkspace = {
  baseUrl: 'https://api.plane.so',
  workspaceSlug: 'acme',
  headers: { 'x-api-key': 'key-acme', 'x-workspace-slug': 'acme' }
}

function page<T>(results: T[], nextCursor = '', nextPageResults = false) {
  return { results, next_cursor: nextCursor, next_page_results: nextPageResults }
}

function pathOf(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://placeholder')
  return { pathname: parsed.pathname, params: parsed.searchParams }
}

// Non-expanded list rows: state is a bare UUID, labels/assignees are UUID arrays.
function bareRawWorkItem(
  id: string,
  sequenceId: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    project: 'proj-1',
    sequence_id: sequenceId,
    name: `Work item ${id}`,
    priority: 'medium',
    state: 'state-1',
    labels: [],
    assignees: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

const OPEN_STATE = { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 }
const ALPHA = { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha Project' }

type Handlers = Partial<{
  workItems: (params: URLSearchParams) => unknown
  states: () => unknown
  labels: () => unknown
  projectMembers: () => unknown
  workspaceMembers: () => unknown
  retrieve: () => unknown
}>

function routeRequest(handlers: Handlers) {
  return async (_client: PlaneClientForWorkspace, url: string) => {
    const { pathname, params } = pathOf(url)
    const route = (suffix: string): boolean =>
      new RegExp(`^/api/v1/workspaces/[^/]+/projects/[^/]+/${suffix}/$`).test(pathname)
    if (/^\/api\/v1\/workspaces\/[^/]+\/projects\/$/.test(pathname)) {
      return page([ALPHA])
    }
    if (route('work-items') && handlers.workItems) {
      return handlers.workItems(params)
    }
    if (route('states') && handlers.states) {
      return handlers.states()
    }
    if (route('labels') && handlers.labels) {
      return handlers.labels()
    }
    if (route('members') && handlers.projectMembers) {
      return handlers.projectMembers()
    }
    if (/^\/api\/v1\/workspaces\/[^/]+\/members\/$/.test(pathname) && handlers.workspaceMembers) {
      return handlers.workspaceMembers()
    }
    if (/^\/api\/v1\/workspaces\/[^/]+\/work-items\/[^/]+\/$/.test(pathname) && handlers.retrieve) {
      return handlers.retrieve()
    }
    throw new Error(`Unhandled mock request: ${pathname}`)
  }
}

function requestUrls(pattern: RegExp): string[] {
  return planeRequestMock.mock.calls
    .map((call) => call[1] as string)
    .filter((url) => pattern.test(pathOf(url).pathname))
}

async function listAlpha() {
  const { listWorkItems } = await import('./work-items')
  return listWorkItems({ projectId: 'proj-1', filter: 'all', workspaceId: 'acme' })
}

beforeEach(async () => {
  const { clearWorkItemReferenceCachesForTest } =
    await import('./plane-work-item-reference-resolution')
  clearWorkItemReferenceCachesForTest()
  planeRequestMock.mockReset()
  getClientsMock.mockReset()
  getClientsMock.mockReturnValue([ACME])
})

describe('listWorkItems: no expand + client-side reference resolution (ORCA-333)', () => {
  it('builds list URLs with per_page=100 and pql but never expand; retrieve still expands', async () => {
    planeRequestMock.mockImplementation(
      routeRequest({
        workItems: (params) => {
          expect(params.has('expand')).toBe(false)
          expect(params.get('per_page')).toBe('100')
          expect(params.get('pql')).toBeTruthy()
          return page([bareRawWorkItem('wi-1', 1)])
        },
        states: () => page([OPEN_STATE]),
        retrieve: () => bareRawWorkItem('wi-1', 1)
      })
    )

    await listAlpha()
    const { getWorkItem } = await import('./work-items')
    await getWorkItem({ workItemId: 'ALPHA-1', workspaceId: 'acme' })

    const retrieveUrl = requestUrls(/\/work-items\/[^/]+\/$/)[0]
    expect(pathOf(retrieveUrl).params.get('expand')).toBe('assignees,labels,state')
  })

  it('issues ceil(N/page) page requests plus one projects call, and one reference list per kind actually referenced', async () => {
    // 250 items over three pages; rows reference only a state, so labels and
    // members must not be fetched at all.
    const pages = [
      page(
        Array.from({ length: 100 }, (_u, i) => bareRawWorkItem(`wi-${i}`, i + 1)),
        'page-2',
        true
      ),
      page(
        Array.from({ length: 100 }, (_u, i) => bareRawWorkItem(`wi-${100 + i}`, 101 + i)),
        'page-3',
        true
      ),
      page(Array.from({ length: 50 }, (_u, i) => bareRawWorkItem(`wi-${200 + i}`, 201 + i)))
    ]
    planeRequestMock.mockImplementation(
      routeRequest({
        workItems: (params) => {
          const cursor = params.get('cursor')
          return cursor === 'page-3' ? pages[2] : cursor === 'page-2' ? pages[1] : pages[0]
        },
        states: () => page([OPEN_STATE]),
        labels: () => page([]),
        projectMembers: () => [],
        workspaceMembers: () => []
      })
    )

    const items = await listAlpha()

    expect(items).toHaveLength(250)
    expect(requestUrls(/\/projects\/[^/]+\/work-items\/$/)).toHaveLength(3)
    expect(requestUrls(/\/projects\/$/)).toHaveLength(1)
    expect(requestUrls(/\/states\/$/)).toHaveLength(1)
    expect(requestUrls(/\/labels\/$/)).toHaveLength(0)
    expect(requestUrls(/\/members\/$/)).toHaveLength(0)
    expect(planeRequestMock).toHaveBeenCalledTimes(5)
  })

  it('resolves bare state, label and assignee UUIDs from the project reference lists', async () => {
    planeRequestMock.mockImplementation(
      routeRequest({
        workItems: () =>
          page([
            bareRawWorkItem('wi-1', 1, {
              state: 'state-2',
              labels: ['label-1'],
              assignees: ['user-1']
            })
          ]),
        states: () =>
          page([OPEN_STATE, { id: 'state-2', name: 'In Progress', group: 'started', sequence: 2 }]),
        labels: () => page([{ id: 'label-1', name: 'Bug', color: '#f00' }]),
        projectMembers: () => [{ member: { id: 'user-1', display_name: 'Ana' } }]
      })
    )

    const items = await listAlpha()

    expect(items).toHaveLength(1)
    expect(items[0].state).toMatchObject({ id: 'state-2', name: 'In Progress', group: 'started' })
    expect(items[0].labels).toEqual(['Bug'])
    expect(items[0].labelIds).toEqual(['label-1'])
    expect(items[0].assignees).toEqual([{ id: 'user-1', displayName: 'Ana' }])
  })

  it('caches reference lists per project across list calls', async () => {
    let statesCalls = 0
    planeRequestMock.mockImplementation(
      routeRequest({
        workItems: () => page([bareRawWorkItem('wi-1', 1)]),
        states: () => {
          statesCalls += 1
          return page([OPEN_STATE])
        }
      })
    )

    await listAlpha()
    await listAlpha()

    expect(statesCalls).toBe(1)
  })

  it('refetches a reference list when a row carries an id the cache does not cover', async () => {
    vi.useFakeTimers()
    try {
      let statesCalls = 0
      let stateId = 'state-1'
      planeRequestMock.mockImplementation(
        routeRequest({
          workItems: () => page([bareRawWorkItem('wi-1', 1, { state: stateId })]),
          // A state created after the first fetch: only later fetches see it.
          states: () => {
            statesCalls += 1
            return statesCalls === 1
              ? page([OPEN_STATE])
              : page([OPEN_STATE, { id: 'state-9', name: 'Review', group: 'started', sequence: 3 }])
          }
        })
      )

      await listAlpha()
      // Beyond the refetch floor, an uncovered id must trigger a fresh fetch.
      vi.setSystemTime(Date.now() + 16_000)
      stateId = 'state-9'
      const items = await listAlpha()

      expect(statesCalls).toBe(2)
      expect(items[0].state.name).toBe('Review')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to workspace members for an assignee missing from project members', async () => {
    planeRequestMock.mockImplementation(
      routeRequest({
        workItems: () => page([bareRawWorkItem('wi-1', 1, { assignees: ['user-2'] })]),
        states: () => page([OPEN_STATE]),
        projectMembers: () => [{ member: { id: 'user-1', display_name: 'Ana' } }],
        workspaceMembers: () => [{ id: 'user-2', display_name: 'Bea' }]
      })
    )

    const items = await listAlpha()

    expect(items[0].assignees).toEqual([{ id: 'user-2', displayName: 'Bea' }])
  })
})
