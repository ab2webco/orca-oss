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

vi.mock('./client', () => ({
  acquire: acquireMock,
  release: releaseMock,
  getClients: getClientsMock,
  planeRequest: planeRequestMock,
  clearWorkspaceTokenOnAuthError: clearWorkspaceTokenOnAuthErrorMock
}))

function client(workspaceSlug: string, baseUrl = 'https://api.plane.so'): PlaneClientForWorkspace {
  return {
    baseUrl,
    workspaceSlug,
    headers: { 'x-api-key': `key-${workspaceSlug}`, 'x-workspace-slug': workspaceSlug }
  }
}

function page<T>(results: T[], nextCursor = '', nextPageResults = false) {
  return { results, next_cursor: nextCursor, next_page_results: nextPageResults }
}

function pathOf(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://placeholder')
  return { pathname: parsed.pathname, params: parsed.searchParams }
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  clearWorkspaceTokenOnAuthErrorMock.mockClear()
})

describe('401 token clearing (deferred from Slice 4/5)', () => {
  it('clears the workspace token when listStates hits an auth error', async () => {
    const { listStates } = await import('./plane-work-item-reads')
    const acme = client('acme')
    getClientsMock.mockReturnValue([acme])
    const authError = new Error('Unauthorized')
    planeRequestMock.mockRejectedValue(authError)

    const result = await listStates('proj-1', 'acme')

    expect(result).toEqual([])
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })

  it('clears the workspace token when listMembers hits an auth error', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    const acme = client('acme')
    getClientsMock.mockReturnValue([acme])
    const authError = new Error('Unauthorized')
    planeRequestMock.mockRejectedValue(authError)

    const result = await listMembers('acme')

    expect(result).toEqual([])
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, authError)
  })
})

describe('listProjects', () => {
  it('paginates a single connected workspace until exhausted', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock
      .mockResolvedValueOnce(page([{ id: 'p-1', identifier: 'ALPHA', name: 'Alpha' }], 'c2', true))
      .mockResolvedValueOnce(page([{ id: 'p-2', identifier: 'BETA', name: 'Beta' }]))

    const projects = await listProjects('acme')

    expect(projects.map((project) => project.identifier)).toEqual(['ALPHA', 'BETA'])
    expect(planeRequestMock).toHaveBeenCalledTimes(2)
    const secondCallPath = pathOf(planeRequestMock.mock.calls[1][1] as string)
    expect(secondCallPath.params.get('cursor')).toBe('c2')
  })

  it('returns [] when nothing is connected', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([])
    expect(await listProjects(null)).toEqual([])
    expect(planeRequestMock).not.toHaveBeenCalled()
  })

  // ORCA-139: an aggregate read must stay grouped and attributed, otherwise a
  // multi-workspace answer is indistinguishable from a single-workspace one.
  it('aggregates every connected workspace, grouped by workspace then name', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('zeta'), client('acme')])
    planeRequestMock
      .mockResolvedValueOnce(
        page([
          { id: 'p-z2', identifier: 'ZULU', name: 'Zulu' },
          { id: 'p-z1', identifier: 'ALPHA', name: 'Alpha' }
        ])
      )
      .mockResolvedValueOnce(page([{ id: 'p-a1', identifier: 'BETA', name: 'Beta' }]))

    const projects = await listProjects('all')

    expect(projects).toEqual([
      {
        id: 'p-a1',
        identifier: 'BETA',
        name: 'Beta',
        workspaceSlug: 'acme',
        workspaceId: expect.any(String)
      },
      {
        id: 'p-z1',
        identifier: 'ALPHA',
        name: 'Alpha',
        workspaceSlug: 'zeta',
        workspaceId: expect.any(String)
      },
      {
        id: 'p-z2',
        identifier: 'ZULU',
        name: 'Zulu',
        workspaceSlug: 'zeta',
        workspaceId: expect.any(String)
      }
    ])
  })

  it('gives each workspace a distinct workspaceId so consumers can group by it', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme'), client('beta')])
    planeRequestMock
      .mockResolvedValueOnce(page([{ id: 'p-a', identifier: 'A', name: 'A' }]))
      .mockResolvedValueOnce(page([{ id: 'p-b', identifier: 'B', name: 'B' }]))

    const projects = await listProjects('all')
    const workspaceIds = projects.map((project) => project.workspaceId)

    expect(workspaceIds.filter(Boolean)).toHaveLength(2)
    expect(new Set(workspaceIds).size).toBe(2)
  })

  it('tolerates one failing workspace and still returns the healthy results', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme'), client('beta')])
    planeRequestMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page([{ id: 'p-b', identifier: 'BETA', name: 'Beta' }]))

    const projects = await listProjects('all')

    expect(projects.map((project) => project.id)).toEqual(['p-b'])
    expect(projects[0].workspaceSlug).toBe('beta')
  })

  // Workspace identity is (baseUrl, workspaceSlug), so a self-hosted and a
  // cloud workspace can share a slug; sorting on the slug alone would
  // interleave them back into one anonymous list.
  it('keeps same-slug workspaces on different hosts apart', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([
      client('acme', 'https://plane.self-hosted.test'),
      client('acme', 'https://api.plane.so')
    ])
    planeRequestMock
      .mockResolvedValueOnce(
        page([
          { id: 'p-self-a', identifier: 'ALPHA', name: 'Alpha' },
          { id: 'p-self-z', identifier: 'ZULU', name: 'Zulu' }
        ])
      )
      .mockResolvedValueOnce(
        page([
          { id: 'p-cloud-b', identifier: 'BETA', name: 'Beta' },
          { id: 'p-cloud-y', identifier: 'YANKEE', name: 'Yankee' }
        ])
      )

    const projects = await listProjects('all')
    const workspaceIds = projects.map((project) => project.workspaceId)

    expect(new Set(workspaceIds).size).toBe(2)
    // Contiguous runs, not Alpha/Beta/Yankee/Zulu — a name-only sort interleaves.
    const runs = workspaceIds.filter((id, index) => id !== workspaceIds[index - 1]).length
    expect(runs).toBe(2)
  })

  it('keeps a single-workspace read attributed to that workspace', async () => {
    const { listProjects } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock.mockResolvedValueOnce(
      page([
        { id: 'p-2', identifier: 'BETA', name: 'Beta' },
        { id: 'p-1', identifier: 'ALPHA', name: 'Alpha' }
      ])
    )

    const projects = await listProjects('ws-acme')

    expect(projects.map((project) => project.identifier)).toEqual(['ALPHA', 'BETA'])
    expect(projects.every((project) => project.workspaceSlug === 'acme')).toBe(true)
    expect(new Set(projects.map((project) => project.workspaceId)).size).toBe(1)
  })
})

describe('listStates', () => {
  it('maps native sequence and sorts by it', async () => {
    const { listStates } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock.mockResolvedValueOnce(
      page([
        { id: 's-2', name: 'Done', group: 'completed', sequence: 2 },
        { id: 's-1', name: 'Todo', group: 'unstarted', sequence: 1 }
      ])
    )

    const states = await listStates('proj-1', 'acme')

    expect(states.map((state) => state.id)).toEqual(['s-1', 's-2'])
    const { pathname } = pathOf(planeRequestMock.mock.calls[0][1] as string)
    expect(pathname).toBe('/api/v1/workspaces/acme/projects/proj-1/states/')
  })
})

describe('listLabels', () => {
  it('maps id/name/color', async () => {
    const { listLabels } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock.mockResolvedValueOnce(page([{ id: 'l-1', name: 'bug', color: '#f00' }]))

    const labels = await listLabels('proj-1', 'acme')
    expect(labels).toEqual([{ id: 'l-1', name: 'bug', color: '#f00' }])
  })
})

describe('listMembers', () => {
  it('fans out across every connected workspace and flattens the unpaginated arrays', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme'), client('beta')])
    planeRequestMock
      .mockResolvedValueOnce([{ id: 'u-1', display_name: 'Ada' }])
      .mockResolvedValueOnce([{ id: 'u-2', display_name: 'Grace' }])

    const members = await listMembers('all')

    expect(members.map((member) => member.id)).toEqual(['u-1', 'u-2'])
    expect(planeRequestMock).toHaveBeenCalledTimes(2)
  })

  it('tolerates one failing workspace and still returns the healthy results', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme'), client('beta')])
    planeRequestMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ id: 'u-2', display_name: 'Grace' }])

    const members = await listMembers('all')
    expect(members.map((member) => member.id)).toEqual(['u-2'])
  })

  it('uses the project-members path and maps the nested `member` shape when projectId is given', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock.mockResolvedValueOnce([
      { member: { id: 'u-9', display_name: 'Nested Ada' }, role: 20 },
      { id: 'u-3', display_name: 'Flat Grace' }
    ])

    const members = await listMembers('ws-1', 'proj-7')

    expect(members.map((member) => member.id)).toEqual(['u-9', 'u-3'])
    expect(members.map((member) => member.displayName)).toEqual(['Nested Ada', 'Flat Grace'])
    expect(planeRequestMock).toHaveBeenCalledTimes(1)
    const { pathname } = pathOf(planeRequestMock.mock.calls[0][1] as string)
    expect(pathname).toBe('/api/v1/workspaces/acme/projects/proj-7/members/')
  })

  it('uses the workspace-members path when no projectId is given', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock.mockResolvedValueOnce([{ id: 'u-1', display_name: 'Ada' }])

    await listMembers('ws-1')

    const { pathname } = pathOf(planeRequestMock.mock.calls[0][1] as string)
    expect(pathname).toBe('/api/v1/workspaces/acme/members/')
  })

  it('falls back to workspace members when the project-members list is empty', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    getClientsMock.mockReturnValue([client('acme')])
    planeRequestMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'u-ws', display_name: 'Workspace Ada' }])

    const members = await listMembers('ws-1', 'proj-7')

    expect(members.map((member) => member.id)).toEqual(['u-ws'])
    expect(pathOf(planeRequestMock.mock.calls[0][1] as string).pathname).toBe(
      '/api/v1/workspaces/acme/projects/proj-7/members/'
    )
    expect(pathOf(planeRequestMock.mock.calls[1][1] as string).pathname).toBe(
      '/api/v1/workspaces/acme/members/'
    )
  })

  it('falls back to workspace members when the project-members request fails', async () => {
    const { listMembers } = await import('./plane-work-item-reads')
    const acme = client('acme')
    getClientsMock.mockReturnValue([acme])
    const boom = new Error('project members boom')
    planeRequestMock
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce([{ id: 'u-ws', display_name: 'Workspace Ada' }])

    const members = await listMembers('ws-1', 'proj-7')

    expect(members.map((member) => member.id)).toEqual(['u-ws'])
    expect(clearWorkspaceTokenOnAuthErrorMock).toHaveBeenCalledWith(acme, boom)
    expect(planeRequestMock).toHaveBeenCalledTimes(2)
  })
})
