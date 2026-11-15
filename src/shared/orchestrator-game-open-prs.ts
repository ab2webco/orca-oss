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

const mentionsTicket = (title: string, ticket: string): boolean =>
  new RegExp(
    `(^|[^A-Za-z0-9])${ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`,
    'i'
  ).test(title)

// Why a stop, not a warning: a lead launched past the warning and piled up open PRs (ORCA-1214).
/** Why `game launch` refuses at the open-PR cap; null below it or when the ticket's own PR is open. */
export function openPrCapRefusalOf(state: OpenPrsInput, ticket: string): string | null {
  const warning = openPrWarningOf(state)
  if (warning === null) {
    return null
  }
  // Why: relaunching a ticket whose PR is open adds no PR; only the kept items are known.
  const own = state.project?.reviews?.items.some((one) => mentionsTicket(one.title, ticket))
  return own
    ? null
    : `${warning}. Merge one first, or pass --past-pr-cap "<why>" to launch ${ticket} anyway.`
}
