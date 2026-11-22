import { ORCHESTRATION_FEDERATION_DETACH_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { FederatedDispatchRow } from '../../orchestration/types'
import { resolvePinnedFederatedServer } from './orchestration-worker-observation'

const HOST_READ_TIMEOUT_MS = 15_000
const HOST_DETACH_TIMEOUT_MS = 30_000

/** Detaches a live member on its paired host, leaving its pane and worktree there (ORCA-1326). */
export async function detachFederatedWorker(args: {
  runtime: OrcaRuntimeService
  federated: FederatedDispatchRow
  requestId: string | undefined
}) {
  const { runtime, federated } = args
  const dispatchId = federated.dispatch_id
  const server = resolvePinnedFederatedServer(runtime, federated)
  const status = (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'status.get',
    undefined,
    HOST_READ_TIMEOUT_MS
  )) as RuntimeStatus
  // Why ask first: an older host has no federationDetach and would fail as an unknown method.
  if (!status.capabilities?.includes(ORCHESTRATION_FEDERATION_DETACH_RUNTIME_CAPABILITY)) {
    throw new OrchestrationError(
      'capability_unsupported',
      `${server.name} runs Orca ${status.appVersion ?? '(version unknown)'}, which cannot detach a live member (${ORCHESTRATION_FEDERATION_DETACH_RUNTIME_CAPABILITY}); update Orca on ${server.name}, or end it with \`orca game stop\`. No effects were applied.`,
      { capability: ORCHESTRATION_FEDERATION_DETACH_RUNTIME_CAPABILITY, host: server.name }
    )
  }
  const remote = (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'orchestration.federationDetach',
    { dispatchId },
    HOST_DETACH_TIMEOUT_MS,
    args.requestId ? { orchestrationRequestId: args.requestId } : undefined
  )) as { state?: string; stage?: string }
  // Why: only the host's own detached receipt proves its pane outlives the dispatch.
  if (remote.stage !== 'detached') {
    throw new OrchestrationError(
      'dispatch_inactive',
      `${server.name} did not detach Dispatch ${dispatchId}: it is ${remote.state ?? 'unknown'} there.`
    )
  }
  const db = runtime.getOrchestrationDb()
  const detached = db.detachWorker(dispatchId)
  if (detached.disposition === 'detached') {
    runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  }
  return {
    dispatchId,
    state: detached.worker.state,
    alreadySettled: detached.disposition === 'already_settled',
    processAction: 'none' as const
  }
}
