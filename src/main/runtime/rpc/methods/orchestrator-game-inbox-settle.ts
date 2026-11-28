import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { GAME_EVENT_TEXT_MAX } from '../../../../shared/orchestrator-game-events'
import { ownerAnswerViaOf } from './orchestrator-game-board'

const GameInboxSettleParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  id: z.string().min(1).max(80),
  note: z.string().trim().min(1).max(GAME_EVENT_TEXT_MAX)
})

/** `game inbox --settle` and the Inbox's Dismiss (ORCA-1482); an older host answers method_not_found. */
export const ORCHESTRATOR_GAME_INBOX_SETTLE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.inboxSettle',
    params: GameInboxSettleParams,
    handler: async (params, context) =>
      context.runtime.getGameInboxSettler().settle({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        id: params.id,
        note: params.note,
        via: ownerAnswerViaOf(context)
      })
  })
]
