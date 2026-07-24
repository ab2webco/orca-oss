import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  connectMock,
  disconnectMock,
  statusMock,
  selectWorkspaceMock,
  testConnectionMock,
  listWorkItemsMock,
  searchWorkItemsMock,
  getWorkItemMock,
  updateWorkItemMock,
  addWorkItemCommentMock,
  listWorkItemCommentsMock,
  listProjectsMock,
  listStatesMock,
  listLabelsMock,
  listMembersMock,
  resetPreflightCacheMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  statusMock: vi.fn(),
  selectWorkspaceMock: vi.fn(),
  testConnectionMock: vi.fn(),
  listWorkItemsMock: vi.fn(),
  searchWorkItemsMock: vi.fn(),
  getWorkItemMock: vi.fn(),
  updateWorkItemMock: vi.fn(),
  addWorkItemCommentMock: vi.fn(),
  listWorkItemCommentsMock: vi.fn(),
  listProjectsMock: vi.fn(),
  listStatesMock: vi.fn(),
  listLabelsMock: vi.fn(),
  listMembersMock: vi.fn(),
  resetPreflightCacheMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('../plane/client', () => ({
  connect: connectMock
}))

vi.mock('../plane/plane-connection-lifecycle', () => ({
  disconnect: disconnectMock,
  status: statusMock,
  selectWorkspace: selectWorkspaceMock,
  testConnection: testConnectionMock
}))

vi.mock('../plane/work-items', () => ({
  listWorkItems: listWorkItemsMock,
  searchWorkItems: searchWorkItemsMock,
  getWorkItem: getWorkItemMock
}))

vi.mock('../plane/plane-work-item-writes', () => ({
  updateWorkItem: updateWorkItemMock,
  addWorkItemComment: addWorkItemCommentMock,
  listWorkItemComments: listWorkItemCommentsMock
}))

vi.mock('../plane/plane-work-item-reads', () => ({
  listProjects: listProjectsMock,
  listStates: listStatesMock,
  listLabels: listLabelsMock,
  listMembers: listMembersMock
}))

vi.mock('./preflight', () => ({
  _resetPreflightCache: resetPreflightCacheMock
}))

import { registerPlaneHandlers } from './plane'

type Handler = (event: unknown, args?: unknown) => unknown

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel)
  if (!call) {
    throw new Error(`No handler registered for channel: ${channel}`)
  }
  return call[1] as Handler
}

describe('registerPlaneHandlers', () => {
  beforeEach(() => {
    handleMock.mockClear()
    connectMock.mockReset()
    disconnectMock.mockReset()
    statusMock.mockReset()
    selectWorkspaceMock.mockReset()
    testConnectionMock.mockReset()
    listWorkItemsMock.mockReset()
    searchWorkItemsMock.mockReset()
    getWorkItemMock.mockReset()
    updateWorkItemMock.mockReset()
    addWorkItemCommentMock.mockReset()
    listWorkItemCommentsMock.mockReset()
    listProjectsMock.mockReset()
    listStatesMock.mockReset()
    listLabelsMock.mockReset()
    listMembersMock.mockReset()
    resetPreflightCacheMock.mockClear()
    registerPlaneHandlers()
  })

  it('registers every plane:* channel', () => {
    const channels = handleMock.mock.calls.map(([channel]) => channel)
    expect(channels).toEqual(
      expect.arrayContaining([
        'plane:connect',
        'plane:disconnect',
        'plane:selectWorkspace',
        'plane:status',
        'plane:testConnection',
        'plane:listWorkItems',
        'plane:searchWorkItems',
        'plane:getWorkItem',
        'plane:updateWorkItem',
        'plane:addWorkItemComment',
        'plane:listWorkItemComments',
        'plane:listProjects',
        'plane:listStates',
        'plane:listLabels',
        'plane:listMembers'
      ])
    )
  })

  it('connects and resets the preflight cache on success', async () => {
    connectMock.mockResolvedValue({ ok: true, viewer: { id: 'user-1' } })
    const handler = getHandler('plane:connect')

    const result = await handler(undefined, {
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'secret'
    })

    expect(connectMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'secret'
    })
    expect(resetPreflightCacheMock).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, viewer: { id: 'user-1' } })
  })

  it('rejects connect when required fields are missing', async () => {
    const handler = getHandler('plane:connect')

    const result = await handler(undefined, {
      baseUrl: '',
      workspaceSlug: 'acme',
      apiKey: 'secret'
    })

    expect(connectMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      error: 'Base URL, workspace slug, and API key are required.'
    })
  })

  it('disconnects and resets the preflight cache', async () => {
    const handler = getHandler('plane:disconnect')

    await handler(undefined, { workspaceId: 'ws-1' })

    expect(disconnectMock).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(resetPreflightCacheMock).toHaveBeenCalled()
  })

  it('returns [] for listWorkItems when filter is invalid', async () => {
    listWorkItemsMock.mockResolvedValue([])
    const handler = getHandler('plane:listWorkItems')

    await handler(undefined, { filter: 'bogus', workspaceId: 'ws-1' })

    expect(listWorkItemsMock).toHaveBeenCalledWith({
      projectId: undefined,
      filter: 'all',
      workspaceId: 'ws-1'
    })
  })

  it('returns [] for searchWorkItems when query is missing', async () => {
    const handler = getHandler('plane:searchWorkItems')

    const result = await handler(undefined, {})

    expect(searchWorkItemsMock).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('returns null for getWorkItem when workItemId is missing', async () => {
    const handler = getHandler('plane:getWorkItem')

    const result = await handler(undefined, {})

    expect(getWorkItemMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('rejects updateWorkItem when updates is missing', async () => {
    const handler = getHandler('plane:updateWorkItem')

    const result = await handler(undefined, { projectId: 'proj-1', workItemId: 'wi-1' })

    expect(updateWorkItemMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'Updates object is required.' })
  })

  it('forwards a valid updateWorkItem call', async () => {
    updateWorkItemMock.mockResolvedValue({ ok: true })
    const handler = getHandler('plane:updateWorkItem')

    const result = await handler(undefined, {
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workspaceId: 'ws-1',
      updates: { stateId: 'state-2' }
    })

    expect(updateWorkItemMock).toHaveBeenCalledWith({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workspaceId: 'ws-1',
      updates: { stateId: 'state-2' }
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejects addWorkItemComment when body is missing', async () => {
    const handler = getHandler('plane:addWorkItemComment')

    const result = await handler(undefined, { projectId: 'proj-1', workItemId: 'wi-1' })

    expect(addWorkItemCommentMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'Comment body is required.' })
  })

  it('forwards listStates and listLabels with projectId', async () => {
    listStatesMock.mockResolvedValue([{ id: 'state-1' }])
    listLabelsMock.mockResolvedValue([{ id: 'label-1' }])

    await getHandler('plane:listStates')(undefined, { projectId: 'proj-1', workspaceId: 'ws-1' })
    await getHandler('plane:listLabels')(undefined, { projectId: 'proj-1', workspaceId: 'ws-1' })

    expect(listStatesMock).toHaveBeenCalledWith('proj-1', 'ws-1')
    expect(listLabelsMock).toHaveBeenCalledWith('proj-1', 'ws-1')
  })

  it('returns [] for listStates/listLabels when projectId is missing', async () => {
    const result = await getHandler('plane:listStates')(undefined, {})
    expect(listStatesMock).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('forwards listProjects and listMembers with workspaceId', async () => {
    listProjectsMock.mockResolvedValue([{ id: 'proj-1' }])
    listMembersMock.mockResolvedValue([{ id: 'user-1' }])

    await getHandler('plane:listProjects')(undefined, { workspaceId: 'ws-1' })
    await getHandler('plane:listMembers')(undefined, { workspaceId: 'ws-1' })

    expect(listProjectsMock).toHaveBeenCalledWith('ws-1')
    expect(listMembersMock).toHaveBeenCalledWith('ws-1')
  })
})
