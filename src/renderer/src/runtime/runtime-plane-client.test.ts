import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  planeAddWorkItemComment,
  planeConnect,
  planeDisconnect,
  planeGetWorkItem,
  planeListLabels,
  planeListMembers,
  planeListProjects,
  planeListStates,
  planeListWorkItemComments,
  planeListWorkItems,
  planeSearchWorkItems,
  planeSelectWorkspace,
  planeStatus,
  planeTestConnection,
  planeUpdateWorkItem
} from './runtime-plane-client'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()

const planeLocal = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  selectWorkspace: vi.fn(),
  testConnection: vi.fn(),
  listWorkItems: vi.fn(),
  searchWorkItems: vi.fn(),
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  addWorkItemComment: vi.fn(),
  listWorkItemComments: vi.fn(),
  listProjects: vi.fn(),
  listStates: vi.fn(),
  listLabels: vi.fn(),
  listMembers: vi.fn()
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  for (const fn of Object.values(planeLocal)) {
    fn.mockReset()
  }
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall },
      plane: planeLocal
    }
  })
})

const LOCAL = { activeRuntimeEnvironmentId: null }
const REMOTE = { activeRuntimeEnvironmentId: 'env-1' }

describe('runtime Plane client — local dispatch', () => {
  it('routes every method to window.api.plane when no runtime environment is active', async () => {
    planeLocal.status.mockResolvedValue({ connected: false, viewer: null })
    planeLocal.connect.mockResolvedValue({
      ok: true,
      viewer: { id: 'v1', displayName: 'V', email: null }
    })
    planeLocal.selectWorkspace.mockResolvedValue({ connected: true, viewer: null })
    planeLocal.testConnection.mockResolvedValue({
      ok: true,
      viewer: { id: 'v1', displayName: 'V', email: null }
    })
    planeLocal.listWorkItems.mockResolvedValue([{ id: 'wi-1' }])
    planeLocal.searchWorkItems.mockResolvedValue([{ id: 'wi-2' }])
    planeLocal.getWorkItem.mockResolvedValue({ id: 'wi-1' })
    planeLocal.updateWorkItem.mockResolvedValue({ ok: true })
    planeLocal.addWorkItemComment.mockResolvedValue({ ok: true, id: 'c-1' })
    planeLocal.listWorkItemComments.mockResolvedValue([{ id: 'c-1' }])
    planeLocal.listProjects.mockResolvedValue([{ id: 'p-1' }])
    planeLocal.listStates.mockResolvedValue([{ id: 's-1' }])
    planeLocal.listLabels.mockResolvedValue([{ id: 'l-1' }])
    planeLocal.listMembers.mockResolvedValue([{ id: 'u-1' }])

    await expect(planeStatus(LOCAL)).resolves.toEqual({ connected: false, viewer: null })
    await planeConnect(LOCAL, { baseUrl: 'https://x', workspaceSlug: 'acme', apiKey: 'k' })
    await planeDisconnect(LOCAL, 'ws-1')
    await planeSelectWorkspace(LOCAL, 'ws-1')
    await planeTestConnection(LOCAL, 'ws-1')
    await planeListWorkItems(LOCAL, { projectId: 'p-1', filter: 'assigned', workspaceId: 'ws-1' })
    await planeSearchWorkItems(LOCAL, 'bug', 'p-1', 'ws-1')
    await planeGetWorkItem(LOCAL, 'wi-1', 'p-1', 'ws-1')
    await planeUpdateWorkItem(LOCAL, 'p-1', 'wi-1', { title: 'New' }, 'ws-1')
    await planeAddWorkItemComment(LOCAL, 'p-1', 'wi-1', 'hello', 'ws-1')
    await planeListWorkItemComments(LOCAL, 'p-1', 'wi-1', 'ws-1')
    await planeListProjects(LOCAL, 'ws-1')
    await planeListStates(LOCAL, 'p-1', 'ws-1')
    await planeListLabels(LOCAL, 'p-1', 'ws-1')
    await planeListMembers(LOCAL, 'ws-1')

    expect(planeLocal.status).toHaveBeenCalled()
    expect(planeLocal.connect).toHaveBeenCalledWith({
      baseUrl: 'https://x',
      workspaceSlug: 'acme',
      apiKey: 'k'
    })
    expect(planeLocal.disconnect).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(planeLocal.selectWorkspace).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(planeLocal.testConnection).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(planeLocal.listWorkItems).toHaveBeenCalledWith({
      projectId: 'p-1',
      filter: 'assigned',
      workspaceId: 'ws-1'
    })
    expect(planeLocal.searchWorkItems).toHaveBeenCalledWith({
      query: 'bug',
      projectId: 'p-1',
      workspaceId: 'ws-1'
    })
    expect(planeLocal.getWorkItem).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      projectId: 'p-1',
      workspaceId: 'ws-1'
    })
    expect(planeLocal.updateWorkItem).toHaveBeenCalledWith({
      projectId: 'p-1',
      workItemId: 'wi-1',
      updates: { title: 'New' },
      workspaceId: 'ws-1'
    })
    expect(planeLocal.addWorkItemComment).toHaveBeenCalledWith({
      projectId: 'p-1',
      workItemId: 'wi-1',
      body: 'hello',
      workspaceId: 'ws-1'
    })
    expect(planeLocal.listWorkItemComments).toHaveBeenCalledWith({
      projectId: 'p-1',
      workItemId: 'wi-1',
      workspaceId: 'ws-1'
    })
    expect(planeLocal.listProjects).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(planeLocal.listStates).toHaveBeenCalledWith({ projectId: 'p-1', workspaceId: 'ws-1' })
    expect(planeLocal.listLabels).toHaveBeenCalledWith({ projectId: 'p-1', workspaceId: 'ws-1' })
    expect(planeLocal.listMembers).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('rejects oversized local Plane search queries before IPC', async () => {
    await expect(planeSearchWorkItems(LOCAL, 'secret-token-value'.repeat(1024))).resolves.toEqual(
      []
    )
    expect(planeLocal.searchWorkItems).not.toHaveBeenCalled()
  })
})

describe('runtime Plane client — remote dispatch', () => {
  it('routes reads through the selected runtime environment with jira-mirrored timeouts', async () => {
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc',
      ok: true,
      result: {},
      _meta: { runtimeId: 'runtime-1' }
    })

    await planeStatus(REMOTE)
    await planeDisconnect(REMOTE, 'ws-1')
    await planeSelectWorkspace(REMOTE, 'ws-1')
    await planeConnect(REMOTE, { baseUrl: 'https://x', workspaceSlug: 'acme', apiKey: 'k' })
    await planeTestConnection(REMOTE, 'ws-1')
    await planeListWorkItems(REMOTE, { projectId: 'p-1', filter: 'assigned', workspaceId: 'ws-1' })
    await planeSearchWorkItems(REMOTE, 'bug', 'p-1', 'ws-1')
    await planeGetWorkItem(REMOTE, 'wi-1', 'p-1', 'ws-1')
    await planeUpdateWorkItem(REMOTE, 'p-1', 'wi-1', { title: 'New' }, 'ws-1')
    await planeAddWorkItemComment(REMOTE, 'p-1', 'wi-1', 'hello', 'ws-1')
    await planeListWorkItemComments(REMOTE, 'p-1', 'wi-1', 'ws-1')
    await planeListProjects(REMOTE, 'ws-1')
    await planeListStates(REMOTE, 'p-1', 'ws-1')
    await planeListLabels(REMOTE, 'p-1', 'ws-1')
    await planeListMembers(REMOTE, 'ws-1')

    const timeoutFor = (method: string): number | undefined =>
      runtimeEnvironmentCall.mock.calls.find(([call]) => call.method === method)?.[0].timeoutMs

    expect(timeoutFor('plane.status')).toBe(15_000)
    expect(timeoutFor('plane.disconnect')).toBe(15_000)
    expect(timeoutFor('plane.selectWorkspace')).toBe(15_000)
    expect(timeoutFor('plane.connect')).toBe(30_000)
    expect(timeoutFor('plane.testConnection')).toBe(30_000)
    expect(timeoutFor('plane.listWorkItems')).toBe(30_000)
    expect(timeoutFor('plane.searchWorkItems')).toBe(30_000)
    expect(timeoutFor('plane.getWorkItem')).toBe(30_000)
    expect(timeoutFor('plane.updateWorkItem')).toBe(30_000)
    expect(timeoutFor('plane.addWorkItemComment')).toBe(30_000)
    expect(timeoutFor('plane.listWorkItemComments')).toBe(30_000)
    expect(timeoutFor('plane.listProjects')).toBe(30_000)
    expect(timeoutFor('plane.listStates')).toBe(30_000)
    expect(timeoutFor('plane.listLabels')).toBe(30_000)
    expect(timeoutFor('plane.listMembers')).toBe(30_000)
    expect(planeLocal.status).not.toHaveBeenCalled()
    expect(planeLocal.listWorkItems).not.toHaveBeenCalled()
  })

  it('sends plane.searchWorkItems params through the RPC bridge', async () => {
    runtimeEnvironmentCall.mockResolvedValueOnce({
      id: 'rpc-search',
      ok: true,
      result: [{ id: 'wi-1' }],
      _meta: { runtimeId: 'runtime-1' }
    })

    await expect(planeSearchWorkItems(REMOTE, 'bug', 'p-1', 'ws-1')).resolves.toEqual([
      { id: 'wi-1' }
    ])

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'plane.searchWorkItems',
      params: { query: 'bug', projectId: 'p-1', workspaceId: 'ws-1' },
      timeoutMs: 30_000
    })
  })

  it('rejects oversized remote Plane search queries before RPC', async () => {
    await expect(planeSearchWorkItems(REMOTE, 'x'.repeat(9 * 1024))).resolves.toEqual([])
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })
})
