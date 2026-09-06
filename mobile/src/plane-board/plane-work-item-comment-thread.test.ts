import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { readPlaneCommentThread } from './plane-work-item-comment-thread'

function client(reply: (method: string, params?: unknown) => unknown): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => reply(method, params))
  } as unknown as RpcClient
}

const SCOPE = { projectId: 'proj-1', workItemId: 'wi-1', workspaceId: 'ws-1' }

describe('readPlaneCommentThread', () => {
  it('sends the allowlisted method with the card scope', async () => {
    const calls: { method: string; params?: unknown }[] = []
    const rpc = client((method, params) => {
      calls.push({ method, params })
      return { id: '1', ok: true, result: { ok: true, comments: [] } }
    })

    await readPlaneCommentThread(rpc, SCOPE)

    expect(calls).toEqual([
      {
        method: 'plane.readWorkItemCommentThread',
        params: { projectId: 'proj-1', workItemId: 'wi-1', workspaceId: 'ws-1' }
      }
    ])
  })

  it('reads a thread, keeping a comment whose author the host could not resolve', async () => {
    const rpc = client(() => ({
      id: '1',
      ok: true,
      result: {
        ok: true,
        comments: [
          { id: 'c-1', body: 'Shipped', createdAt: '2026-01-01T00:00:00Z', user: null },
          {
            id: 'c-2',
            body: 'Thanks',
            createdAt: '2026-01-02T00:00:00Z',
            user: { id: 'u-1', displayName: 'Ada' }
          }
        ]
      }
    }))

    const read = await readPlaneCommentThread(rpc, SCOPE)

    expect(read.ok).toBe(true)
    expect(read.ok && read.comments.map((comment) => comment.id)).toEqual(['c-1', 'c-2'])
  })

  it('keeps an empty thread distinct from a host that reported a failed read', async () => {
    const empty = await readPlaneCommentThread(
      client(() => ({ id: '1', ok: true, result: { ok: true, comments: [] } })),
      SCOPE
    )
    const failed = await readPlaneCommentThread(
      client(() => ({ id: '1', ok: true, result: { ok: false, error: 'Unauthorized' } })),
      SCOPE
    )

    expect(empty).toEqual({ ok: true, comments: [] })
    expect(failed).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('reports a refused or rejected request as a failed read, never as an empty thread', async () => {
    const refused = await readPlaneCommentThread(
      client(() => ({
        id: '1',
        ok: false,
        error: { code: -32601, message: 'Method not allowed' }
      })),
      SCOPE
    )
    const rejected = await readPlaneCommentThread(
      client(() => {
        throw new Error('Socket closed')
      }),
      SCOPE
    )

    expect(refused).toEqual({ ok: false, error: 'Method not allowed' })
    expect(rejected).toEqual({ ok: false, error: 'Socket closed' })
  })

  it('reports an unreadable payload as a failed read, never as an empty thread', async () => {
    const shapeless = await readPlaneCommentThread(
      client(() => ({ id: '1', ok: true, result: { comments: 'not a thread' } })),
      SCOPE
    )
    const undecodable = await readPlaneCommentThread(
      client(() => ({ id: '1', ok: true, result: { ok: true, comments: [{ body: 'no id' }] } })),
      SCOPE
    )

    expect(shapeless).toEqual({ ok: false, error: 'Could not read the comments' })
    expect(undecodable).toEqual({ ok: false, error: 'Could not read the comments' })
  })
})
