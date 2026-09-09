import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { renamePlaneColumn } from './plane-column-edit'
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

const RENAMED = { ok: true, state: { id: 's1', name: 'Backlog!', group: 'unstarted', sequence: 1 } }

const RENAME = { projectId: 'p1', workspaceId: 'w1', stateId: 's1', name: '  Backlog!  ' }

describe('plane column rename', () => {
  it('sends the trimmed name as plane.updateState', async () => {
    const calls: Call[] = []
    expect(await renamePlaneColumn(stubClient(RENAMED, calls), RENAME)).toEqual({
      ok: true,
      state: { id: 's1', name: 'Backlog!', group: 'unstarted', sequence: 1 }
    })
    // The discriminating assertion: what reached the wire.
    expect(calls).toEqual([
      {
        method: 'plane.updateState',
        params: { projectId: 'p1', workspaceId: 'w1', stateId: 's1', name: 'Backlog!' },
        options: { timeoutMs: 15_000, budgetSpansConnect: true }
      }
    ])
  })

  it('refuses a blank name without calling the host', async () => {
    const calls: Call[] = []
    expect(await renamePlaneColumn(stubClient(RENAMED, calls), { ...RENAME, name: '   ' })).toEqual(
      { ok: false, error: 'Give the column a name' }
    )
    expect(calls).toEqual([])
  })

  it('does not send a request without a project or a column', async () => {
    const calls: Call[] = []
    const client = stubClient(RENAMED, calls)
    expect(await renamePlaneColumn(client, { ...RENAME, projectId: '' })).toMatchObject({
      ok: false
    })
    expect(await renamePlaneColumn(client, { ...RENAME, stateId: '' })).toMatchObject({
      ok: false
    })
    expect(calls).toEqual([])
  })

  it('omits a workspace the board does not carry', async () => {
    const calls: Call[] = []
    await renamePlaneColumn(stubClient(RENAMED, calls), { ...RENAME, workspaceId: null })
    expect(calls[0]?.params).toMatchObject({ workspaceId: undefined })
  })

  it('reports a rejected transport instead of throwing past the drawer', async () => {
    await expect(
      renamePlaneColumn(rejectingClient(new Error('Connection interrupted')), RENAME)
    ).resolves.toEqual({ ok: false, error: 'Connection interrupted' })
  })

  it('flags a timed-out rename: Plane may hold the new name', async () => {
    const timedOut = markRpcDeliveryUnknown(new Error('Request timed out: plane.updateState'))
    await expect(renamePlaneColumn(rejectingClient(timedOut), RENAME)).resolves.toEqual({
      ok: false,
      error: PLANE_WRITE_UNANSWERED_MESSAGE,
      deliveryUnknown: true
    })
  })

  it('reports a refused rename instead of reading as success', async () => {
    const calls: Call[] = []
    expect(
      await renamePlaneColumn(stubClient({ ok: false, error: 'name already taken' }, calls), RENAME)
    ).toEqual({ ok: false, error: 'name already taken' })
    expect(await renamePlaneColumn(stubClient({ ok: false }, calls), RENAME)).toEqual({
      ok: false,
      error: 'Plane refused the column change'
    })
  })

  it('reports a transport failure with the host message', async () => {
    const calls: Call[] = []
    expect(await renamePlaneColumn(refusingClient('method not allowed', calls), RENAME)).toEqual({
      ok: false,
      error: 'method not allowed'
    })
  })

  it('refuses a response shape it cannot prove', async () => {
    const calls: Call[] = []
    expect(await renamePlaneColumn(stubClient('renamed', calls), RENAME)).toEqual({
      ok: false,
      error: 'Unexpected Plane column response'
    })
    expect(await renamePlaneColumn(stubClient({ ok: true }, calls), RENAME)).toEqual({
      ok: false,
      error: 'Unexpected Plane column response'
    })
    expect(
      await renamePlaneColumn(stubClient({ ok: true, state: { id: 's1' } }, calls), RENAME)
    ).toEqual({ ok: false, error: 'Unexpected Plane column response' })
  })
})
