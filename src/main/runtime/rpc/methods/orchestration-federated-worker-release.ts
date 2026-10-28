import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { FederatedDispatchRow } from '../../orchestration/types'
import { WORKER_SETTLED_STATES } from '../../orchestration/worker-terminal-ownership'
import { assertFederationReleaseReceipt } from './orchestration-federation-release'
import {
  isFederatedMemberGoneOnHost,
  isHostDispatchNotFound
} from './orchestration-federated-worker-gone'
import type { WorkerReleaseReceipt } from './orchestration-worker-release-completion'
import { resolvePinnedFederatedServer } from './orchestration-worker-observation'

type FederatedWorkerReleaseReceipt = WorkerReleaseReceipt & {
  remote?: {
    closedTerminals: string[]
    removedWorktree: string | null
    worktreeError?: string
    /** The host had nothing of it left; the home settles the ghost row. */
    alreadyGone?: true
  }
}

/** Releases a settled remote member on the host that owns its terminal and worktree. */
export async function releaseFederatedWorker(args: {
  runtime: OrcaRuntimeService
  federated: FederatedDispatchRow
  requestId: string | undefined
}): Promise<FederatedWorkerReleaseReceipt> {
  const { runtime, federated } = args
  const dispatchId = federated.dispatch_id
  const db = runtime.getOrchestrationDb()
  const worker = db.getWorkerDispatch(dispatchId)
  const base = { dispatchId, processAction: 'none' as const, archive: null }
  if (worker?.stage === 'released') {
    return { ...base, state: 'already_released' }
  }
  if (!worker || !WORKER_SETTLED_STATES.includes(worker.state)) {
    return {
      ...base,
      state: 'retained',
      reason: 'not_settled',
      recovery: 'The remote worker has not finished; stop it or wait for worker_done first.'
    }
  }
  const server = resolvePinnedFederatedServer(runtime, federated)
  const status = (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'status.get',
    undefined,
    15_000
  )) as RuntimeStatus
  const settleGone = (): FederatedWorkerReleaseReceipt => {
    db.markFederatedWorkerReleased(dispatchId)
    runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
    const remote = { closedTerminals: [], removedWorktree: null, alreadyGone: true as const }
    return { ...base, state: 'released', remote }
  }
  if (!status.capabilities?.includes(ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY)) {
    if (await isFederatedMemberGoneOnHost(runtime, server.environmentId, dispatchId)) {
      return settleGone()
    }
    return {
      ...base,
      state: 'retained',
      reason: 'federation_unsupported',
      recovery: `${server.name} cannot release remote workers yet; update Orca on ${server.name}, or remove its worktree there directly.`
    }
  }
  let remote
  try {
    remote = assertFederationReleaseReceipt(
      await runtime.callOrchestrationWorkerServer(
        server.environmentId,
        'orchestration.federationRelease',
        { dispatchId },
        30_000,
        args.requestId ? { orchestrationRequestId: args.requestId } : undefined
      )
    )
  } catch (error) {
    if (isHostDispatchNotFound(error)) {
      return settleGone()
    }
    throw error
  }
  const detail = {
    closedTerminals: remote.closedTerminals,
    removedWorktree: remote.removedWorktree,
    ...(remote.worktreeError ? { worktreeError: remote.worktreeError } : {})
  }
  if (remote.state === 'retained') {
    return { ...base, state: 'retained', reason: remote.reason, remote: detail }
  }
  db.markFederatedWorkerReleased(dispatchId)
  runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  return {
    ...base,
    state: remote.state,
    processAction: remote.closedTerminals.length > 0 ? 'closed_agent_terminal' : 'none',
    remote: detail
  }
}
