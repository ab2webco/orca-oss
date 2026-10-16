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

  it('opens a game link in the system browser through the runtime, http(s) only', async () => {
    const opened: string[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      openGameLinkInSystemBrowser: async (url: string) => {
        opened.push(url)
        return { opened: true }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const open = (url: unknown) =>
      dispatcher.dispatch({ id: 'o', authToken: 'test', method: 'game.openLink', params: { url } })

    await expect(open('https://github.com/o/r/pulls')).resolves.toMatchObject({
      ok: true,
      result: { opened: true }
    })
    await expect(open('file:///etc/passwd')).resolves.toMatchObject({ ok: false })
    await expect(open('javascript:alert(1)')).resolves.toMatchObject({ ok: false })
    expect(opened).toEqual(['https://github.com/o/r/pulls'])
  })
})
