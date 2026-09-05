import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { movePlaneWorkItem } from './plane-work-item-move'

type Call = { method: string; params?: unknown }

function stubClient(result: unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
}

function refusingClient(message: string, calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      return {
        id: '1',
        ok: false as const,
        error: { code: 'internal', message },
        _meta: { runtimeId: 'r' }
      }
    })
  } as unknown as RpcClient
}

const REQUEST = {
  projectId: 'p1',
  workItemId: 'wi-1',
  stateId: 's2',
  workspaceId: 'w1'
}

describe('plane work item move', () => {
  it('sends the state change as updates.stateId on plane.updateWorkItem', async () => {
    const calls: Call[] = []
    expect(await movePlaneWorkItem(stubClient({ ok: true }, calls), REQUEST)).toEqual({ ok: true })
    // The discriminating assertion: what reached the wire, not what the UI shows.
    expect(calls).toEqual([
      {
        method: 'plane.updateWorkItem',
        params: {
          projectId: 'p1',
          workItemId: 'wi-1',
          workspaceId: 'w1',
          updates: { stateId: 's2' }
        }
      }
    ])
  })

  it('omits a workspace the card does not carry', async () => {
    const calls: Call[] = []
    await movePlaneWorkItem(stubClient({ ok: true }, calls), { ...REQUEST, workspaceId: null })
    expect(calls[0]?.params).toMatchObject({ workspaceId: undefined })
  })

  it('reports a refused move instead of reading as success', async () => {
    const calls: Call[] = []
    expect(
      await movePlaneWorkItem(stubClient({ ok: false, error: 'state is archived' }, calls), REQUEST)
    ).toEqual({
      ok: false,
      error: 'state is archived'
    })
  })

  it('reports a transport failure with the host message', async () => {
    const calls: Call[] = []
    expect(await movePlaneWorkItem(refusingClient('method not allowed', calls), REQUEST)).toEqual({
      ok: false,
      error: 'method not allowed'
    })
  })

  it('does not send a request when the card lacks a project or state', async () => {
    const calls: Call[] = []
    const client = stubClient({ ok: true }, calls)
    expect(await movePlaneWorkItem(client, { ...REQUEST, projectId: '' })).toMatchObject({
      ok: false
    })
    expect(await movePlaneWorkItem(client, { ...REQUEST, stateId: '' })).toMatchObject({
      ok: false
    })
    expect(calls).toEqual([])
  })

  it('refuses a response shape it cannot prove', async () => {
    const calls: Call[] = []
    expect(await movePlaneWorkItem(stubClient('moved', calls), REQUEST)).toEqual({
      ok: false,
      error: 'Unexpected Plane move response'
    })
  })
})
