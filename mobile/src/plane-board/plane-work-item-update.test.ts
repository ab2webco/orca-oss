import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { updatePlaneWorkItem } from './plane-work-item-update'
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
  patch: { priority: 'high' as const }
}

describe('plane work item update', () => {
  it('sends the priority as updates.priority on plane.updateWorkItem', async () => {
    const calls: Call[] = []
    expect(await updatePlaneWorkItem(stubClient({ ok: true }, calls), REQUEST)).toEqual({
      ok: true
    })
    // The discriminating assertion: what reached the wire, not what the UI shows.
    expect(calls).toEqual([
      {
        method: 'plane.updateWorkItem',
        params: {
          projectId: 'p1',
          workItemId: 'wi-1',
          workspaceId: 'w1',
          updates: { priority: 'high' }
        },
        options: { timeoutMs: 15_000, budgetSpansConnect: true }
      }
    ])
  })

  it('sends the whole assignee list as updates.assigneeIds', async () => {
    const calls: Call[] = []
    await updatePlaneWorkItem(stubClient({ ok: true }, calls), {
      ...REQUEST,
      patch: { assigneeIds: ['u-1', 'u-2'] }
    })
    expect(calls[0]?.params).toMatchObject({ updates: { assigneeIds: ['u-1', 'u-2'] } })
  })

  it('reports a rejected transport instead of throwing past the rollback', async () => {
    await expect(
      updatePlaneWorkItem(rejectingClient(new Error('Connection interrupted')), REQUEST)
    ).resolves.toEqual({ ok: false, error: 'Connection interrupted' })
  })

  it('flags a timed-out update: Plane may have taken it', async () => {
    const timedOut = markRpcDeliveryUnknown(new Error('Request timed out: plane.updateWorkItem'))
    await expect(updatePlaneWorkItem(rejectingClient(timedOut), REQUEST)).resolves.toEqual({
      ok: false,
      error: PLANE_WRITE_UNANSWERED_MESSAGE,
      deliveryUnknown: true
    })
  })

  it('omits a workspace the card does not carry', async () => {
    const calls: Call[] = []
    await updatePlaneWorkItem(stubClient({ ok: true }, calls), { ...REQUEST, workspaceId: null })
    expect(calls[0]?.params).toMatchObject({ workspaceId: undefined })
  })

  it('reports a refused update instead of reading as success', async () => {
    const calls: Call[] = []
    expect(
      await updatePlaneWorkItem(stubClient({ ok: false, error: 'not a member' }, calls), REQUEST)
    ).toEqual({ ok: false, error: 'not a member' })
  })

  it('reports a transport failure with the host message', async () => {
    const calls: Call[] = []
    expect(await updatePlaneWorkItem(refusingClient('method not allowed', calls), REQUEST)).toEqual(
      { ok: false, error: 'method not allowed' }
    )
  })

  it('does not send a request when the card lacks a project or the patch is empty', async () => {
    const calls: Call[] = []
    const client = stubClient({ ok: true }, calls)
    expect(await updatePlaneWorkItem(client, { ...REQUEST, projectId: '' })).toMatchObject({
      ok: false
    })
    expect(await updatePlaneWorkItem(client, { ...REQUEST, patch: {} })).toMatchObject({
      ok: false
    })
    expect(calls).toEqual([])
  })

  it('refuses a response shape it cannot prove', async () => {
    expect(await updatePlaneWorkItem(stubClient('updated', []), REQUEST)).toEqual({
      ok: false,
      error: 'Unexpected Plane update response'
    })
  })
})
