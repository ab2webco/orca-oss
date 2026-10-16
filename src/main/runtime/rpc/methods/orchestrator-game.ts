import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { isHttpUrl } from '../../../../shared/orchestrator-game-integrations'

const GameStateParams = z
  .object({
    worktreeId: z.string().optional(),
    terminalHandle: z.string().optional(),
    paneKey: z.string().optional()
  })
  .optional()

// Why http(s) only: any CLI caller reaches this, and it opens on the person's desktop.
const GameOpenLinkParams = z.object({
  url: z.string().max(2048).refine(isHttpUrl, 'Only http(s) links open in the system browser.')
})

export const ORCHESTRATOR_GAME_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.openLink',
    params: GameOpenLinkParams,
    handler: async (params, { runtime }) => runtime.openGameLinkInSystemBrowser(params.url)
  }),
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
