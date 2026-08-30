import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { PLANE_METHODS } from './plane'

function request(method: string, params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'token', method, params }
}

describe('Plane intake RPC methods', () => {
  it('routes list and create with normalized required strings', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeListIntakeIssues: vi.fn().mockResolvedValue([]),
      planeCreateIntakeIssue: vi.fn().mockResolvedValue({
        ok: true,
        intakeIssue: { id: 'intake-1' }
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      request('plane.listIntakeIssues', { projectId: ' project-1 ', workspaceId: 'workspace-1' })
    )
    await dispatcher.dispatch(
      request('plane.createIntakeIssue', {
        projectId: ' project-1 ',
        title: ' Customer cannot sign in ',
        workspaceId: 'workspace-1',
        description: 'Report body',
        priority: 'high'
      })
    )

    expect(runtime.planeListIntakeIssues).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1'
    })
    expect(runtime.planeCreateIntakeIssue).toHaveBeenCalledWith({
      projectId: 'project-1',
      title: 'Customer cannot sign in',
      workspaceId: 'workspace-1',
      description: 'Report body',
      priority: 'high'
    })
  })

  it('rejects unsupported create fields before reaching runtime', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeCreateIntakeIssue: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      request('plane.createIntakeIssue', {
        projectId: 'project-1',
        title: 'Unexpected field',
        priority: 'critical'
      })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeCreateIntakeIssue).not.toHaveBeenCalled()
  })
})
