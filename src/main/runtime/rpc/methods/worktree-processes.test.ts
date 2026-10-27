import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { WORKTREE_METHODS } from './worktree'

const RESULT = { supported: true, root: '/w', processes: [], stopped: [], protected: [] }

async function dispatch(params: Record<string, unknown>) {
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    listManagedWorktreeProcesses: vi.fn().mockResolvedValue(RESULT)
  } as unknown as OrcaRuntimeService
  const request: RpcRequest = {
    id: 'req-1',
    authToken: 'tok',
    method: 'worktree.processes',
    params
  }
  const response = await new RpcDispatcher({ runtime, methods: WORKTREE_METHODS }).dispatch(request)
  return { runtime, response }
}

describe('worktree.processes (ORCA-678)', () => {
  it('lists without stopping unless stop is set', async () => {
    const { runtime, response } = await dispatch({ worktree: 'path:/w' })
    expect(runtime.listManagedWorktreeProcesses).toHaveBeenCalledWith('path:/w', { stop: false })
    expect(response).toMatchObject({ ok: true, result: RESULT })
  })

  it('passes stop and the caller pid through', async () => {
    const { runtime } = await dispatch({ worktree: 'path:/w', stop: true, callerPid: 4242 })
    expect(runtime.listManagedWorktreeProcesses).toHaveBeenCalledWith('path:/w', {
      stop: true,
      callerPid: 4242
    })
  })

  it('rejects a missing worktree selector', async () => {
    const { runtime, response } = await dispatch({})
    expect(runtime.listManagedWorktreeProcesses).not.toHaveBeenCalled()
    expect(response).toMatchObject({ ok: false })
  })
})
