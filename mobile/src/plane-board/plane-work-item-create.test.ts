import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { createPlaneWorkItem } from './plane-work-item-create'
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

const CREATED = { ok: true, id: 'wi-9', identifier: 'ORCA-9', url: 'https://plane.example/ORCA-9' }

const REQUEST = {
  projectId: 'p1',
  workspaceId: 'w1',
  name: '  Ship the create drawer  ',
  stateId: 's2'
}

describe('plane work item create', () => {
  it('sends the trimmed title and the column as plane.createWorkItem', async () => {
    const calls: Call[] = []
    expect(await createPlaneWorkItem(stubClient(CREATED, calls), REQUEST)).toEqual({
      ok: true,
      id: 'wi-9',
      identifier: 'ORCA-9'
    })
    // The discriminating assertion: what reached the wire.
    expect(calls).toEqual([
      {
        method: 'plane.createWorkItem',
        params: {
          projectId: 'p1',
          workspaceId: 'w1',
          title: 'Ship the create drawer',
          stateId: 's2'
        },
        // A write with no ceiling pins the sheet on "Creating…" for good.
        options: { timeoutMs: 15_000, budgetSpansConnect: true }
      }
    ])
  })

  it('reports a rejected transport instead of throwing past the sheet', async () => {
    await expect(
      createPlaneWorkItem(rejectingClient(new Error('Connection interrupted')), REQUEST)
    ).resolves.toEqual({ ok: false, error: 'Connection interrupted' })
  })

  it('flags a timed-out create: Plane may hold the card', async () => {
    const timedOut = markRpcDeliveryUnknown(new Error('Request timed out: plane.createWorkItem'))
    await expect(createPlaneWorkItem(rejectingClient(timedOut), REQUEST)).resolves.toEqual({
      ok: false,
      error: PLANE_WRITE_UNANSWERED_MESSAGE,
      deliveryUnknown: true
    })
  })

  it('omits a workspace the board does not carry', async () => {
    const calls: Call[] = []
    await createPlaneWorkItem(stubClient(CREATED, calls), { ...REQUEST, workspaceId: null })
    expect(calls[0]?.params).toMatchObject({ workspaceId: undefined })
  })

  it('reports a refused create instead of reading as success', async () => {
    const calls: Call[] = []
    expect(
      await createPlaneWorkItem(
        stubClient({ ok: false, error: 'state belongs to another project' }, calls),
        REQUEST
      )
    ).toEqual({ ok: false, error: 'state belongs to another project' })
  })

  it('reports a transport failure with the host message', async () => {
    const calls: Call[] = []
    expect(await createPlaneWorkItem(refusingClient('method not allowed', calls), REQUEST)).toEqual(
      { ok: false, error: 'method not allowed' }
    )
  })

  it('does not send a request without a project, a column or a title', async () => {
    const calls: Call[] = []
    const client = stubClient(CREATED, calls)
    expect(await createPlaneWorkItem(client, { ...REQUEST, projectId: '' })).toMatchObject({
      ok: false
    })
    expect(await createPlaneWorkItem(client, { ...REQUEST, stateId: '' })).toMatchObject({
      ok: false
    })
    expect(await createPlaneWorkItem(client, { ...REQUEST, name: '   ' })).toMatchObject({
      ok: false
    })
    expect(calls).toEqual([])
  })

  it('refuses a response shape it cannot prove', async () => {
    const calls: Call[] = []
    expect(await createPlaneWorkItem(stubClient('created', calls), REQUEST)).toEqual({
      ok: false,
      error: 'Unexpected Plane create response'
    })
    expect(await createPlaneWorkItem(stubClient({ ok: true }, calls), REQUEST)).toEqual({
      ok: false,
      error: 'Unexpected Plane create response'
    })
  })
})
