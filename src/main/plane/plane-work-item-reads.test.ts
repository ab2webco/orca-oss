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
})
