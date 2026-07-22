import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { WORKTREE_METHODS } from './worktree'

// Why its own file: worktree.test.ts sits at the max-lines budget; the
// account-pin RPC forwarding contract is self-contained anyway.

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('worktree RPC account pins', () => {
  it('forwards account pins and validated metadata batches', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      updateManagedWorktreeMeta: vi.fn().mockResolvedValue({ id: 'wt-1' }),
      updateManagedWorktreesMeta: vi.fn().mockResolvedValue({ updated: 2 })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    await dispatcher.dispatch(
      makeRequest('worktree.set', { worktree: 'id:wt-1', claudeAccountId: null })
    )
    const response = await dispatcher.dispatch(
      makeRequest('worktree.setBatch', {
        updates: [
          { worktree: 'id:wt-1', claudeAccountId: 'account-a' },
          { worktree: 'id:wt-2', claudeAccountId: null }
        ]
      })
    )

    expect(runtime.updateManagedWorktreeMeta).toHaveBeenCalledWith(
      'id:wt-1',
      expect.objectContaining({ claudeAccountId: null })
    )
    expect(runtime.updateManagedWorktreesMeta).toHaveBeenCalledWith([
      { worktreeSelector: 'id:wt-1', updates: { claudeAccountId: 'account-a' } },
      { worktreeSelector: 'id:wt-2', updates: { claudeAccountId: null } }
    ])
    expect(response).toMatchObject({ ok: true, result: { updated: 2 } })
  })
})
