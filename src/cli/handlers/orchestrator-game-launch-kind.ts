import { RuntimeClientError } from '../runtime-client'
import {
  gameKindEffortPlanOf,
  type GameEffortPlan
} from '../../shared/orchestrator-game-effort-plan'
import {
  gameKindLaunchOf,
  gameLaunchChosenByOf,
  type GameLaunchChosenBy,
  type GameTicketKind
} from '../../shared/orchestrator-game-ticket-kind'
import {
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'

/**
 * The worker-start model a Claude member gets from its ticket's kind when no flag or orca.yaml
 * chose one, so it never falls back to the account default (ORCA-851). Nothing on a runtime that
 * would pin it, which would lock a router (Jev) out of the member.
 */
export function gameKindLaunchParamsOf(
  choice: { agent: string; model?: string },
  typed: { kind?: GameTicketKind },
  title: string,
  capabilities: readonly string[]
): { model?: string; effort?: string; modelChosenBy?: GameLaunchChosenBy } {
  if (
    choice.agent !== 'claude' ||
    choice.model !== undefined ||
    !capabilities.includes(ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY) ||
    !capabilities.includes(ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY)
  ) {
    return {}
  }
  const chosenBy = gameLaunchChosenByOf(typed.kind ?? null, title)
  const { model, effort } = gameKindLaunchOf(chosenBy.kind)
  return { model, effort, modelChosenBy: chosenBy }
}

/** The ticket's seeded effort plan when its kind picked the model (ORCA-1242); a pin plans nothing. */
export function gameKindEffortPlanSeedOf(model: { modelChosenBy?: GameLaunchChosenBy }): {
  effortPlan?: GameEffortPlan
} {
  return model.modelChosenBy ? { effortPlan: gameKindEffortPlanOf(model.modelChosenBy.kind) } : {}
}

/** A member's worker-start model: the flag or orca.yaml choice, else its ticket kind's default. */
export function gameMemberModelParamsOf(
  choice: { agent: string; model?: string; effort?: string },
  typed: { kind?: GameTicketKind },
  title: string,
  capabilities: readonly string[]
): { model?: string; effort?: string; modelChosenBy?: GameLaunchChosenBy } {
  if (!choice.model) {
    return gameKindLaunchParamsOf(choice, typed, title, capabilities)
  }
  if (!capabilities.includes(ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The connected Orca Lab runtime cannot pick a member model. Update or restart Orca Lab.'
    )
  }
  return { model: choice.model, effort: choice.effort }
}
