import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PLANE_METHODS } from './plane'

function request(method: string, params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function runtimeStub(): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'test-runtime',
    planeCreateProject: vi.fn().mockResolvedValue({ ok: true, project: { id: 'p1' } }),
    planeUpdateProject: vi.fn().mockResolvedValue({ ok: true, project: { id: 'p1' } }),
    planeSetProjectArchived: vi.fn().mockResolvedValue({ ok: true })
  } as unknown as OrcaRuntimeService
}

describe('Plane project RPC methods', () => {
  it('routes create with trimmed name and identifier', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      request('plane.createProject', {
        name: '  My Project  ',
        identifier: ' MP ',
        description: 'Ships the thing',
        workspace: 'acme'
      })
    )

    expect(response.ok).toBe(true)
    expect(runtime.planeCreateProject).toHaveBeenCalledWith({
      name: 'My Project',
      identifier: 'MP',
      description: 'Ships the thing',
      workspace: 'acme'
    })
  })

  it('rejects create without an identifier', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      request('plane.createProject', { name: 'My Project' })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeCreateProject).not.toHaveBeenCalled()
  })

  // An empty --description must survive validation so update can clear the field;
  // OptionalString would silently drop it.
  it('routes update with an emptied description intact', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      request('plane.updateProject', { projectId: ' p1 ', name: ' Renamed ', description: '' })
    )

    expect(runtime.planeUpdateProject).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'Renamed',
      identifier: undefined,
      description: '',
      workspace: undefined
    })
  })

  it('routes archive and unarchive through the same method', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      request('plane.setProjectArchived', { projectId: 'p1', archived: true })
    )
    await dispatcher.dispatch(
      request('plane.setProjectArchived', { projectId: 'p1', archived: false })
    )

    expect(runtime.planeSetProjectArchived).toHaveBeenNthCalledWith(1, {
      projectId: 'p1',
      archived: true,
      workspace: undefined
    })
    expect(runtime.planeSetProjectArchived).toHaveBeenNthCalledWith(2, {
      projectId: 'p1',
      archived: false,
      workspace: undefined
    })
  })

  it('rejects archive without an explicit boolean', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      request('plane.setProjectArchived', { projectId: 'p1' })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeSetProjectArchived).not.toHaveBeenCalled()
  })
})
