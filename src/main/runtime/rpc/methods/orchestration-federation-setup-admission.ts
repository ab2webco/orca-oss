import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { LOCAL_SETUP_HOST } from '../../orchestration/worker-setup-admission'
import type { FederationAttachStartInput } from './orchestration-federation-start-schema'
import type { WorkerSetupSlot } from './orchestration-worker-setup-queue'

/**
 * Claims this host's setup slot for a remote game member, or refuses by name.
 * Why no queue: the attach answers synchronously, and a busy host is refused so
 * placement can pick another one (O3, ORCA-792).
 */
export async function claimFederatedSetupSlot(args: {
  runtime: OrcaRuntimeService
  params: FederationAttachStartInput
  createsWorktree: boolean
}): Promise<WorkerSetupSlot | null> {
  const { runtime, params } = args
  if (!args.createsWorktree || params.setupAdmission !== 'queue') {
    return null
  }
  const repo = await runtime.showRepo(params.repo as string)
  // Why per connection: an SSH setup spends that host's memory, not this one's.
  const host = repo.connectionId ? `ssh:${repo.connectionId}` : LOCAL_SETUP_HOST
  const claim = await runtime.getWorkerSetupAdmission().claimIfFree({
    host,
    taskId: params.taskId,
    label: params.displayName ?? params.name ?? params.taskId
  })
  if (!claim.admitted) {
    throw new OrchestrationError(
      'setup_slot_busy',
      `setup_slot_busy: ${host} is busy with another setup (${claim.waitingOn}). Nothing was started.`,
      { host, waitingOn: claim.waitingOn }
    )
  }
  return { release: claim.release, watching: false }
}
