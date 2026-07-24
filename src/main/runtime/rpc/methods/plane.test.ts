import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PLANE_METHODS } from './plane'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('plane RPC methods', () => {
  it('routes Plane connection methods to the runtime server, trimming input', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeStatus: vi.fn().mockResolvedValue({ connected: true, viewer: null }),
      planeTestConnection: vi.fn().mockResolvedValue({ ok: true, viewer: { displayName: 'Ada' } }),
      planeConnect: vi.fn().mockResolvedValue({ ok: true, viewer: { displayName: 'Ada' } }),
      planeSelectWorkspace: vi.fn().mockResolvedValue({ connected: true, viewer: null }),
      planeDisconnect: vi.fn().mockResolvedValue({ ok: true })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(makeRequest('plane.status'))
    await dispatcher.dispatch(makeRequest('plane.testConnection'))
    await dispatcher.dispatch(
      makeRequest('plane.connect', {
        baseUrl: '  https://api.plane.so  ',
        workspaceSlug: '  acme  ',
        apiKey: '  secret-token  '
      })
    )
    await dispatcher.dispatch(makeRequest('plane.selectWorkspace', { workspaceId: '  ws-1  ' }))
    await dispatcher.dispatch(makeRequest('plane.disconnect'))

    expect(runtime.planeStatus).toHaveBeenCalled()
    expect(runtime.planeTestConnection).toHaveBeenCalled()
    expect(runtime.planeConnect).toHaveBeenCalledWith({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'secret-token'
    })
    expect(runtime.planeSelectWorkspace).toHaveBeenCalledWith('ws-1')
    expect(runtime.planeDisconnect).toHaveBeenCalledWith(undefined)
  })

  it('rejects Plane connect when required fields are missing', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeConnect: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('plane.connect', { baseUrl: '', workspaceSlug: 'acme', apiKey: 'secret' })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeConnect).not.toHaveBeenCalled()
  })

  it('routes Plane work-item queries and mutations to the runtime server', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeListWorkItems: vi.fn().mockResolvedValue([{ id: 'wi-1' }]),
      planeSearchWorkItems: vi.fn().mockResolvedValue([{ id: 'wi-2' }]),
      planeGetWorkItem: vi.fn().mockResolvedValue({ id: 'wi-3' }),
      planeUpdateWorkItem: vi.fn().mockResolvedValue({ ok: true }),
      planeAddWorkItemComment: vi.fn().mockResolvedValue({ ok: true, id: 'comment-1' }),
      planeListWorkItemComments: vi.fn().mockResolvedValue([{ id: 'comment-2' }])
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      makeRequest('plane.listWorkItems', { filter: 'assigned', workspaceId: 'ws-1' })
    )
    await dispatcher.dispatch(makeRequest('plane.listWorkItems'))
    await dispatcher.dispatch(
      makeRequest('plane.searchWorkItems', {
        query: '  priority = urgent  ',
        projectId: 'proj-1',
        workspaceId: 'ws-1'
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.getWorkItem', { workItemId: '  wi-3  ', workspaceId: 'ws-1' })
    )
    await dispatcher.dispatch(
      makeRequest('plane.updateWorkItem', {
        projectId: 'proj-1',
        workItemId: 'wi-3',
        workspaceId: 'ws-1',
        updates: { title: 'Fixed title', stateId: 'state-1', labelIds: ['bug'] }
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.addWorkItemComment', {
        projectId: 'proj-1',
        workItemId: 'wi-3',
        body: '  Looks good  ',
        workspaceId: 'ws-1'
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.listWorkItemComments', {
        projectId: 'proj-1',
        workItemId: 'wi-3',
        workspaceId: 'ws-1'
      })
    )

    expect(runtime.planeListWorkItems).toHaveBeenCalledWith({
      projectId: undefined,
      filter: 'assigned',
      workspaceId: 'ws-1'
    })
    expect(runtime.planeListWorkItems).toHaveBeenCalledWith({
      projectId: undefined,
      filter: 'all',
      workspaceId: undefined
    })
    expect(runtime.planeSearchWorkItems).toHaveBeenCalledWith({
      query: 'priority = urgent',
      projectId: 'proj-1',
      workspaceId: 'ws-1'
    })
    expect(runtime.planeGetWorkItem).toHaveBeenCalledWith({
      workItemId: 'wi-3',
      projectId: undefined,
      workspaceId: 'ws-1'
    })
    expect(runtime.planeUpdateWorkItem).toHaveBeenCalledWith({
      projectId: 'proj-1',
      workItemId: 'wi-3',
      workspaceId: 'ws-1',
      updates: { title: 'Fixed title', stateId: 'state-1', labelIds: ['bug'] }
    })
    expect(runtime.planeAddWorkItemComment).toHaveBeenCalledWith({
      projectId: 'proj-1',
      workItemId: 'wi-3',
      body: 'Looks good',
      workspaceId: 'ws-1'
    })
    expect(runtime.planeListWorkItemComments).toHaveBeenCalledWith({
      projectId: 'proj-1',
      workItemId: 'wi-3',
      workspaceId: 'ws-1'
    })
  })

  it('rejects an empty Plane search query', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeSearchWorkItems: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(makeRequest('plane.searchWorkItems', { query: '' }))

    expect(response.ok).toBe(false)
    expect(runtime.planeSearchWorkItems).not.toHaveBeenCalled()
  })

  it('routes Plane metadata requests to the runtime server', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeListProjects: vi.fn().mockResolvedValue([{ id: 'proj-1' }]),
      planeListStates: vi.fn().mockResolvedValue([{ id: 'state-1' }]),
      planeListLabels: vi.fn().mockResolvedValue([{ id: 'label-1' }]),
      planeListMembers: vi.fn().mockResolvedValue([{ id: 'user-1' }])
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(makeRequest('plane.listProjects', { workspaceId: 'ws-1' }))
    await dispatcher.dispatch(
      makeRequest('plane.listStates', { projectId: 'proj-1', workspaceId: 'ws-1' })
    )
    await dispatcher.dispatch(
      makeRequest('plane.listLabels', { projectId: 'proj-1', workspaceId: 'ws-1' })
    )
    await dispatcher.dispatch(makeRequest('plane.listMembers', { workspaceId: 'ws-1' }))

    expect(runtime.planeListProjects).toHaveBeenCalledWith('ws-1')
    expect(runtime.planeListStates).toHaveBeenCalledWith('proj-1', 'ws-1')
    expect(runtime.planeListLabels).toHaveBeenCalledWith('proj-1', 'ws-1')
    expect(runtime.planeListMembers).toHaveBeenCalledWith('ws-1', undefined)
  })
})
