import { ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { WorkerStartInput } from './orchestration-worker-start-schema'

/**
 * The worker-start a host gets: the lead's ticket-kind default only where the host launches it
 * unpinned; an older host starts the member on its account default, as before (ORCA-851).
 */
export function federatedLaunchParamsOf(
  params: WorkerStartInput,
  capabilities: readonly string[]
): WorkerStartInput {
  if (
    !params.modelChosenBy ||
    capabilities.includes(ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY)
  ) {
    return params
  }
  const { model: _model, effort: _effort, modelChosenBy: _chosenBy, ...rest } = params
  return rest
}
