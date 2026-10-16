import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_METHODS } from './orchestrator-game'

function request(params?: unknown): RpcRequest {
  return { id: 'game-state-test', authToken: 'test', method: 'game.state', params }
}

describe('game.state RPC', () => {
  it('passes the caller terminal context to the runtime', async () => {
    const calls: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      getOrchestratorGameState: async (args: unknown) => {
        calls.push(args)
        return { config: { mode: 'on' } }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(
      dispatcher.dispatch(request({ worktreeId: 'wt1', terminalHandle: 'h1', paneKey: 'tab:leaf' }))
    ).resolves.toMatchObject({ ok: true, result: { config: { mode: 'on' } } })
    expect(calls).toEqual([{ worktreeId: 'wt1', terminalHandle: 'h1', paneKey: 'tab:leaf' }])
  })

  it('rejects a non-string worktree id', async () => {
    const runtime = { getRuntimeId: () => 'runtime' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(dispatcher.dispatch(request({ worktreeId: 4 }))).resolves.toMatchObject({
      ok: false
    })
  })
})
