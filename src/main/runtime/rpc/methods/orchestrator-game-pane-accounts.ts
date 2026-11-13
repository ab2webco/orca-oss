import { z } from 'zod'
import { GAME_MEMBER_ADVISOR_PANES_MAX } from '../../../../shared/orchestrator-game-member-advisor'
import { defineMethod, type RpcMethod } from '../core'

const GamePaneAccountsParams = z.object({
  panes: z
    .array(
      z.object({
        paneKey: z.string().min(1).max(256),
        agentType: z.string().max(64).nullable(),
        worktreeId: z.string().max(4096).nullable()
      })
    )
    .max(GAME_MEMBER_ADVISOR_PANES_MAX)
})

/** Why its own read: with no lead, game.state has no caller; an older host answers method_not_found. */
export const ORCHESTRATOR_GAME_PANE_ACCOUNTS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.paneAccounts',
    params: GamePaneAccountsParams,
    handler: (params, { runtime }) => runtime.getGamePaneAccounts(params.panes)
  })
]
