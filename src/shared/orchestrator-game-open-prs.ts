import { gameFleetReportOf } from './orchestrator-game-fleet-verbs'
import type { OrchestratorGameState } from './orchestrator-game-state'

type OpenPrsInput = Parameters<typeof gameFleetReportOf>[0] & Pick<OrchestratorGameState, 'project'>

// Why the project's PR list, not the live members: a released member's open PR leaves no live row.
/** Open PRs at the cap: a launch would start another ticket before any of them merged. */
export function openPrWarningOf(state: OpenPrsInput): string | null {
  const open = state.project?.reviews?.total
  const { cap } = gameFleetReportOf(state)
  return open !== undefined && open >= cap
    ? `${open} open PRs reach the cap of ${cap}: finish them to merge before launching another ticket`
    : null
}
