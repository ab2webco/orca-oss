import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { addPlaneWorkItemComment } from './plane-work-item-comment'
import { PLANE_WRITE_UNANSWERED_MESSAGE } from './plane-write-failure'

type Call = { method: string; params?: unknown; options?: unknown }

function rejectingClient(error: Error): RpcClient {
  return {
    sendRequest: vi.fn(async () => {
      throw error
    })
  } as unknown as RpcClient
}

function stubClient(result: unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown, options?: unknown) => {
      calls.push({ method, params, options })
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
  workspaceId: 'w1',
  body: 'Looks good'
}

describe('plane work item comment', () => {
  it('sends the trimmed body on plane.addWorkItemComment and returns the comment id', async () => {
    const calls: Call[] = []
    expect(
      await addPlaneWorkItemComment(stubClient({ ok: true, id: 'c-1' }, calls), {
        ...REQUEST,
        body: '  Looks good \n'
      })
    ).toEqual({ ok: true, id: 'c-1' })
    // The discriminating assertion: what reached the wire, not what the UI shows.
    expect(calls).toEqual([
      {
        method: 'plane.addWorkItemComment',
        params: { projectId: 'p1', workItemId: 'wi-1', body: 'Looks good', workspaceId: 'w1' },
        options: { timeoutMs: 15_000, budgetSpansConnect: true }
      }
    ])
  })

  it('reports a rejected transport instead of throwing past the composer', async () => {
    await expect(
      addPlaneWorkItemComment(rejectingClient(new Error('Connection interrupted')), REQUEST)
    ).resolves.toEqual({ ok: false, error: 'Connection interrupted' })
  })

  it('flags a timed-out comment: Plane may have taken it', async () => {
    const timedOut = markRpcDeliveryUnknown(
      new Error('Request timed out: plane.addWorkItemComment')
    )
    await expect(addPlaneWorkItemComment(rejectingClient(timedOut), REQUEST)).resolves.toEqual({
      ok: false,
      error: PLANE_WRITE_UNANSWERED_MESSAGE,
      deliveryUnknown: true
    })
  })

  it('omits a workspace the card does not carry', async () => {
    const calls: Call[] = []
    await addPlaneWorkItemComment(stubClient({ ok: true, id: 'c-1' }, calls), {
      ...REQUEST,
      workspaceId: null
    })
    expect(calls[0]?.params).toMatchObject({ workspaceId: undefined })
  })

  it('reports a refused comment instead of reading as success', async () => {
    expect(
      await addPlaneWorkItemComment(stubClient({ ok: false, error: 'not a member' }, []), REQUEST)
    ).toEqual({ ok: false, error: 'not a member' })
    expect(await addPlaneWorkItemComment(stubClient({ ok: false }, []), REQUEST)).toEqual({
      ok: false,
      error: 'Plane refused the comment'
    })
  })

  it('reports a transport failure with the host message', async () => {
    expect(
      await addPlaneWorkItemComment(refusingClient('method not allowed', []), REQUEST)
    ).toEqual({ ok: false, error: 'method not allowed' })
  })

  it('does not send a request when the body is blank or the card lacks a project', async () => {
    const calls: Call[] = []
    const client = stubClient({ ok: true, id: 'c-1' }, calls)
    expect(await addPlaneWorkItemComment(client, { ...REQUEST, body: '   ' })).toEqual({
      ok: false,
      error: 'Write a comment'
    })
    expect(await addPlaneWorkItemComment(client, { ...REQUEST, projectId: '' })).toMatchObject({
      ok: false
    })
    expect(await addPlaneWorkItemComment(client, { ...REQUEST, workItemId: '' })).toMatchObject({
      ok: false
    })
    expect(calls).toEqual([])
  })

  it('refuses a response shape it cannot prove', async () => {
    expect(await addPlaneWorkItemComment(stubClient('commented', []), REQUEST)).toEqual({
      ok: false,
      error: 'Unexpected Plane comment response'
    })
    // ok without an id: the host contract carries one, so its absence is a shape it cannot trust.
    expect(await addPlaneWorkItemComment(stubClient({ ok: true }, []), REQUEST)).toEqual({
      ok: false,
      error: 'Unexpected Plane comment response'
    })
  })
})
