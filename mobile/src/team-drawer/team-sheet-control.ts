import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import {
  gameMembersRunningOf,
  teamActionsOf,
  type TeamAction
} from '../../../src/shared/team-panel-actions'

export type TeamSheetControl = {
  actions: TeamAction[]
  /** A STOP is on; `membersRunning` still work, since a STOP only pauses launches and pushes. */
  stopped: { by: string | null; membersRunning: number } | null
}

type Rec = Record<string, unknown>
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The dock's actions and the STOP, from the lead's game.state with the desktop panel's builders. */
export function teamSheetControlOf(state: Rec): TeamSheetControl {
  const game = {
    ...state,
    actions: Array.isArray(state.actions) ? state.actions.filter(isRecord) : [],
    agents: Array.isArray(state.agents) ? state.agents.filter(isRecord) : []
  } as unknown as OrchestratorGameState
  const stop = isRecord(state.stopped) ? state.stopped : null
  return {
    actions: teamActionsOf(game),
    stopped: stop
      ? {
          by: typeof stop.by === 'string' ? stop.by : null,
          membersRunning: gameMembersRunningOf(game)
        }
      : null
  }
}
