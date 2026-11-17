import { z } from 'zod'
import { GAME_STEWARD_TICKET } from '../../../../shared/orchestrator-game-member-steward'
import { defineMethod, type RpcMethod } from '../core'

const GameStewardLogParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  ticket: z.string().regex(GAME_STEWARD_TICKET)
})

/** A ticket's durable Orca steward log (ORCA-1242); an older host answers method_not_found. */
export const ORCHESTRATOR_GAME_STEWARD_LOG_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.stewardLog',
    params: GameStewardLogParams,
    handler: (params, { runtime }) => runtime.gameStewardLogOf(params)
  })
]
