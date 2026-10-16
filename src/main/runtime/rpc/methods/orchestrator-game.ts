import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

const GameStateParams = z
  .object({
    worktreeId: z.string().optional(),
    terminalHandle: z.string().optional(),
    paneKey: z.string().optional()
  })
  .optional()

export const ORCHESTRATOR_GAME_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.state',
    params: GameStateParams,
    handler: async (params, { runtime }) =>
      runtime.getOrchestratorGameState({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle,
        paneKey: params?.paneKey
      })
  })
]
