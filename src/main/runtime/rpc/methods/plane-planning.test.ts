import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PLANE_METHODS } from './plane'

function request(method: string, params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('Plane planning RPC methods', () => {
  it('routes list and add operations with trimmed identifiers', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeListPlanningContainers: vi.fn().mockResolvedValue([]),
      planeListPlanningWorkItems: vi.fn().mockResolvedValue([]),
      planeAddPlanningWorkItems: vi.fn().mockResolvedValue({ ok: true })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      request('plane.listPlanningContainers', {
        kind: 'cycle',
        projectId: ' project-1 ',
        workspaceId: 'acme'
      })
    )
    await dispatcher.dispatch(
      request('plane.listPlanningWorkItems', {
        kind: 'module',
        projectId: 'project-1',
        containerId: ' module-1 '
      })
    )
    await dispatcher.dispatch(
      request('plane.addPlanningWorkItems', {
        kind: 'cycle',
        projectId: 'project-1',
        containerId: 'cycle-1',
        workItemIds: [' item-1 ', 'item-2']
      })
    )

    expect(runtime.planeListPlanningContainers).toHaveBeenCalledWith({
      kind: 'cycle',
      projectId: 'project-1',
      workspaceId: 'acme'
    })
    expect(runtime.planeListPlanningWorkItems).toHaveBeenCalledWith({
      kind: 'module',
      projectId: 'project-1',
      containerId: 'module-1',
      workspaceId: undefined
    })
    expect(runtime.planeAddPlanningWorkItems).toHaveBeenCalledWith({
      kind: 'cycle',
      projectId: 'project-1',
      containerId: 'cycle-1',
      workItemIds: ['item-1', 'item-2'],
      workspaceId: undefined
    })
  })

  it('rejects add-items with an empty work item list', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeAddPlanningWorkItems: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      request('plane.addPlanningWorkItems', {
        kind: 'cycle',
        projectId: 'project-1',
        containerId: 'cycle-1',
        workItemIds: []
      })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeAddPlanningWorkItems).not.toHaveBeenCalled()
  })
})
