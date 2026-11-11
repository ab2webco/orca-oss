import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

// Why bounded strings: any CLI or paired client reaches this; the host contains the path itself.
const GameSceneArtParams = z.object({
  worktreeId: z.string().max(512).optional(),
  terminalHandle: z.string().max(512).optional(),
  sceneId: z.string().min(1).max(600),
  src: z.string().min(1).max(512)
})

/** One image of the caller's scene art; a host without it answers method_not_found (ORCA-1150). */
export const ORCHESTRATOR_GAME_SCENE_ART_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.sceneArt',
    params: GameSceneArtParams,
    handler: async (params, { runtime }) => runtime.readGameSceneArt(params)
  })
]
