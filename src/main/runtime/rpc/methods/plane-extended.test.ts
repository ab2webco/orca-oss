import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PLANE_METHODS } from './plane'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('extended Plane RPC methods', () => {
  it('routes delete and relation/link/label methods to the runtime, trimming input', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeDeleteWorkItem: vi.fn().mockResolvedValue({ ok: true }),
      planeAddWorkItemRelation: vi.fn().mockResolvedValue({ ok: true }),
      planeListWorkItemRelations: vi.fn().mockResolvedValue([]),
      planeAddWorkItemLink: vi.fn().mockResolvedValue({ ok: true, link: { id: 'l1', url: 'u' } }),
      planeDeleteWorkItemLink: vi.fn().mockResolvedValue({ ok: true }),
      planeListWorkItemLinks: vi.fn().mockResolvedValue([]),
      planeCreateLabel: vi.fn().mockResolvedValue({ ok: true, label: { id: 'lab1', name: 'Bug' } })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      makeRequest('plane.deleteWorkItem', { projectId: '  p1  ', workItemId: '  wi1  ' })
    )
    await dispatcher.dispatch(
      makeRequest('plane.addWorkItemRelation', {
        projectId: 'p1',
        workItemId: '  wi1  ',
        relationType: 'blocking',
        relatedWorkItemId: '  wi2  ',
        workspaceId: 'ws1'
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.listWorkItemRelations', { projectId: 'p1', workItemId: 'wi1' })
    )
    await dispatcher.dispatch(
      makeRequest('plane.addWorkItemLink', {
        projectId: 'p1',
        workItemId: 'wi1',
        url: '  https://x.dev  ',
        title: 'Docs'
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.deleteWorkItemLink', {
        projectId: 'p1',
        workItemId: 'wi1',
        linkId: '  link1  '
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.listWorkItemLinks', { projectId: 'p1', workItemId: 'wi1' })
    )
    await dispatcher.dispatch(
      makeRequest('plane.createLabel', { projectId: 'p1', name: '  Bug  ', color: '#ef4444' })
    )

    expect(runtime.planeDeleteWorkItem).toHaveBeenCalledWith({
      projectId: 'p1',
      workItemId: 'wi1',
      workspaceId: undefined
    })
    expect(runtime.planeAddWorkItemRelation).toHaveBeenCalledWith({
      projectId: 'p1',
      workItemId: 'wi1',
      relationType: 'blocking',
      relatedWorkItemId: 'wi2',
      workspaceId: 'ws1'
    })
    expect(runtime.planeListWorkItemRelations).toHaveBeenCalledWith({
      projectId: 'p1',
      workItemId: 'wi1',
      workspaceId: undefined
    })
    expect(runtime.planeAddWorkItemLink).toHaveBeenCalledWith({
      projectId: 'p1',
      workItemId: 'wi1',
      url: 'https://x.dev',
      title: 'Docs',
      workspaceId: undefined
    })
    expect(runtime.planeDeleteWorkItemLink).toHaveBeenCalledWith({
      projectId: 'p1',
      workItemId: 'wi1',
      linkId: 'link1',
      workspaceId: undefined
    })
    expect(runtime.planeListWorkItemLinks).toHaveBeenCalledWith({
      projectId: 'p1',
      workItemId: 'wi1',
      workspaceId: undefined
    })
    expect(runtime.planeCreateLabel).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'Bug',
      color: '#ef4444',
      workspaceId: undefined
    })
  })

  it('rejects an unknown relation_type', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeAddWorkItemRelation: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('plane.addWorkItemRelation', {
        projectId: 'p1',
        workItemId: 'wi1',
        relationType: 'bogus',
        relatedWorkItemId: 'wi2'
      })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeAddWorkItemRelation).not.toHaveBeenCalled()
  })
})
