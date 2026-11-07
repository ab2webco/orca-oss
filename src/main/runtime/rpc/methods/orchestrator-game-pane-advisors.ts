import { z } from 'zod'
import { GAME_MEMBER_ADVISOR_PANES_MAX } from '../../../../shared/orchestrator-game-member-advisor'
import { defineMethod, type RpcMethod } from '../core'

const GamePaneAdvisorsParams = z.object({
  paneKeys: z.array(z.string().min(1).max(256)).max(GAME_MEMBER_ADVISOR_PANES_MAX)
})

/** Why its own read: with no lead, game.state has no caller; an older host answers method_not_found. */
export const ORCHESTRATOR_GAME_PANE_ADVISORS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.paneAdvisors',
    params: GamePaneAdvisorsParams,
    handler: (params, { runtime }) => runtime.getGamePaneAdvisors(params.paneKeys)
  })
]
