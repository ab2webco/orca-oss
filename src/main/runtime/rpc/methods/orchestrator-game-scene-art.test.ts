import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_SCENE_ART_METHODS } from './orchestrator-game-scene-art'

function request(params?: unknown): RpcRequest {
  return { id: 'scene-art-test', authToken: 'test', method: 'game.sceneArt', params }
}

function dispatcherOf(read: (args: unknown) => Promise<unknown>) {
  const runtime = { getRuntimeId: () => 'runtime', readGameSceneArt: read }
  return new RpcDispatcher({
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: ORCHESTRATOR_GAME_SCENE_ART_METHODS
  })
}

describe('game.sceneArt RPC', () => {
  it("passes the lead caller, the scene and the image to the runtime, and returns the host's read", async () => {
    const calls: unknown[] = []
    const dispatcher = dispatcherOf(async (args) => {
      calls.push(args)
      return { contentBase64: 'iVBO', mimeType: 'image/png' }
    })
    const params = {
      worktreeId: 'wt1',
      terminalHandle: 'h1',
      sceneId: 'file:.orca/scenes/space.json',
      src: 'art/sky.png'
    }

    await expect(dispatcher.dispatch(request(params))).resolves.toMatchObject({
      ok: true,
      result: { contentBase64: 'iVBO', mimeType: 'image/png' }
    })
    expect(calls).toEqual([params])
  })

  it('refuses a request without the scene or the image', async () => {
    const dispatcher = dispatcherOf(async () => ({}))
    await expect(dispatcher.dispatch(request({ worktreeId: 'wt1' }))).resolves.toMatchObject({
      ok: false
    })
  })

  it('reports a refused read as an error, never as an empty image', async () => {
    const dispatcher = dispatcherOf(async () => {
      throw new Error('resolves outside the scene folder')
    })
    await expect(
      dispatcher.dispatch(request({ worktreeId: 'wt1', sceneId: 'quest', src: 'a.png' }))
    ).resolves.toMatchObject({ ok: false })
  })
})
