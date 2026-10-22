import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { GameMemberWorktreeHold } from '../../game-member-worktree-guard'
import { WORKTREE_METHODS } from './worktree'

const HOLD: GameMemberWorktreeHold = {
  ticket: 'ORCA-2',
  name: 'Merlin · ORCA-2',
  lastState: 'working',
  unpushed: ['abc1234 feat: queue setups']
}

function makeRuntime(hold: GameMemberWorktreeHold | null): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'test-runtime',
    gameMemberWorktreeHold: vi.fn().mockResolvedValue(hold),
    removeManagedWorktree: vi.fn().mockResolvedValue({})
  } as unknown as OrcaRuntimeService
}

const remove = (runtime: OrcaRuntimeService, params: Record<string, unknown> = {}) =>
  new RpcDispatcher({ runtime, methods: WORKTREE_METHODS }).dispatch({
    id: 'req-1',
    authToken: 'tok',
    method: 'worktree.rm',
    params: { worktree: 'id:wt-2', force: true, ...params }
  } satisfies RpcRequest)

// Why (ORCA-746): after a crash the lead removed paused members' worktrees and lost their work.
describe('worktree.rm on a game member worktree', () => {
  it('refuses, even with --force, naming the member and its unpushed commits', async () => {
    const runtime = makeRuntime(HOLD)

    const response = await remove(runtime)

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'game_member_worktree',
        message: expect.stringContaining('Unpushed commits (1): abc1234 feat: queue setups.')
      }
    })
    expect(runtime.removeManagedWorktree).not.toHaveBeenCalled()
  })

  it('removes it when the caller insists, and says what was removed', async () => {
    const runtime = makeRuntime(HOLD)

    const response = await remove(runtime, { allowGameMember: true })

    expect(runtime.removeManagedWorktree).toHaveBeenCalledOnce()
    expect(response).toMatchObject({
      ok: true,
      result: {
        removed: true,
        warning:
          'Removed the worktree of game member ORCA-2 (Merlin · ORCA-2, last working). Unpushed commits (1): abc1234 feat: queue setups.'
      }
    })
  })

  it('removes any other worktree as before', async () => {
    const runtime = makeRuntime(null)

    expect(await remove(runtime)).toMatchObject({ ok: true, result: { removed: true } })
    expect(runtime.removeManagedWorktree).toHaveBeenCalledWith('id:wt-2', true, false, false)
  })
})
