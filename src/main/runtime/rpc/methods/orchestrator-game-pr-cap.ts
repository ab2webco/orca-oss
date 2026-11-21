import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

const GamePrCapParams = z.object({
  terminalHandle: z.string().optional(),
  paneKey: z.string().optional(),
  role: z.string().optional()
})

// Why its own method: only `gh pr create` asks, so every other gh call stays off the runtime.
export const ORCHESTRATOR_GAME_PR_CAP_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.prCapCheck',
    params: GamePrCapParams,
    handler: async (params, { runtime }) => runtime.readGamePrCap(params)
  })
]
