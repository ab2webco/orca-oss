import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { fetchPlaneMembers } from './plane-members'

type Call = { method: string; params?: unknown }

function stubClient(result: unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
}

describe('plane members', () => {
  it('asks the host for the project members', async () => {
    const calls: Call[] = []
    const members = await fetchPlaneMembers(
      stubClient(
        [
          { id: 'u-1', displayName: 'Ada', email: 'ada@example.com' },
          { id: 'u-2', displayName: 'Grace' }
        ],
        calls
      ),
      { projectId: 'proj-1', workspaceId: 'ws-1' }
    )
    expect(calls).toEqual([
      { method: 'plane.listMembers', params: { projectId: 'proj-1', workspaceId: 'ws-1' } }
    ])
    expect(members).toEqual([
      { id: 'u-1', displayName: 'Ada' },
      { id: 'u-2', displayName: 'Grace' }
    ])
  })

  it('drops a member row without an id and keeps the rest', async () => {
    const members = await fetchPlaneMembers(
      stubClient([{ displayName: 'Ghost' }, { id: 'u-2', displayName: 'Grace' }], []),
      { projectId: 'proj-1', workspaceId: null }
    )
    expect(members).toEqual([{ id: 'u-2', displayName: 'Grace' }])
  })

  it('omits a workspace the board does not carry', async () => {
    const calls: Call[] = []
    await fetchPlaneMembers(stubClient([], calls), { projectId: 'proj-1', workspaceId: null })
    expect(calls[0]?.params).toEqual({ projectId: 'proj-1', workspaceId: undefined })
  })

  it('surfaces the host refusal instead of an empty list', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        id: '1',
        ok: false as const,
        error: { code: 'forbidden', message: "Method 'plane.listMembers' is not available" },
        _meta: { runtimeId: 'r' }
      }))
    } as unknown as RpcClient
    await expect(
      fetchPlaneMembers(client, { projectId: 'proj-1', workspaceId: 'ws-1' })
    ).rejects.toThrow("Method 'plane.listMembers' is not available")
  })

  it('refuses a response shape it cannot prove', async () => {
    await expect(
      fetchPlaneMembers(stubClient('members', []), { projectId: 'proj-1', workspaceId: 'ws-1' })
    ).rejects.toThrow('Unexpected Plane members response')
  })
})
